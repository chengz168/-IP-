const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const productSource = require('../server/product-source.cjs');

function problem(message, code) { return Object.assign(new Error(message), { code }); }

// 仅采集浏览器实际呈现的公开内容，不读取账号、Cookie 或页面运行时私有变量。
const snapshotScript = `(() => {
  const text = (document.body?.innerText || '').trim().slice(0, 60000);
  const images = [...document.images].map(image => ({
    url: image.currentSrc || image.src || image.getAttribute('data-src') || '',
    alt: image.alt || '', width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height
  })).filter(image => /^https?:/.test(image.url) && image.width >= 100 && image.height >= 100).slice(0, 100);
  const title = document.title || '';
  const restricted = /(?:请完成.{0,8}验证|滑动.{0,12}完成验证|请先登录后|访问过于频繁|安全验证|检测到当前环境存在安全风险|请使用抖音APP扫码|verify you are human)/i.test(text.slice(0, 6000));
  const productJson = [...document.querySelectorAll('script[type="application/ld+json"]')].some(script => {
    try { return /"@type"\\s*:\\s*(?:"Product"|\\[[^\\]]*"Product")/.test(script.textContent || ''); } catch { return false; }
  });
  const commerce = /(?:立即购买|立即抢购|加入购物车|领券购买|去购买|add to cart|buy now)/i.test(text);
  const titleCandidates = [...document.querySelectorAll('h1,h2,.title-info__text,[class*="product-title"],[class*="productTitle"],[class*="goods-title"],[class*="goodsTitle"],[class*="commodity-title"],[class*="commodityTitle"]')]
    .map(node => (node.innerText || '').replace(/\\s+/g, ' ').trim()).filter(value => value.length >= 4 && value.length <= 250);
  const mainImages = [...document.querySelectorAll('.head-figure__media-view__content')].map(node => {
    const match = getComputedStyle(node).backgroundImage.match(/^url\\(["']?(.*?)["']?\\)$/);
    return match && /^https?:/.test(match[1]) ? {url: match[1], kind: 'main'} : null;
  }).filter(Boolean);
  // 公开页可能隐藏价格，真实商品标题、图片和购买入口已经足以继续采集。
  return {title, text, images: [...mainImages, ...images], restricted, ready: !restricted && (images.length + mainImages.length) > 0 && (productJson || (commerce && titleCandidates.length > 0)), titleCandidates};
})()`;

class ProductBrowser {
  constructor({ BrowserWindow, inspect, timeoutMs = 35000 }) {
    this.BrowserWindow = BrowserWindow;
    this.inspect = inspect;
    this.timeoutMs = Math.min(60000, Math.max(1000, timeoutMs));
    this.windows = new Set();
  }

  async read(input, { signal, progress } = {}) {
    const validator = productSource.validatePublicUrl;
    if (typeof validator !== 'function') throw problem('商品采集地址校验模块不可用。', 'PRODUCT_BROWSER_UNAVAILABLE');
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason || problem('商品采集已取消。', 'ABORT_ERR'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(problem('商品页面未在允许时间内加载完成，请手动上传图片或稍后重试。', 'PRODUCT_SOURCE_TIMEOUT')), this.timeoutMs);
    const active = controller.signal;
    let window, session, latest, inspected = false;
    const guard = promise => new Promise((resolve, reject) => {
      const cancel = () => reject(active.reason || problem('商品采集已取消。', 'ABORT_ERR'));
      if (active.aborted) { cancel(); return; }
      active.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => active.removeEventListener('abort', cancel));
    });
    const report = async () => {
      if (inspected || !this.inspect || !window || window.isDestroyed()) return;
      inspected = true;
      try { await this.inspect({ window, state: latest || await window.webContents.executeJavaScript(snapshotScript) }); } catch { /* 诊断失败不得改变采集结果。 */ }
    };
    try {
      const validated = await guard(validator(input, { signal: active }));
      const url = typeof validated === 'string' ? validated : validated?.url?.href || validated?.url || input;
      active.throwIfAborted();
      window = new this.BrowserWindow({ show: false, width: 430, height: 932, autoHideMenuBar: true,
        webPreferences: { partition: `studio-product-${crypto.randomUUID()}`, contextIsolation: true,
          nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false,
          autoplayPolicy: 'document-user-activation-required', disableDialogs: true, spellcheck: false } });
      this.windows.add(window);
      const contents = window.webContents;
      session = contents.session;
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      session.setPermissionCheckHandler(() => false);
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      session.on('will-download', event => event.preventDefault());
      // 每次跳转、脚本、图片及接口请求都重新通过公网地址校验；一次性分区不继承用户登录态。
      session.webRequest.onBeforeRequest((details, callback) => {
        if (active.aborted || window.isDestroyed()) { callback({ cancel: true }); return; }
        Promise.resolve(validator(details.url, { signal: active })).then(async checked => {
          // 再检查 Chromium 自己的解析结果，避免它与 Node 的 DNS 结果不同。
          // Chromium 后续连接仍由其网络栈管理，此处不能宣称具有固定 IP 的代理隔离。
          const host = checked.hostname || new URL(details.url).hostname;
          const resolved = await session.resolveHost(host, { cacheUsage: 'allowed' });
          if (!resolved.endpoints?.length) throw problem('商品资源域名无法解析。', 'PRODUCT_URL_INVALID');
          await Promise.all(resolved.endpoints.map(endpoint => validator(`https://${endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address}/`, { signal: active })));
          callback({ cancel: active.aborted });
        }).catch(() => callback({ cancel: true }));
      });
      contents.on('will-navigate', (event, target) => { if (!/^https?:\/\//i.test(target)) event.preventDefault(); });
      contents.on('will-redirect', (event, target) => { if (!/^https?:\/\//i.test(target)) event.preventDefault(); });
      contents.on('will-frame-navigate', event => { if (!/^https?:\/\//i.test(event.url || '')) event.preventDefault(); });
      contents.on('will-attach-webview', event => event.preventDefault());
      const stop = () => { if (!window.isDestroyed()) { contents.stop(); window.destroy(); } };
      active.addEventListener('abort', stop, { once: true });
      progress?.({ phase: 'browser', message: '正在后台读取公开商品详情和图片…' });
      // 不等待长轮询与统计请求结束；DOM 可用后即检查真实商品资料。
      let loadError;
      const loaded = new Promise((resolve, reject) => {
        contents.once('dom-ready', resolve);
        contents.once('destroyed', () => reject(active.reason || problem('商品读取窗口已关闭。', 'PRODUCT_BROWSER_CLOSED')));
        window.loadURL(url).then(resolve, error => { loadError = error; resolve(); });
      });
      await guard(loaded);
      let stable = 0, previousImages = 0, scrolls = 0;
      const domStarted = Date.now();
      while (!active.aborted) {
        latest = await guard(contents.executeJavaScript(snapshotScript));
        // 保留失败页面的可见诊断，超时取消仍然立即销毁窗口。
        if (!latest.ready && Date.now() - domStarted > 9000) await report();
        if (latest.restricted) {
          await report();
          throw problem('商品平台限制了当前公开访问，页面要求前往 APP 或完成安全验证，无法继续静默采集。请手动上传商品图并补充资料。', 'PRODUCT_PAGE_RESTRICTED');
        }
        if (latest.ready) {
          stable = latest.images.length === previousImages ? stable + 1 : 0;
          previousImages = latest.images.length;
          if (scrolls < 4) {
            await guard(contents.executeJavaScript('window.scrollBy(0, Math.max(innerHeight * 0.8, 600))'));
            scrolls++;
          } else if (stable >= 2) {
            await guard(contents.executeJavaScript('window.scrollTo(0, 0)'));
            await report();
            const html = await guard(contents.executeJavaScript('document.documentElement.outerHTML'));
            if (Buffer.byteLength(html, 'utf8') > 8 * 1024 * 1024) throw problem('商品详情页面过大，请手动上传资料。', 'PRODUCT_SOURCE_TOO_LARGE');
            return { html, url: contents.getURL() };
          }
        } else if (loadError && !latest.text) {
          await report();
          throw problem('商品页面加载失败，请检查网络或手动上传资料。', 'PRODUCT_BROWSER_LOAD_FAILED');
        }
        await guard(delay(650, undefined, { signal: active }));
      }
      throw active.reason;
    } catch (error) {
      await report();
      throw active.aborted ? active.reason : error;
    } finally {
      clearTimeout(timer);
      controller.abort(problem('商品采集会话已结束。', 'ABORT_ERR'));
      signal?.removeEventListener('abort', abort);
      if (window) {
        this.windows.delete(window);
        if (!window.isDestroyed()) window.destroy();
      }
      if (session) {
        session.webRequest.onBeforeRequest(null);
        await session.closeAllConnections().catch(() => {});
        await session.clearStorageData().catch(() => {});
        await session.clearCache().catch(() => {});
      }
    }
  }

  close() { for (const window of this.windows) if (!window.isDestroyed()) window.destroy(); }
}

module.exports = { ProductBrowser };
