const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

const PAGE_LIMIT = 8 * 1024 * 1024;
const IMAGE_LIMIT = 20 * 1024 * 1024;
const TIMEOUT = 25000;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function fail(message, code = 'PRODUCT_SOURCE_UNAVAILABLE') {
  return Object.assign(new Error(message), { code });
}

function decode(value) {
  return String(value ?? '').replace(/&#(x[\da-f]+|\d+);?/gi, (_, code) => {
    const number = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, code) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[code.toLowerCase()]));
}

function clean(value, limit = 10000) {
  return decode(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function publicUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    // 仅允许全球单播，拒绝映射 IPv4、链路本地、回环、ULA、组播与转换隧道。
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    const first = parseInt(normalized.split(':')[0], 16);
    const second = parseInt(normalized.split(':')[1] || '0', 16);
    return first >= 0x2000 && first < 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
  }
  return false;
}

async function validateUrl(input, { signal, lookup = dns.lookup.bind(dns) } = {}) {
  if (signal?.aborted) throw signal.reason || fail('采集已取消。', 'ABORT_ERR');
  const normalized = publicUrl(input);
  if (!normalized) throw fail('只支持无账号密码的公开 HTTP(S) 链接。', 'PRODUCT_URL_INVALID');
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost' || /\.(?:localhost|local|internal)$/i.test(hostname)) throw fail('不允许访问本机或内网地址。', 'PRODUCT_URL_PRIVATE');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || fail('采集已取消。', 'ABORT_ERR'));
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
  if (!addresses?.length || addresses.some(item => !isPublicIp(item.address))) throw fail('链接解析到了本机、内网或保留地址，已停止读取。', 'PRODUCT_URL_PRIVATE');
  return { url: url.href, hostname, addresses };
}

async function validatePublicUrl(url, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || fail('采集已取消。', 'ABORT_ERR'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(fail('商品链接地址检查超时。', 'PRODUCT_SOURCE_TIMEOUT')), TIMEOUT);
  try { return await validateUrl(url, { signal: controller.signal }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function parseRenderedDouyinProduct(html, sourceUrl) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (!(host === 'jinritemai.com' || host.endsWith('.jinritemai.com') || host === 'douyin.com' || host.endsWith('.douyin.com'))) return null;
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const elements = [];
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  // 以标签栈记录嵌套范围，避免参数行内的多层 div 被正则提前截断。
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi)) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    const tag = (token.match(/^<\/?([\w-]+)/) || [])[1]?.toLowerCase();
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index >= 0) {
        for (const node of stack.splice(index)) node.end = match.index;
      }
      continue;
    }
    const node = { tag, attributes: attrs(token), start: match.index + token.length, end: source.length, parent: stack[stack.length - 1] };
    elements.push(node);
    if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(node);
  }
  const hasClass = (node, token) => (node.attributes.class || '').split(/\s+/).includes(token);
  const text = node => node ? clean(source.slice(node.start, node.end)) : '';
  const first = token => elements.find(node => hasClass(node, token));
  const titleNode = first('title-info__text');
  const mainNodes = elements.filter(node => hasClass(node, 'head-figure__media-view__content'));
  const detailNodes = elements.filter(node => hasClass(node, 'product-big-img-list__every-img'));
  const title = text(titleNode);
  if (!title || (!mainNodes.length && !detailNodes.length) || !first('basic-info')) return null;
  const mainImages = mainNodes.map(node => {
    const style = node.attributes.style || '';
    return (style.match(/background-image\s*:\s*url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/i) || []).slice(1).find(Boolean);
  }).filter(Boolean);
  const detailImages = detailNodes.map(node => node.attributes['data-src'] || node.attributes['data-original'] || node.attributes.src).filter(Boolean);
  const rows = elements.filter(node => hasClass(node, 'product-param__params__content__item__content__row'));
  const additionalProperty = [];
  for (const row of rows) {
    const descendants = elements.filter(node => node.start >= row.start && node.end <= row.end);
    const key = descendants.find(node => hasClass(node, 'product-param__params__content__item__content__row__key'));
    const valueNodes = descendants.filter(node => hasClass(node, 'product-param__params__content__item__content__row__value__desc__text'));
    const name = text(key);
    const value = valueNodes.map(text).filter(Boolean).join('、');
    if (name && value) additionalProperty.push({ name, value });
  }
  const amount = text(first('price-line__price-container__price__amount'));
  const symbol = text(first('price-line__price-container__price__symbol'));
  const priceVisible = /^\d+(?:[.,]\d+)?$/.test(amount);
  return {
    name: title,
    image: mainImages,
    __detailImages: detailImages,
    __renderedDouyin: true,
    additionalProperty,
    sku: additionalProperty.find(item => item.name === '货号')?.value || '',
    offers: priceVisible ? { price: amount, priceCurrency: /^[￥¥]$/.test(symbol) ? 'CNY' : '' } : undefined,
    __priceHidden: !priceVisible,
  };
}

function parseProductHtml(html, sourceUrl) {
  const url = publicUrl(sourceUrl);
  if (!url) throw fail('请输入公开的 HTTP(S) 商品链接。', 'PRODUCT_URL_INVALID');
  html = String(html ?? '');
  const meta = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content && !meta[key]) meta[key] = a.content;
  }
  const objects = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 20 || objects.length > 1000) return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (typeof value !== 'object') return;
    objects.push(value);
    // 只识别页面主体与图谱，推荐列表里的 Product 不作为当前商品。
    if (value['@graph']) visit(value['@graph'], depth + 1);
    if (value.mainEntity) visit(value.mainEntity, depth + 1);
  };
  const warnings = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if ((attrs(match[1]).type || '').split(';')[0].trim().toLowerCase() !== 'application/ld+json') continue;
    try { visit(JSON.parse(match[2].replace(/^\s*<!--|-->\s*$/g, ''))); }
    catch { warnings.push('页面存在无法读取的结构化数据，已尝试其他商品信息。'); }
  }
  let product = objects.find(item => [].concat(item['@type'] || []).some(type => /(?:^|[/#])Product$/i.test(type))) || {};
  // 仅接纳明确商品容器，不遍历推荐商品数组，避免混入其他商品信息。
  if (!Object.keys(product).length) {
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const a = attrs(match[1]);
      if (!/application\/json/i.test(a.type || '') && !/^(?:__NEXT_DATA__|RENDER_DATA|__INITIAL_STATE__)$/i.test(a.id || '')) continue;
      let state;
      try { state = JSON.parse(match[2]); } catch {
        try { state = JSON.parse(decodeURIComponent(match[2])); } catch { continue; }
      }
      const containers = [state, state?.data, state?.props?.pageProps, state?.loaderData && Object.values(state.loaderData).find(item => item?.promotion || item?.product_info)];
      let entry;
      for (const container of containers) {
        entry = container?.promotion?.product_info || container?.product_info || container?.promotion;
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && (entry.name || entry.title) && (entry.imgs || entry.images || entry.product_id || entry.promotion_id)) break;
        entry = null;
      }
      if (!entry) continue;
      const mapImages = (value) => [].concat(value || []).map(item => typeof item === 'string' ? item : item?.url || item?.url_list?.[0] || item?.uri).filter(Boolean);
      product = { name: entry.name || entry.title, description: entry.description || entry.desc, image: mapImages(entry.imgs || entry.images), brand: entry.brand, sku: entry.sku || entry.product_id, additionalProperty: entry.additionalProperty || entry.specifications, __detailImages: mapImages(entry.detail_images) };
      // 不猜测无单位数值是元还是分，只有明确币种/格式的价格才采集。
      if (entry.offers) product.offers = entry.offers;
      else if (entry.price_text) product.offers = { price: entry.price_text, priceCurrency: entry.currency || '' };
      warnings.push('商品资料来自页面嵌入的商品数据，请核对与当前商品一致。');
      break;
    }
  }
  if (!Object.keys(product).length) {
    const rendered = parseRenderedDouyinProduct(html, url);
    if (rendered) {
      product = rendered;
      warnings.push('商品资料来自已加载的抖音商品详情页面，主图与详情图已按页面区域区分。');
      if (rendered.__priceHidden) warnings.push('页面未公开完整价格，价格保留为空；宣传文案不会据此编造价格或优惠。');
    }
  }
  const isProduct = Object.keys(product).length > 0;
  const title = clean(product.name || meta['og:title'] || meta['twitter:title'] || (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1], 500);
  const visible = clean(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''));
  const challengeTitle = /(?:验证码|安全验证|访问验证|登录|sign in|log in|access denied|just a moment|robot check)/i.test(title);
  const challengeBody = /(?:请完成(?:以下)?验证|请先登录后|访问过于频繁|滑动.*?完成验证|verify (?:you are|that you)|enable javascript and cookies|captcha challenge)/i.test(visible);
  if (challengeTitle || challengeBody) throw fail('商品页面要求登录或安全验证，无法静默采集。请手动上传商品图并补充资料。', 'PRODUCT_PAGE_RESTRICTED');
  const offerValue = product.offers;
  const offer = (Array.isArray(offerValue) ? offerValue[0] : offerValue) || {};
  const price = clean(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? meta['product:price:amount'] ?? meta['og:price:amount'], 100);
  const currency = clean(offer.priceCurrency || offer.priceSpecification?.priceCurrency || meta['product:price:currency'] || meta['og:price:currency'], 20);
  const productEvidence = isProduct || /product/i.test(meta['og:type'] || '') || Boolean(meta['product:price:amount']) ||
    (Boolean(price || /(?:售价|价格|price)[\s:：]*[¥￥$€£]?\s*\d/i.test(visible)) && /(?:加入购物车|立即购买|立即抢购|add to cart|buy now)/i.test(visible));
  if (!productEvidence || !title) throw fail('未读取到可靠的商品详情，可能是动态页面或链接不受支持。请手动上传商品图并补充资料。', 'PRODUCT_NOT_FOUND');
  const images = [];
  const seen = new Set();
  const addImage = (value, kind, name) => {
    if (images.length >= 40) return;
    if (Array.isArray(value)) { value.forEach(item => addImage(item, kind, name)); return; }
    if (value && typeof value === 'object') { addImage(value.contentUrl || value.url || value['@id'], kind, value.caption || name); return; }
    if (typeof value !== 'string' || !value.trim()) return;
    const candidate = publicUrl(value.trim(), url);
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    images.push({ name: clean(name || (kind === 'main' ? '商品主图' : '商品详情图'), 200), url: candidate, kind });
  };
  addImage(product.image, 'main', title);
  addImage(product.__detailImages, 'detail');
  addImage(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'], 'main', title);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (product.__renderedDouyin) break;
    const a = attrs(match[0]);
    if (/logo|icon|avatar|qrcode|qr-code|二维码|头像/i.test(`${a.class || ''} ${a.id || ''} ${a.alt || ''}`)) continue;
    if ((Number(a.width) > 0 && Number(a.width) < 100) || (Number(a.height) > 0 && Number(a.height) < 100)) continue;
    const sources = ['data-original', 'data-src', 'data-lazy-src', 'data-ks-lazyload', 'src'].map(key => a[key]).filter(Boolean);
    const srcset = a['data-srcset'] || a.srcset;
    if (srcset) {
      const candidates = srcset.split(',').map(part => part.trim().split(/\s+/)).filter(item => item[0]);
      candidates.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
      if (candidates[0]) sources.unshift(candidates[0][0]);
    }
    const best = sources.find(value => publicUrl(value, url));
    if (best) addImage(best, /main|gallery|hero|主图/i.test(`${a.class || ''} ${a.id || ''}`) ? 'main' : 'detail', a.alt || a.title);
  }
  const specifications = [];
  for (const item of [].concat(product.additionalProperty || [])) {
    if (!item || typeof item !== 'object') continue;
    const name = clean(item.name || item.propertyID, 100);
    const value = clean(typeof item.value === 'object' ? item.value?.name || item.value?.value : item.value, 500);
    if (name && value && specifications.length < 100) specifications.push({ name, value: item.unitText ? `${value} ${clean(item.unitText, 50)}` : value });
  }
  if (!images.length) warnings.push('未读取到商品图片，请手动上传主图和详情图后继续。');
  warnings.push('图片为页面候选，可能包含推荐商品；请核对后选择。价格和规格仅反映页面可读取内容，生成前请确认。');
  return { url, title, description: clean(product.description || meta['og:description'] || meta.description), brand: clean(typeof product.brand === 'object' ? product.brand?.name : product.brand, 200), sku: clean(product.sku || product.mpn, 200), price, currency, specifications, images, warnings: [...new Set(warnings)], fetchedAt: new Date().toISOString() };
}

function createClient({ lookup = dns.lookup.bind(dns), request, timeoutMs = TIMEOUT } = {}) {
  async function fetchBytes(input, { signal, maxBytes, allowedTypes, progress } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason || fail('采集已取消。', 'ABORT_ERR'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(fail('商品页面读取超时，请稍后重试或手动上传。', 'PRODUCT_SOURCE_TIMEOUT')), timeoutMs);
    const active = controller.signal;
    const raceAbort = promise => new Promise((resolve, reject) => {
      const cancel = () => reject(active.reason || fail('采集已取消。', 'ABORT_ERR'));
      if (active.aborted) { cancel(); return; }
      active.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => active.removeEventListener('abort', cancel));
    });
    try {
      let target = input;
      for (let hop = 0; hop <= 5; hop++) {
        if (active.aborted) throw active.reason;
        const { url: normalized, addresses } = await validateUrl(target, { signal: active, lookup });
        const url = new URL(normalized);
        const chosen = addresses[0];
        progress?.({ phase: 'fetch', message: hop ? '正在读取商品页面跳转…' : '正在读取公开商品页面…' });
        const response = await raceAbort(new Promise((resolve, reject) => {
          const transport = request || (url.protocol === 'https:' ? https.request : http.request);
          const req = transport(url, { method: 'GET', signal: active, headers: { 'User-Agent': 'Mozilla/5.0 SuperIPProductReader/1.0', Accept: allowedTypes ? [...allowedTypes].join(', ') : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
            // 固定已校验地址，防止 DNS 重绑定；保留原始域名用于 TLS 校验。
            lookup: (_host, options, cb) => { if (typeof options === 'function') { cb = options; options = {}; } options?.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family); }
          }, resolve);
          req.on('error', reject);
          req.end();
        }));
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          response.destroy();
          if (!location || hop === 5) throw fail('商品链接跳转次数过多或跳转无效。', 'PRODUCT_REDIRECT_INVALID');
          target = publicUrl(location, url.href);
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw fail(`商品页面读取失败（HTTP ${response.statusCode}），请手动上传或稍后重试。`, 'PRODUCT_HTTP_ERROR'); }
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (allowedTypes && !allowedTypes.has(contentType)) { response.destroy(); throw fail('图片格式不受支持，仅支持 JPEG、PNG、WebP。', 'PRODUCT_CONTENT_TYPE'); }
        if (!allowedTypes && !['text/html', 'application/xhtml+xml'].includes(contentType)) { response.destroy(); throw fail('链接没有返回可读取的商品详情网页。', 'PRODUCT_CONTENT_TYPE'); }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); throw fail('页面使用了不支持的压缩格式，请手动上传商品资料。', 'PRODUCT_CONTENT_ENCODING'); }
        if (Number(response.headers['content-length']) > maxBytes) { response.destroy(); throw fail('页面或图片超过读取大小上限。', 'PRODUCT_SOURCE_TOO_LARGE'); }
        const chunks = [];
        let length = 0;
        await raceAbort((async () => {
          for await (const chunk of response) {
            length += chunk.length;
            if (length > maxBytes) { response.destroy(); throw fail('页面或图片超过读取大小上限。', 'PRODUCT_SOURCE_TOO_LARGE'); }
            chunks.push(Buffer.from(chunk));
          }
        })());
        return { bytes: Buffer.concat(chunks), contentType, url: url.href, charset: (String(response.headers['content-type'] || '').match(/charset\s*=\s*["']?([^;\s"']+)/i) || [])[1] };
      }
      throw fail('商品链接跳转失败。');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    async collectProduct(url, { signal, progress } = {}) {
      const result = await fetchBytes(url, { signal, progress, maxBytes: PAGE_LIMIT });
      progress?.({ phase: 'parse', message: '正在整理商品资料和图片候选…' });
      let charset = result.charset || (result.bytes.subarray(0, 4096).toString('ascii').match(/charset\s*=\s*["']?([^\s"'/>;]+)/i) || [])[1] || 'utf-8';
      let html;
      try { html = new TextDecoder(charset).decode(result.bytes); }
      catch { throw fail('商品网页编码暂不支持，请手动上传商品资料。', 'PRODUCT_CONTENT_ENCODING'); }
      return parseProductHtml(html, result.url);
    },
    async downloadProductImage(url, { signal } = {}) {
      const result = await fetchBytes(url, { signal, maxBytes: IMAGE_LIMIT, allowedTypes: IMAGE_TYPES });
      const b = result.bytes;
      const valid = result.contentType === 'image/jpeg' ? b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff : result.contentType === 'image/png' ? b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw fail('图片内容与格式不符，请更换商品图片。', 'PRODUCT_IMAGE_INVALID');
      return { bytes: result.bytes, contentType: result.contentType, url: result.url };
    }
  };
}

const client = createClient();
module.exports = { ...client, parseProductHtml, validatePublicUrl, __testing: { createClient, isPublicIp } };
