const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {createLicenseManager} = require('../server/license.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-release-guard-'));
  const listeners = new Set(process.listeners('exit'));
  t.after(() => { for (const listener of process.listeners('exit')) if (!listeners.has(listener)) process.removeListener('exit', listener); fs.rmSync(root, {recursive: true, force: true}); });
  const entry = path.resolve(__dirname, '../server/service.cjs'), entryRequire = createRequire(entry), module = {exports: {}};
  let constructions = 0;
  // 仅替换硬件采集与系统加密边界，仍使用真实manager与service默认构造分支。
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {module, exports: module.exports, require: name => name === './license.cjs' ? {createLicenseManager: options => { constructions++; return createLicenseManager({...options, hardwareProvider: async () => ({baseboard: 'TEST-BOARD', bios: 'TEST-BIOS', processor: 'TEST-CPU'})}); }} : entryRequire(name), __dirname: path.dirname(entry), process, console, Buffer, AbortController, AbortSignal, setTimeout, clearTimeout, structuredClone, URL});
  const service = module.exports.createService(root);
  assert.equal(constructions, 1, '生产默认路径必须实际构造授权manager');
  return {root, service};
}

test('真实invoke默认生产guard严格放行白名单，未授权副作用处理器零调用', async t => {
  const {service} = fixture(t), info = await service.invoke('licenseInfo'); assert.equal(info.active, false);
  let allowed = 0, denied = 0;
  for (const action of ['state', 'licenseInfo', 'licenseActivate', 'saveLocalEnvironment', 'checkMedia']) {
    service.handlers[action] = () => { allowed++; return action; };
    assert.equal(await service.invoke(action), action);
  }
  for (const action of ['exportPackage', 'publish', 'startExtractBatch', 'startWorkflow', 'generateStoryImage', 'generateStoryVideo', 'speech', 'saveSettings', 'restoreBackup']) {
    service.handlers[action] = () => { denied++; return '不得到达'; };
    await assert.rejects(service.invoke(action, {license: {active: true}, activated: true, bypassLicense: true}), /软件未激活，请先输入激活码/);
  }
  assert.equal(allowed, 5); assert.equal(denied, 0); assert.equal(service.store.data.runs.length, 0);
});

test('直接导入入口也必须先授权，不得先读取文件或登记素材', async t => {
  const {service, root} = fixture(t), before = structuredClone(service.store.data.assets);
  await assert.rejects(service.importPath(path.join(root, '不存在但不应读取.png')), /软件未激活，请先输入激活码/);
  assert.deepEqual(service.store.data.assets, before);
});

test('生产service即使没有license.dat也不能依靠action名称或payload伪造授权', async t => {
  const {service} = fixture(t);
  for (const action of ['constructor', '__proto__', 'toString', 'licenseInfo ', 'state\n', 'LICENSEINFO']) await assert.rejects(service.invoke(action, {code: 'bypass', skipLicense: true}), /软件未激活，请先输入激活码/);
  assert.equal((await service.invoke('licenseInfo')).active, false);
});

test('Electron直接IPC与媒体协议在副作用前授权，不能绕过invoke导出或操作平台', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-release-ipc-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const entry = path.resolve(__dirname, '../electron/main.cjs'), entryRequire = createRequire(entry);
  const ipc = new Map(), protocols = new Map(), windows = [];
  let effects = 0, startupError;
  const license = createLicenseManager({root, hardwareProvider: async () => ({baseboard: 'BOARD', bios: 'BIOS', processor: 'CPU'})});
  const effect = () => { effects++; return ''; };
  class BrowserWindow {
    constructor() { windows.push(this); this.webContents = {setWindowOpenHandler() {}, on() {}}; }
    setMenu() {} once() {} loadFile() {} loadURL() { effects++; } show() {}
  }
  const safeStorage = {isEncryptionAvailable: () => true};
  const electron = {
    app: {setName() {}, requestSingleInstanceLock: () => true, quit() {}, on() {}, whenReady: () => Promise.resolve(), isPackaged: true, getPath: () => root},
    BrowserWindow, safeStorage,
    ipcMain: {handle: (name, work) => ipc.set(name, work), on() {}},
    protocol: {registerSchemesAsPrivileged() {}, handle: (name, work) => protocols.set(name, work)},
    dialog: {showOpenDialog: async () => { effects++; return {canceled: true}; }, showErrorBox: (_title, error) => { startupError = error; }},
    shell: {showItemInFolder: effect, openPath: async () => effect()}
  };
  const fakeService = {license, localEnvironment: {start: async () => {}, close() {}}, media: {}, store: {asset: () => { effects++; return {path: '不得访问'}; }, outputDir: effect}, importPath: effect, invoke: action => license.assert(action)};
  const stubs = {
    '../server/service.cjs': {createService: (dataRoot, _secrets, options) => { assert.equal(dataRoot, path.join(root, 'studio')); assert.equal(options.safeStorage, safeStorage); return fakeService; }},
    '../server/provider-keys.cjs': {encryptedSecrets: () => ({})},
    './video-parser-browser.cjs': {VideoParserBrowser: class {}},
    './product-browser.cjs': {ProductBrowser: class {}},
    './account-browser.cjs': {AccountBrowser: class {}},
    './cover-worker.cjs': {coverRenderer: () => () => {}},
    './voice-drop.cjs': {createVoiceDropImporter: () => effect},
    './export-asset.cjs': {exportAsset: effect}
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {require: name => name === 'electron' ? electron : Object.hasOwn(stubs, name) ? stubs[name] : entryRequire(name), __dirname: path.dirname(entry), process: {argv: [], env: {}}, console: {error() {}}, URL, Response});
  await new Promise(setImmediate); assert.equal(startupError, undefined); assert.equal(windows.length, 1);
  const event = {sender: windows[0].webContents};
  for (const [name, args] of [
    ['studio:pickFiles', ['image']], ['studio:dropVoice', ['不得访问.wav']], ['studio:revealAsset', ['asset']], ['studio:directory', []], ['studio:exportAsset', ['asset', {}]], ['studio:output', []], ['studio:open-platform-home', ['douyin']]
  ]) {
    assert(ipc.has(name), '原生IPC未登记：' + name);
    await assert.rejects(ipc.get(name)(event, ...args), /软件未激活，请先输入激活码/);
  }
  await assert.rejects(ipc.get('studio:exportAsset')({sender: {}}, 'asset'), /窗口来源无效/);
  const media = await protocols.get('media')({url: 'media://asset/asset'}); assert.equal(media.status, 404);
  assert.equal(effects, 0); assert.equal(windows.length, 1, '未激活不能新建平台窗口');
});
