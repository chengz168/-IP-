const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { parseProductHtml, validatePublicUrl, __testing } = require('../server/product-source.cjs');

// 以下为真实商品 DOM 的精简摘录，保留实际标题、主图、详情图、价格占位和嵌套规格结构。
// 原始证据位于 evidence/validation/product-promo-20261120/browser-rendered-product.html；测试不依赖本机证据目录。
const douyinRenderedFixture = "<html><head><title></title></head><body><div class=\"basic-info\"><span class=\"title-info__text\">彩色羽毛逗猫棒长杆带铃铛自嗨解闷耐咬猫咪宠物玩具</span><div class=\"price-line__price-container__price__symbol\">￥</div><div class=\"price-line__price-container__price__amount\">?</div></div><div class=\"head-figure__media-view__content\" style=\"background-image: url(&quot;https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_25cffc497053b962e27255294838c428_sx_119867_www800-800~tplv-5mmsx3fupr-resize_q:1080:1080:q90.webp&quot;);\"></div><div class=\"head-figure__media-view__content\" style=\"background-image: url(&quot;https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_286059029e46651677a9fc2889824464_sx_108713_www800-800~tplv-5mmsx3fupr-resize_q:1080:1080:q90.webp&quot;);\"></div><div class=\"head-figure__media-view__content\" style=\"background-image: url(&quot;https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_b005c0028270225d354815ba7323631e_sx_121259_www800-800~tplv-5mmsx3fupr-resize_q:1080:1080:q90.webp&quot;);\"></div><div class=\"head-figure__media-view__content\" style=\"background-image: url(&quot;https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_4159d968d6aa3845fb5c8f8339055808_sx_131643_www800-800~tplv-5mmsx3fupr-resize_q:1080:1080:q90.webp&quot;);\"></div><div class=\"head-figure__media-view__content\" style=\"background-image: url(&quot;https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_0f533b9b97d38390a1b739b1d907a7ca_sx_30113_www800-800~tplv-5mmsx3fupr-resize_q:1080:1080:q90.webp&quot;);\"></div><div class=\"product-param\"><img class=\"product-param__title-img\" src=\"http://p26-item.ecombdimg.com/tos-cn-i-5mmsx3fupr/product_detail_head.png~tplv-5mmsx3fupr-origin-png.png\"><div class=\"product-param__params\" log-area=\"params\"><div class=\"product-param__params__title\">产品参数</div><div class=\"product-param__params__tab\"></div><div><div class=\"product-param__params__content__item\"><div class=\"product-param__params__content__item__content\"><div class=\"product-param__params__content__item__content__row\"><span class=\"product-param__params__content__item__content__row__key\">材质</span><div class=\"product-param__params__content__item__content__row__value\"><div class=\" product-param__params__content__item__content__row__value__desc  product-param__params__content__item__content__row__value__desc-margin-top-0 \"><span class=\"product-param__params__content__item__content__row__value__desc__text\">PP</span></div></div></div><div class=\"product-param__params__content__item__content__row\"><span class=\"product-param__params__content__item__content__row__key\">货号</span><div class=\"product-param__params__content__item__content__row__value\"><div class=\" product-param__params__content__item__content__row__value__desc  product-param__params__content__item__content__row__value__desc-margin-top-0 \"><span class=\"product-param__params__content__item__content__row__value__desc__text\">FSFSFA</span></div></div></div></div></div></div></div></div><img class=\"product-big-img-list__every-img\" src=\"https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_8769a27f82314d5d0693724638cce70d_sx_164041_www750-1148~tplv-5mmsx3fupr-resize:750:1148.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_565238507218d84fbaed38df70f07af3_sx_148505_www750-1032~tplv-5mmsx3fupr-resize:750:1032.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_2310b616876883a19706b87a0cf211a6_sx_147322_www750-1034~tplv-5mmsx3fupr-resize:750:1034.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_2fcc5363b8ca97dbc1e3610f63b9ecef_sx_146649_www750-1036~tplv-5mmsx3fupr-resize:750:1036.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_af2a85d451e103c23719cfa3c419197f_sx_160713_www750-1340~tplv-5mmsx3fupr-resize:750:1340.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_d48b5c032f5fc51df376b35167e3062c_sx_157996_www750-1260~tplv-5mmsx3fupr-resize:750:1260.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_e0207a7a2046fff132cca24952d37aa0_sx_122472_www750-944~tplv-5mmsx3fupr-resize:750:944.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_6cb58f695e130b9b2a323b00149caf56_sx_101877_www750-846~tplv-5mmsx3fupr-resize:750:846.jpeg\"><img class=\"product-big-img-list__every-img\" src=\"https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_067b0161c49c7cf9e868039cfefe905e_sx_75965_www750-602~tplv-5mmsx3fupr-resize:750:602.jpeg\"><button>加入购物车</button></body></html>";

const productHtml = `<!doctype html><html><head><meta property="og:image" content="/images/main.jpg"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', name: '商店' }, { '@type': ['Thing', 'Product'], name: '轻便猫砂盆 & 家用', description: '适合室内使用', brand: { name: '例子品牌' }, sku: 'CAT-1', image: ['/images/main.jpg', { contentUrl: '//cdn.example.com/detail.webp', caption: '细节' }], offers: [{ price: 99.5, priceCurrency: 'CNY' }], additionalProperty: [{ name: '容量', value: 12, unitText: 'L' }] }] })}</script></head><body><img data-src="../detail/one.jpg" src="data:image/gif;base64,abc" alt="商品结构"><img srcset="/small.jpg 200w, /large.jpg 1600w" alt="尺寸"><img src="/logo.png" class="logo"><img src="/tracking.png" width="1" height="1"></body></html>`;

test('解析 JSON-LD @graph 商品、规格以及去重的主图和懒加载详情图', () => {
  const result = parseProductHtml(productHtml, 'https://shop.example.com/products/one');
  assert.equal(result.title, '轻便猫砂盆 & 家用');
  assert.equal(result.brand, '例子品牌');
  assert.equal(result.sku, 'CAT-1');
  assert.equal(result.price, '99.5');
  assert.equal(result.currency, 'CNY');
  assert.deepEqual(result.specifications, [{ name: '容量', value: '12 L' }]);
  assert.equal(result.images.length, 4);
  assert.deepEqual(result.images.map(item => item.url), ['https://shop.example.com/images/main.jpg', 'https://cdn.example.com/detail.webp', 'https://shop.example.com/detail/one.jpg', 'https://shop.example.com/large.jpg']);
  assert.equal(result.images[0].kind, 'main');
  assert.equal(result.images[2].kind, 'detail');
  assert.ok(!Number.isNaN(Date.parse(result.fetchedAt)));
});

test('支持顶层数组、meta 商品降级与实体解码，拒绝危险图片协议', () => {
  const array = parseProductHtml('<script type="application/ld+json">[{"@type":"Product","name":"<b>测试</b>","image":["javascript:alert(1)","/real.png"]}]</script>', 'https://example.com');
  assert.equal(array.title, '测试');
  assert.equal(array.images.length, 1);
  const meta = parseProductHtml('<meta property="og:type" content="product"><meta property="og:title" content="杯子 &amp; 茶具"><meta name="description" content="简单&#x4E2D;文"><meta property="product:price:amount" content="28"><meta property="og:image" content="/a.jpg">', 'https://example.com/p');
  assert.equal(meta.title, '杯子 & 茶具');
  assert.equal(meta.description, '简单中文');
  assert.equal(meta.price, '28');
});

test('普通页面、空壳动态页面和登录/验证码页面不会伪成功', () => {
  for (const html of ['<title>普通新闻</title><img src="/a.jpg">', '<title>网上商城</title><div id="app"></div>', '<title>安全验证</title>请完成以下验证', '<title>商品</title>请先登录后继续']) {
    assert.throws(() => parseProductHtml(html, 'https://example.com'), /手动上传/);
  }
  assert.throws(() => parseProductHtml('<title>例子</title>', 'file:///etc/passwd'), { code: 'PRODUCT_URL_INVALID' });
});

test('候选图限制为40，缺图保留明确的补全提示', () => {
  const html = '<meta property="og:type" content="product"><title>商品</title>' + Array.from({ length: 60 }, (_, i) => `<img src="/${i}.jpg">`).join('');
  assert.equal(parseProductHtml(html, 'https://example.com').images.length, 40);
  const empty = parseProductHtml('<script type="application/ld+json">{"@type":"Product","name":"无图商品"}</script>', 'https://example.com');
  assert.ok(empty.warnings.some(message => /未读取到商品图片/.test(message)));
});

test('明确 promotion/product_info 嵌入数据支持主图详情图，推荐列表不冒充当前商品', () => {
  const state = { data: { promotion: { product_info: { product_id: '123', name: '家用收纳箱', imgs: [{ url_list: ['//cdn.example.com/main.png'] }], detail_images: ['/detail.png'], price: 19900, description: '透明盖板' } }, recommendations: [{ name: '其他商品', imgs: ['/other.jpg'] }] } };
  const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(state))}</script>`;
  const parsed = parseProductHtml(html, 'https://example.com/item');
  assert.equal(parsed.title, '家用收纳箱');
  assert.equal(parsed.price, '');
  assert.equal(parsed.sku, '123');
  assert.deepEqual(parsed.images.map(image => image.kind), ['main', 'detail']);
  assert.ok(parsed.images.every(image => !image.url.includes('other')));
  assert.throws(() => parseProductHtml('<script type="application/json">{"recommendations":[{"promotion":{"name":"其他商品","imgs":["/other.jpg"]}}]}</script>', 'https://example.com'), { code: 'PRODUCT_NOT_FOUND' });
  assert.throws(() => parseProductHtml('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","name":"推荐商品","image":"/other.jpg"}]}</script>', 'https://example.com'), { code: 'PRODUCT_NOT_FOUND' });
});

test('公开URL校验返回固定地址与归一化URL，拒绝内网且支持取消', async () => {
  assert.deepEqual(await validatePublicUrl('https://8.8.8.8/p#section'), { url: 'https://8.8.8.8/p', hostname: '8.8.8.8', addresses: [{ address: '8.8.8.8', family: 4 }] });
  await assert.rejects(validatePublicUrl('http://[::1]/'), { code: 'PRODUCT_URL_PRIVATE' });
  const controller = new AbortController();
  controller.abort(new Error('停止预检'));
  await assert.rejects(validatePublicUrl('https://example.com/', { signal: controller.signal }), /停止预检/);
});

test('真实抖音商品渲染DOM提取5张背景主图、9张详情图和产品参数，不猜测隐藏价格', () => {
  const html = douyinRenderedFixture;
  const result = parseProductHtml(html, 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3854345420239143257&origin_type=604');
  assert.equal(result.title, '彩色羽毛逗猫棒长杆带铃铛自嗨解闷耐咬猫咪宠物玩具');
  assert.equal(result.images.filter(item => item.kind === 'main').length, 5);
  assert.equal(result.images.filter(item => item.kind === 'detail').length, 9);
  assert.equal(result.images.length, 14);
  assert.ok(result.images[0].url.includes('jpeg_m_25cffc497053b962e27255294838c428'));
  assert.ok(result.images[5].url.includes('jpeg_m_8769a27f82314d5d0693724638cce70d'));
  assert.ok(result.images.every(item => !item.url.includes('product_detail_head') && !item.url.includes('xianhuo') && !item.url.includes('cad77dbf')));
  assert.deepEqual(result.specifications, [{ name: '材质', value: 'PP' }, { name: '货号', value: 'FSFSFA' }]);
  assert.equal(result.sku, 'FSFSFA');
  assert.equal(result.brand, '');
  assert.equal(result.price, '');
  assert.equal(result.currency, '');
  assert.ok(result.warnings.some(warning => /未公开完整价格/.test(warning)));
});

test('相同真实DOM只有明确数字价格时才输出价格，不把店铺名当品牌', () => {
  const html = douyinRenderedFixture.replace('price-line__price-container__price__amount">?</div>', 'price-line__price-container__price__amount">19.90</div>');
  const result = parseProductHtml(html, 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3854345420239143257');
  assert.equal(result.price, '19.90');
  assert.equal(result.currency, 'CNY');
  assert.equal(result.brand, '');
});

test('拒绝本机、私网、保留和IPv4映射IPv6，允许公开地址', () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.2.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001::1', '2002:7f00:1::', '3fff::1']) assert.equal(__testing.isPublicIp(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(__testing.isPublicIp(address), true, address);
});

const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];
function mockRequest(responses, observed = []) {
  return (url, options, callback) => {
    observed.push({ url: url.href, options });
    const req = new EventEmitter();
    req.end = () => {
      const item = responses.shift();
      const response = Readable.from(item.body === undefined ? [] : [Buffer.from(item.body)]);
      response.statusCode = item.status || 200;
      response.headers = item.headers || { 'content-type': 'text/html' };
      queueMicrotask(() => callback(response));
    };
    return req;
  };
}

test('逐跳检查地址，不请求内网重定向或混合DNS地址', async () => {
  const observed = [];
  const client = __testing.createClient({ lookup: publicLookup, request: mockRequest([{ status: 302, headers: { location: 'http://127.0.0.1/private' } }], observed) });
  await assert.rejects(client.collectProduct('https://example.com/item'), { code: 'PRODUCT_URL_PRIVATE' });
  assert.equal(observed.length, 1);
  const mixed = __testing.createClient({ lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request: () => { throw Error('不应发出请求'); } });
  await assert.rejects(mixed.collectProduct('https://example.com'), { code: 'PRODUCT_URL_PRIVATE' });
  for (const url of ['http://[::1]/', 'http://localhost/', 'http://0x7f000001/', 'ftp://example.com/', 'https://user:password@example.com/']) await assert.rejects(client.collectProduct(url));
});

test('真实本地HTTP测试夹具经注入传输读取，生产校验仍固定公开DNS地址', async t => {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(productHtml); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let pinnedAddress;
  const progress = [];
  const client = __testing.createClient({ lookup: publicLookup, request: (url, options, callback) => {
    options.lookup(url.hostname, {}, (_err, address) => { pinnedAddress = address; });
    return http.request(`http://127.0.0.1:${server.address().port}/fixture`, { signal: options.signal }, callback);
  } });
  const result = await client.collectProduct('https://shop.example.com/products/one', { progress: item => progress.push(item.phase) });
  assert.equal(pinnedAddress, '8.8.8.8');
  assert.equal(result.title, '轻便猫砂盆 & 家用');
  assert.deepEqual(progress, ['fetch', 'parse']);
});

test('拒绝声明和流式超限、非网页以及HTTP错误', async () => {
  for (const response of [{ headers: { 'content-type': 'text/html', 'content-length': String(9 * 1024 * 1024) }, body: '' }, { headers: { 'content-type': 'text/html' }, body: Buffer.alloc(8 * 1024 * 1024 + 1) }]) {
    const client = __testing.createClient({ lookup: publicLookup, request: mockRequest([response]) });
    await assert.rejects(client.collectProduct('https://example.com'), { code: 'PRODUCT_SOURCE_TOO_LARGE' });
  }
  for (const response of [{ headers: { 'content-type': 'application/json' }, body: '{}' }, { status: 403 }]) {
    const client = __testing.createClient({ lookup: publicLookup, request: mockRequest([response]) });
    await assert.rejects(client.collectProduct('https://example.com'));
  }
});

test('DNS查询可取消和超时，已取消任务不发送请求', async () => {
  const client = __testing.createClient({ lookup: () => new Promise(() => {}), timeoutMs: 20 });
  await assert.rejects(client.collectProduct('https://example.com'), { code: 'PRODUCT_SOURCE_TIMEOUT' });
  const controller = new AbortController();
  const promise = client.collectProduct('https://example.com', { signal: controller.signal });
  controller.abort(new Error('用户停止'));
  await assert.rejects(promise, /用户停止/);
});

test('图片下载验证类型、魔数和20MB限制', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const client = __testing.createClient({ lookup: publicLookup, request: mockRequest([{ headers: { 'content-type': 'image/png' }, body: png }, { headers: { 'content-type': 'image/png' }, body: '<html>登录</html>' }, { headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' }, { headers: { 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024 + 1) } }]) });
  const result = await client.downloadProductImage('https://cdn.example.com/a.png');
  assert.deepEqual(result.bytes, png);
  assert.equal(result.contentType, 'image/png');
  await assert.rejects(client.downloadProductImage('https://cdn.example.com/fake.png'), { code: 'PRODUCT_IMAGE_INVALID' });
  await assert.rejects(client.downloadProductImage('https://cdn.example.com/a.svg'), { code: 'PRODUCT_CONTENT_TYPE' });
  await assert.rejects(client.downloadProductImage('https://cdn.example.com/big.jpg'), { code: 'PRODUCT_SOURCE_TOO_LARGE' });
});
