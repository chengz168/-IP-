const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createLicenseManager, normalizeSerial, hardwareFactors, readLicense} = require('../server/license.cjs');
const {issueLicense, parseArgs, ensureKeyPair, assertPrivateIgnored, checkRelease, cliErrorMessage} = require('../scripts/make-license.cjs');

const raw = {baseboard: '/BOARD / 123/', bios: 'BIO-4567', processor: 'CPU:890'};
const date = new Date('2026-11-25T12:00:00.000Z');
const machine = values => Buffer.from(hardwareFactors(values).join('')).toString('base64');
const decode = code => JSON.parse(Buffer.from(code.split('.')[1], 'base64url').toString());
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sip-release-license-')); t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root; }
function storage() {
  return {isEncryptionAvailable: () => true, encryptString: value => Buffer.from('隔离测试：' + value), decryptString: bytes => { const value = bytes.toString(); if (!value.startsWith('隔离测试：')) throw Error('DPAPI失败'); return value.slice(5); }};
}
function fixture(t, values = raw) {
  const root = temp(t), pair = crypto.generateKeyPairSync('ed25519');
  const safeStorage = storage(), clock = {value: date};
  const manager = createLicenseManager({root, publicKey: pair.publicKey, safeStorage, hardwareProvider: async () => values, now: () => clock.value});
  const issue = options => issueLicense({machine: machine(raw), privateKey: pair.privateKey, now: date, ...options});
  return {root, pair, safeStorage, clock, manager, issue};
}
function repository(t, ignore = '*.pem\n') {
  const root = temp(t);
  execFileSync('git', ['init', '--quiet', root], {windowsHide: true, stdio: 'pipe'});
  fs.writeFileSync(path.join(root, '.gitignore'), ignore);
  return root;
}

test('发行出码与真实授权模块互通：正确永久码通过，发行私钥不参与客户端验签', async t => {
  const f = fixture(t), code = f.issue();
  assert.equal(decode(code).expiresAt, null);
  const result = await f.manager.activate(code);
  assert.equal(result.active, true); assert.equal(result.permanent, true); assert.equal(result.tier, 'basic');
  assert.equal(Buffer.from(code.split('.')[2], 'base64url').length, 64);
  const reboot = createLicenseManager({root: f.root, publicKey: f.pair.publicKey, safeStorage: f.safeStorage, hardwareProvider: async () => raw, now: () => date});
  assert.equal((await reboot.info()).active, true);
});

test('发行激活码payload或签名单字节篡改均拒绝，不能更改档位或期限', async t => {
  const f = fixture(t), parts = f.issue().split('.'), payload = decode(parts.join('.'));
  payload.tier = 'enterprise';
  await assert.rejects(f.manager.verifyLicense([parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.')), /签名无效/);
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  await assert.rejects(f.manager.verifyLicense([parts[0], parts[1], signature.toString('base64url')].join('.')), /签名无效/);
  assert.equal((await f.manager.info()).active, false);
});

test('发行跨机器拒绝，缺失一因子或更换单件仍按真实2/3匹配通过', async t => {
  const other = fixture(t, {baseboard: 'OTHER', bios: 'OTHER', processor: 'OTHER'});
  await assert.rejects(other.manager.verifyLicense(other.issue()), /本机不匹配/);
  for (const factor of ['baseboard', 'bios', 'processor']) {
    for (const replacement of ['', '替换硬件']) {
      const f = fixture(t, {...raw, [factor]: replacement});
      assert.equal((await f.manager.activate(f.issue())).active, true);
    }
  }
});

test('缺失槽不参与匹配，只有一个可用因子时不能生成机器码或激活', async t => {
  const f = fixture(t, {baseboard: raw.baseboard, bios: 'None', processor: 'To be filled by O.E.M.'});
  assert.equal((await f.manager.info()).status, 'machine-unavailable');
  await assert.rejects(f.manager.machineCode(), /无法生成机器码/);
  await assert.rejects(f.manager.activate(f.issue()), /无法生成机器码/);
  assert.throws(() => issueLicense({machine: machine({baseboard: 'ONE'}), privateKey: f.pair.privateKey}), /无法生成机器码/);
});

test('序列号分隔符与大小写归一一致，占位符为空，重复归一保持幂等', () => {
  const variants = [' / ab C:12.3,\\ ', 'ABC123', 'a b/c.1:2,3'];
  for (const value of variants) { assert.equal(normalizeSerial(value), 'ABC123'); assert.equal(normalizeSerial(normalizeSerial(value)), normalizeSerial(value)); }
  for (const value of ['', 'None', 'Default string', 'System Serial Number', 'To be filled by O.E.M.']) assert.equal(normalizeSerial(value), '');
  assert.deepEqual(hardwareFactors({...raw, baseboard: variants[0]}), hardwareFactors({...raw, baseboard: variants[1]}));
});

test('显式3650天为真实有限期限，边界到期立即拦截，永久码不按3650天失效', async t => {
  const f = fixture(t), code = f.issue({days: 3650}), payload = decode(code);
  assert.equal(Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt), 3650 * 86400000);
  const state = await f.manager.activate(code); assert.equal(state.permanent, false);
  f.clock.value = new Date(Date.parse(payload.expiresAt) - 1); await f.manager.assert('exportPackage');
  f.clock.value = new Date(payload.expiresAt); await assert.rejects(f.manager.assert('exportPackage'), /已到期/);
  const permanent = fixture(t); await permanent.manager.activate(permanent.issue());
  permanent.clock.value = new Date('2099-01-01T00:00:00.000Z'); await permanent.manager.assert('exportPackage');
});

test('出码参数拒绝非法或重复天数、未知档位和畸形机器码', t => {
  const f = fixture(t);
  for (const days of [0, -1, 1.5, NaN, Infinity, 365001]) assert.throws(() => f.issue({days}), /有效天数/);
  assert.throws(() => f.issue({tier: 'root'}), /档位/);
  assert.throws(() => f.issue({machine: '无效机器码'}), /机器码/);
  for (const days of ['0', '-1', '3.5', '1e3', 'Infinity']) assert.throws(() => parseArgs(['--machine', machine(raw), '--days', days]), /有效天数/);
  assert.throws(() => parseArgs(['--machine', machine(raw), '--machine', machine(raw)]), /参数无效/);
  assert.equal(parseArgs(['--machine', machine(raw)]).days, undefined);
});

test('safeStorage解密失败返回中文状态，窗口初始化不抛错并可覆盖重新激活', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'license.dat'), '不可解密旧账户文件');
  const state = await f.manager.info(); assert.equal(state.active, false); assert.match(state.message, /授权文件无法读取，请重新输入激活码/);
  assert(!state.message.includes(f.root)); assert(!state.message.includes('Error:'));
  assert.equal((await f.manager.activate(f.issue())).active, true);
  assert.equal(readLicense(f.root, f.safeStorage).error, null);
});

test('系统加密不可用时不落明文，不误报激活成功', async t => {
  const f = fixture(t); f.safeStorage.isEncryptionAvailable = () => false;
  await assert.rejects(f.manager.activate(f.issue()), /授权保存失败/);
  assert.equal(fs.existsSync(path.join(f.root, 'license.dat')), false); assert.equal((await f.manager.info()).active, false);
});

test('未激活manager仅放行五项白名单，业务能力全部在调用前拒绝', async t => {
  const f = fixture(t);
  for (const action of ['state', 'licenseActivate', 'licenseInfo', 'saveLocalEnvironment', 'checkMedia']) assert.equal(await f.manager.assert(action), true);
  for (const action of ['exportPackage', 'publish', 'startExtractBatch', 'startWorkflow', 'speech', 'generateStoryVideo', 'saveSettings', '__proto__']) await assert.rejects(f.manager.assert(action), /软件未激活，请先输入激活码/);
});

test('授权缓存只初始化一次，校验后删文件仍用缓存但重启必须重新读盘', async t => {
  const f = fixture(t), code = f.issue(); await f.manager.activate(code);
  fs.rmSync(path.join(f.root, 'license.dat'));
  for (let index = 0; index < 5; index++) await f.manager.assert('exportPackage');
  const reboot = createLicenseManager({root: f.root, publicKey: f.pair.publicKey, safeStorage: f.safeStorage, hardwareProvider: async () => raw});
  assert.equal((await reboot.info()).active, false);
});

test('首次出码拒绝缺失忽略规则、反向忽略和已跟踪私钥', t => {
  const absent = repository(t, 'unrelated.log\n'); assert.throws(() => ensureKeyPair(absent), /私钥保护检查失败/);
  const negated = repository(t, '*.pem\n!scripts/.license-private.pem\n'); assert.throws(() => assertPrivateIgnored(negated), /私钥保护检查失败/);
  const tracked = repository(t); fs.mkdirSync(path.join(tracked, 'scripts')); fs.writeFileSync(path.join(tracked, 'scripts/.license-private.pem'), '非真实私钥夹具');
  execFileSync('git', ['-C', tracked, 'add', '--force', '--', 'scripts/.license-private.pem'], {stdio: 'pipe', windowsHide: true});
  assert.throws(() => assertPrivateIgnored(tracked), /私钥保护检查失败/);
  assert.equal(fs.existsSync(path.join(absent, 'scripts/.license-private.pem')), false);
});

test('出码工具保护现有密钥：复用、不覆盖、错配和遗失都拒绝重生成', t => {
  const root = repository(t), first = ensureKeyPair(root), file = path.join(root, 'scripts/.license-private.pem'), bytes = fs.readFileSync(file);
  assert.equal(Buffer.from(first.publicKey, 'base64').length, 44); assert.equal(ensureKeyPair(root).publicKey, first.publicKey); assert.deepEqual(fs.readFileSync(file), bytes);
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({format: 'pem', type: 'pkcs8'});
  fs.writeFileSync(file, other); assert.throws(() => ensureKeyPair(root), /不匹配/); assert.equal(fs.readFileSync(file, 'utf8'), other);
  fs.rmSync(file); assert.throws(() => ensureKeyPair(root), /发行私钥缺失/); assert.equal(fs.existsSync(file), false);
});

test('发行打包门禁拒绝未提交工作区，不能顺带提交或清理用户文件', t => {
  const root = repository(t); fs.writeFileSync(path.join(root, '原有工作.txt'), '必须保留');
  assert.throws(() => checkRelease(root), /未提交改动/);
  assert.equal(fs.readFileSync(path.join(root, '原有工作.txt'), 'utf8'), '必须保留');
});

function cliFailure(error) {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/make-license.cjs'), 'utf8');
  const start = source.indexOf('if (require.main === module)'); assert(start >= 0);
  const module = {}, result = {exitCode: 0, messages: []};
  // 执行真实CLI异常分支，只替换main抛错边界，不触碰发行密钥或正式数据。
  vm.runInNewContext(source.slice(start), {module, require: {main: module}, main() { throw error; }, cliErrorMessage, process: result, console: {error: message => result.messages.push(message)}});
  return result;
}

test('出码CLI未知英文异常转换为中文兜底，不输出路径或堆栈', () => {
  const fallback = '出码失败，请核对忽略规则、机器码、密钥与文件权限后重试';
  for (const error of [Error('Unexpected crypto failure'), Error('ENOENT'), Error('读取失败 C:\\private\\issuer.pem'), Error('读取失败 /tmp/private.pem'), Error('读取失败\n    at load (internal.cjs:1:1)')]) {
    const result = cliFailure(error); assert.equal(result.exitCode, 1); assert.deepEqual(result.messages, [fallback]);
  }
});

test('出码CLI已知中文提示保留可执行指引，发行私钥相对路径不被误过滤', () => {
  for (const message of ['档位或有效天数无效，请核对参数后重试', '私钥保护检查失败，请先在 .gitignore 忽略 scripts/.license-private.pem，并确认它未被 Git 跟踪']) {
    const result = cliFailure(Error(message)); assert.equal(result.exitCode, 1); assert.deepEqual(result.messages, [message]);
  }
});
