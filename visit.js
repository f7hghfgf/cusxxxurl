const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pLimit = require('p-limit');

// 环境变量
const urls = process.env.TARGET_URLS.split(',');
const cookieMap = JSON.parse(process.env.COOKIE_MAP || '{}');
const userAgent = process.env.USER_AGENT || 'Mozilla/5.0';
const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// 模糊处理函数
const blurImage = async (inputPath, outputPath) => {
  await sharp(inputPath)
    .blur(15)
    .jpeg({ quality: 80 })
    .toFile(outputPath);
};

// Cookie 解析函数
const parseCookies = (cookieStr, domain) => {
  return cookieStr.split(';').map(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    return {
      name,
      value: rest.join('='),
      domain,
      path: '/',
      httpOnly: false,
      secure: true
    };
  });
};

// 加载本地 Cookie
const loadCookies = (domain) => {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  const allCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  return allCookies[domain] || null;
};

// 保存 Cookie 到本地
const saveCookies = async (page, domain) => {
  const cookies = await page.cookies();
  const allCookies = fs.existsSync(COOKIE_FILE)
    ? JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'))
    : {};
  allCookies[domain] = cookies;
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(allCookies, null, 2));
};

// 单个页面处理逻辑
const handlePage = async (browser, url, index) => {
  const page = await browser.newPage();
  await page.setUserAgent(userAgent);
  await page.setViewport({ width: 1280, height: 800 });

  const domain = new URL(url).hostname;
  let cookies = loadCookies(domain);
  if (!cookies && cookieMap[domain]) {
    cookies = parseCookies(cookieMap[domain], domain);
  }
  if (cookies) await page.setCookie(...cookies);

  try {
    await page.goto(url, { waitUntil: 'networkidle2' });

    if (url.includes('streamlit.app')) {
      await page.waitForSelector('button', { timeout: 30000, visible: true });
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.innerText.trim());
        if (text.includes('Manage app')) {
          await btn.click();
          break;
        }
      }
    }

    const screenshotPath = path.join(__dirname, `screenshot_${index + 1}.jpg`);
    await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 80 });

    const blurredPath = path.join(__dirname, `blurred_${index + 1}.jpg`);
    await blurImage(screenshotPath, blurredPath);

    await saveCookies(page, domain);
  } catch (_) {
    // 静默处理错误
  } finally {
    await page.close();
  }
};

// 主流程
(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const limit = pLimit(5); // 最多同时运行 5 个任务
  const tasks = urls.map((url, index) =>
    limit(() => handlePage(browser, url, index))
  );

  await Promise.all(tasks);
  await browser.close();
})();
