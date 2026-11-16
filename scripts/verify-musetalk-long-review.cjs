// 核对交付页面的媒体链接和布局，不代替真人感或连续口型听审。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const root = path.resolve(__dirname, '../evidence/validation/musetalk-long-20261116');
async function main() {
  const receipt = path.join(root, 'review-page-verification.json');
  assert(!fs.existsSync(receipt), '保留既有页面验收，不覆盖');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, '208秒本地口型长片对照.html')).href);
    await page.waitForFunction(() => document.querySelectorAll('video').length === 2 && [...document.querySelectorAll('video')].every(node => node.readyState >= 1));
    const media = await page.locator('video').evaluateAll(nodes => nodes.map(node => ({ source: node.currentSrc, duration: node.duration, error: node.error?.message || null })));
    assert(media.every(node => !node.error && Math.abs(node.duration - 208) < 0.05));
    await page.waitForFunction(() => document.images.length === 7 && [...document.images].every(node => node.complete && node.naturalWidth > 0));
    const layouts = [];
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 960 });
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(geometry.scrollWidth <= width, '对照页横向溢出');
      await page.screenshot({ path: path.join(root, 'review-page-' + width + '.png'), fullPage: true });
      layouts.push(geometry);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), media, imagesLoaded: 7, layouts, pageErrors: errors, qualityAccepted: false }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ mediaLoaded: media.length, imagesLoaded: 7, layouts, pageErrors: errors }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
