const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createLicenseManager, normalizeSerial, hardwareFactors, factorsFromMachineCode, collectHardware, readLicense} = require('../server/license.cjs');

const hardware = {baseboard: '/board-123/', bios: 'bios456', processor: 'cpu789'};
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'superip-license-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  // 私钥只在测试内存生成，不写源码、临时文件或生产数据。
  const pair = crypto.generateKeyPairSync('ed25519'), aesKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: text => {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString: bytes => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
  const defaults = {root, safeStorage, publicKey: pair.publicKey.export({type: 'spki', format: 'der'}).toString('base64'), hardwareProvider: async () => hardware, now: () => new Date('2026-11-25T08:00:00.000Z')};
  const sign = (changes = {}, signingKey = pair.privateKey) => {
    const payload = {version: 1, tier: 'basic', factors: hardwareFactors(hardware), issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: null, ...changes};
    const segment = Buffer.from(JSON.stringify(payload)).toString('base64url'), signed = 'SIP1.' + segment;
    return signed + '.' + crypto.sign(null, Buffer.from(signed), signingKey).toString('base64url');
  };
  return {root, safeStorage, pair, defaults, sign, manager: createLicenseManager({...defaults, ...options})};
}

test('序列号统一大小写和分隔符，归一化幂等，厂商占位值按缺失处理', () => {
  const expected = 'ABC123XYZ';
  for (const input of ['/aBc/123/xYz/', '  abc : 123 . xyz , ', 'ABC-123_XYZ', 'ABC\\123\\XYZ']) {
    assert.equal(normalizeSerial(input), expected);
    assert.equal(normalizeSerial(normalizeSerial(input)), expected);
  }
  for (const input of ['', null, undefined, ' To be filled by O.E.M. ', 'Default string', 'None', 'System Serial Number']) assert.equal(normalizeSerial(input), '');
});

test('机器码固定64字符且仅包含三项摘要，可解析供独立出码工具使用', async t => {
  const f = fixture(t), code = await f.manager.machineCode();
  assert.equal(code.length, 64);
  assert.deepEqual(factorsFromMachineCode(code), hardwareFactors(hardware));
  assert.equal(Buffer.from(code, 'base64').toString(), hardwareFactors(hardware).join(''));
  assert(!code.includes('board-123'));
  for (const invalid of ['', code + '=', 'x'.repeat(64)]) assert.throws(() => factorsFromMachineCode(invalid), /无法生成机器码/);
});

test('正确Ed25519码验签通过，加密落盘后新manager读取且永久授权无到期日', async t => {
  const f = fixture(t), code = f.sign(), result = await f.manager.activate(code);
  assert.equal(result.active, true); assert.equal(result.permanent, true); assert.equal(result.expiresAt, null);
  const bytes = fs.readFileSync(path.join(f.root, 'license.dat'));
  assert(!bytes.includes(Buffer.from(code))); assert(!bytes.includes(Buffer.from('SIP1.')));
  assert.equal((await createLicenseManager(f.defaults).info()).active, true);
  assert.equal((await f.manager.verifyLicense(code)).tier, 'basic');
});

test('篡改payload一字节、签名一字节或使用另一私钥签名均拒绝', async t => {
  const f = fixture(t), code = f.sign(), parts = code.split('.'), signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 1;
  const changed = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); changed.tier = 'pro';
  for (const invalid of [parts[0] + '.' + Buffer.from(JSON.stringify(changed)).toString('base64url') + '.' + parts[2], parts[0] + '.' + parts[1] + '.' + signature.toString('base64url'), f.sign({}, crypto.generateKeyPairSync('ed25519').privateKey)]) {
    await assert.rejects(f.manager.activate(invalid), error => error.code === 'LICENSE_INVALID_SIGNATURE');
  }
  assert.equal(fs.existsSync(path.join(f.root, 'license.dat')), false);
});

test('换机器失败；换一件硬件和三因子缺一时2/3匹配通过', async t => {
  const f = fixture(t), code = f.sign();
  const missing = createLicenseManager({...f.defaults, hardwareProvider: async () => ({...hardware, bios: 'None'})});
  const state = await missing.activate(code);
  assert.equal(state.active, true); assert.deepEqual(state.missingFactors, ['bios']);
  assert.equal((await createLicenseManager({...f.defaults, hardwareProvider: async () => ({...hardware, baseboard: 'replacement'})}).verifyLicense(code)).tier, 'basic');
  const changed = createLicenseManager({...f.defaults, hardwareProvider: async () => ({baseboard: 'other1', bios: 'other2', processor: hardware.processor})});
  await assert.rejects(changed.verifyLicense(code), error => error.code === 'LICENSE_MACHINE_MISMATCH');
});

test('签发机器缺失一个因子时可用另外两个匹配，零摘要不参与计票', async t => {
  const f = fixture(t), code = f.sign({factors: hardwareFactors({...hardware, processor: ''})});
  assert.equal((await f.manager.verifyLicense(code)).version, 1);
  const unavailable = createLicenseManager({...f.defaults, hardwareProvider: async () => ({baseboard: hardware.baseboard})});
  const info = await unavailable.info(); assert.equal(info.active, false); assert.equal(info.machineCode, '');
  await assert.rejects(unavailable.machineCode(), /无法生成机器码，请检查系统信息读取权限/);
  await assert.rejects(unavailable.verifyLicense(code), error => error.code === 'LICENSE_MACHINE_UNAVAILABLE');
});

test('DPAPI解密失败降级中文未激活状态，可覆盖坏文件恢复授权', async t => {
  const f = fixture(t), file = path.join(f.root, 'license.dat'); fs.writeFileSync(file, '另一Windows账户的密文');
  const state = await f.manager.info(); assert.equal(state.status, 'unreadable'); assert.equal(state.active, false);
  assert.equal(state.message, '授权文件无法读取，请重新输入激活码');
  assert.equal((await f.manager.activate(f.sign())).active, true);
  assert.equal((await createLicenseManager(f.defaults).info()).active, true);
});

test('有限3650天不标为永久，过期和未来签发日拒绝，缓存也会在到期时失效', async t => {
  let date = '2026-11-25T08:00:00.000Z'; const f = fixture(t, {now: () => new Date(date)});
  const finite = f.sign({expiresAt: '2035-12-30T00:00:00.000Z'});
  assert.equal((await f.manager.activate(finite)).permanent, false);
  await assert.rejects(f.manager.verifyLicense(f.sign({issuedAt: '2027-01-01T00:00:00.000Z'})), error => error.code === 'LICENSE_NOT_YET_VALID');
  await assert.rejects(f.manager.verifyLicense(f.sign({expiresAt: '2026-02-01T00:00:00.000Z'})), error => error.code === 'LICENSE_EXPIRED');
  date = '2035-12-30T00:00:00.000Z'; assert.equal((await f.manager.info()).status, 'expired');
  await assert.rejects(f.manager.assert('exportAsset'), /授权已到期/);
});

test('未激活只放行固定五项白名单，白名单不触发硬件采集', async t => {
  let collections = 0; const f = fixture(t, {hardwareProvider: async () => { collections++; return hardware; }});
  for (const action of ['state', 'licenseActivate', 'licenseInfo', 'saveLocalEnvironment', 'checkMedia']) assert.equal(await f.manager.assert(action), true);
  assert.equal(collections, 0);
  for (const action of ['exportAsset', 'publish', 'extractAssets', 'workflowStart', 'saveSettings', '__proto__', 'STATE']) await assert.rejects(f.manager.assert(action), error => error.code === 'LICENSE_REQUIRED' && error.message === '软件未激活，请先输入激活码');
  assert.equal(collections, 1);
});

test('同时info和machineCode只采集一次，授权结果缓存不随外部文件变动重新读取', async t => {
  let reads = 0; const f = fixture(t, {hardwareProvider: async () => { reads++; await new Promise(resolve => setImmediate(resolve)); return hardware; }});
  await Promise.all([f.manager.info(), f.manager.info(), f.manager.machineCode()]); assert.equal(reads, 1);
  await f.manager.activate(f.sign()); fs.writeFileSync(path.join(f.root, 'license.dat'), '外部修改');
  assert.equal((await f.manager.info()).active, true); assert.equal(await f.manager.assert('exportAsset'), true);
  assert.equal((await createLicenseManager(f.defaults).info()).status, 'unreadable');
});

test('采集使用execFile且失败只重试一次，超时不会无限等待', async () => {
  let attempts = 0;
  const result = await collectHardware((program, args, options, callback) => {
    attempts++; assert.equal(program, 'powershell.exe'); assert(args.includes('-NoProfile')); assert.equal(options.windowsHide, true); assert(options.timeout <= 10000);
    callback(new Error('读取失败')); return {kill() {}};
  });
  assert.equal(attempts, 2); assert.deepEqual(result, {});
  let killed = 0, timeouts = 0;
  const limited = await collectHardware(() => { timeouts++; return {kill: () => killed++}; }, {attemptTimeoutMs: 5, budgetMs: 50});
  assert.deepEqual(limited, {}); assert.equal(timeouts, 2); assert.equal(killed, 2);
});

test('采集第二次成功可用，畸形硬件返回不阻止未激活状态读取', async t => {
  let attempts = 0; const raw = await collectHardware((program, args, options, callback) => {
    if (++attempts === 1) callback(Error('暂时失败')); else callback(null, '\uFEFF' + JSON.stringify(hardware));
    return {kill() {}};
  }); assert.deepEqual(raw, hardware);
  const f = fixture(t, {hardwareProvider: async () => null}); assert.equal((await f.manager.info()).status, 'machine-unavailable');
});

test('加密服务不可用时不写明文，写盘失败保留旧授权与当前缓存', async t => {
  const f = fixture(t), original = f.sign(); await f.manager.activate(original);
  const file = path.join(f.root, 'license.dat'), before = fs.readFileSync(file), rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => { if (target === file) throw Object.assign(Error('内部路径不得外露'), {code: 'ENOSPC'}); return rename(source, target); });
  await assert.rejects(f.manager.activate(f.sign({tier: 'pro'})), error => error.code === 'LICENSE_SAVE_FAILED' && !error.message.includes(f.root));
  assert.deepEqual(fs.readFileSync(file), before); assert.equal((await f.manager.info()).tier, 'basic');
  assert.equal(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')).length, 0);
  const unavailable = createLicenseManager({...f.defaults, safeStorage: {...f.safeStorage, isEncryptionAvailable: () => false}});
  await assert.rejects(unavailable.activate(original), error => error.code === 'LICENSE_SAVE_FAILED'); assert.deepEqual(fs.readFileSync(file), before);
});

test('未知版本、档位、日期、缺失永久字段与畸形编码均拒绝', async t => {
  const f = fixture(t);
  for (const changes of [{version: 2}, {tier: 'invented'}, {issuedAt: 'bad'}, {expiresAt: undefined}, {expiresAt: '2025-01-01T00:00:00.000Z'}, {factors: ['0', '1', '2']}]) await assert.rejects(f.manager.verifyLicense(f.sign(changes)), error => error.code === 'LICENSE_INVALID');
  for (const code of ['', null, 'SIP1.a.??', 'SIP1.aaa=.aaa', 'x'.repeat(17000)]) await assert.rejects(f.manager.verifyLicense(code), /激活码/);
});

test('没有公钥只让激活返回配置错误，未激活info正常；并发激活按提交顺序落盘', async t => {
  const f = fixture(t), noKey = createLicenseManager({...f.defaults, publicKey: {}});
  assert.equal((await noKey.info()).active, false);
  await assert.rejects(noKey.activate(f.sign()), error => error.code === 'LICENSE_KEY_UNAVAILABLE');
  const first = f.manager.activate('无效码'), second = f.manager.activate(f.sign({tier: 'pro'}));
  await assert.rejects(first, /激活码/); assert.equal((await second).tier, 'pro');
  assert.equal(readLicense(f.root, f.safeStorage).code, f.sign({tier: 'pro'}));
});

test('重启读取已过期授权仍显示签名验证过的档位与到期日，但不放行业务', async t => {
  const f = fixture(t), expiresAt = '2026-12-01T00:00:00.000Z'; await f.manager.activate(f.sign({tier: 'pro', expiresAt}));
  const reboot = createLicenseManager({...f.defaults, now: () => new Date('2027-01-01T00:00:00.000Z')}), state = await reboot.info();
  assert.equal(state.status, 'expired'); assert.equal(state.tier, 'pro'); assert.equal(state.expiresAt, expiresAt); assert.equal(state.active, false); assert.equal(state.permanent, false);
  await assert.rejects(reboot.assert('publish'), /授权已到期/);
});

test('CIM首次部分因子为空时补采一次，合并有效因子后缓存正确机器码', async t => {
  const f = fixture(t); let attempts = 0;
  const manager = createLicenseManager({...f.defaults, hardwareProvider: undefined, execFile: (program, args, options, callback) => {
    const values = ++attempts === 1 ? {baseboard: '', bios: 'Default string', processor: hardware.processor} : {...hardware, processor: ''};
    callback(null, JSON.stringify(values)); return {kill() {}};
  }});
  const [state, code] = await Promise.all([manager.info(), manager.machineCode()]);
  assert.equal(attempts, 2); assert.deepEqual(state.missingFactors, []);
  assert.deepEqual(factorsFromMachineCode(code), hardwareFactors(hardware));
  assert.equal((await manager.verifyLicense(f.sign())).tier, 'basic');
  await manager.info(); assert.equal(attempts, 2);
});

test('补采仍缺失或进程失败不丢首次有效因子，最多两次后按真实缺失处理', async () => {
  for (const secondFails of [false, true]) {
    let attempts = 0;
    const result = await collectHardware((program, args, options, callback) => {
      if (++attempts === 1) callback(null, JSON.stringify({baseboard: hardware.baseboard, bios: '', processor: 'None'}));
      else if (secondFails) callback(Error('补采失败'));
      else callback(null, JSON.stringify({baseboard: '', bios: 'Default string', processor: ''}));
      return {kill() {}};
    });
    assert.equal(attempts, 2); assert.equal(result.baseboard, hardware.baseboard);
    assert.equal(hardwareFactors(result).filter(value => value !== '0000000000000000').length, 1);
  }
});

test('首次因子齐备不重复采集，补采只填缺失项而不覆盖首次有效值', async () => {
  let fullCalls = 0;
  assert.deepEqual(await collectHardware((program, args, options, callback) => { fullCalls++; callback(null, JSON.stringify(hardware)); return {kill() {}}; }), hardware);
  assert.equal(fullCalls, 1);
  let partialCalls = 0;
  const result = await collectHardware((program, args, options, callback) => {
    callback(null, JSON.stringify(++partialCalls === 1 ? {...hardware, bios: ''} : {...hardware, baseboard: '补采不同主板', processor: '补采不同CPU'}));
    return {kill() {}};
  });
  assert.equal(partialCalls, 2); assert.deepEqual(result, hardware);
});

test('部分采集补采共用整体预算，预算耗尽不再启动进程', async t => {
  let clock = 0, attempts = 0; t.mock.method(Date, 'now', () => clock);
  const result = await collectHardware((program, args, options, callback) => {
    attempts++; assert.equal(options.timeout, 50); clock = 51;
    callback(null, JSON.stringify({baseboard: hardware.baseboard})); return {kill() {}};
  }, {attemptTimeoutMs: 100, budgetMs: 50});
  assert.equal(attempts, 1); assert.equal(result.baseboard, hardware.baseboard);
});
