const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { ProductBrowser } = require('../electron/product-browser.cjs');
const { parseProductHtml } = require('../server/product-source.cjs');

// 此脚本应由项目 Electron 直接运行，使用独立且不持久化的公开会话。
const target = process.argv.find(value => /^https?:\/\//.test(value)) || 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3854345420239143257&origin_type=604';
const evidence = path.resolve(__dirname, '../evidence/validation/product-promo-20261120');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(app.getPath('temp'), `super-ip-product-inspect-${process.pid}`));
// 读取器完成时会销毁唯一的隐藏窗口，须等取证文件落盘后才主动退出。
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const receipt = { startedAt: new Date().toISOString(), target, windowShown: false, audioMuted: true, isolatedSession: true };
  let captured = false;
  const reader = new ProductBrowser({ BrowserWindow, inspect: async ({ window, state }) => {
    captured = true;
    // 只保存公开可见资料，不导出 Cookie、请求头、账号数据或运行时变量。
    receipt.page = state;
    receipt.windowShown = window.isVisible();
    receipt.audioMuted = window.webContents.isAudioMuted();
    fs.writeFileSync(path.join(evidence, 'browser-visible-product.json'), JSON.stringify(state, null, 2));
    const publicDom = await window.webContents.executeJavaScript(`(() => { const copy = document.documentElement.cloneNode(true); copy.querySelectorAll('script,iframe,input,textarea').forEach(node => node.remove()); for (const node of copy.querySelectorAll('*')) for (const attribute of [...node.attributes]) if (/^(?:on|data-)/i.test(attribute.name)) node.removeAttribute(attribute.name); return copy.outerHTML; })()`);
    fs.writeFileSync(path.join(evidence, 'browser-rendered-product.html'), publicDom);
    fs.writeFileSync(path.join(evidence, 'browser-visible-product.png'), (await window.webContents.capturePage()).toPNG());
  } });
  try {
    const result = await reader.read(target, { progress: status => { receipt.lastProgress = status; } });
    receipt.htmlBytes = Buffer.byteLength(result.html);
    // 运行真实解析器，不能仅凭页面加载或截图宣称已成功提取商品。
    receipt.product = parseProductHtml(result.html, result.url);
    receipt.success = true;
  } catch (error) {
    receipt.success = false;
    receipt.error = { code: error.code || 'ERROR', message: error.message };
  } finally {
    receipt.captured = captured;
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidence, 'browser-product-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ success: receipt.success, error: receipt.error, title: receipt.page?.title, images: receipt.page?.images?.length, text: receipt.page?.text?.slice(0, 2000), windowShown: receipt.windowShown, audioMuted: receipt.audioMuted, captured, evidence }, null, 2));
    app.exit(receipt.success ? 0 : 1);
  }
});
