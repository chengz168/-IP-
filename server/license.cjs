const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');

const factorNames = ['baseboard', 'bios', 'processor'];
const factorLabels = {baseboard: '主板序列号', bios: 'BIOS序列号', processor: '处理器编号'};
const missingDigest = '0000000000000000';
const unlicensedActions = new Set(['state', 'licenseActivate', 'licenseInfo', 'saveLocalEnvironment', 'checkMedia']);
const fail = (code, message) => Object.assign(new Error(message), {code});
const machineError = () => fail('LICENSE_MACHINE_UNAVAILABLE', '无法生成机器码，请检查系统信息读取权限');

function normalizeSerial(value) {
  if (typeof value !== 'string') return '';
  const serial = value.trim().toUpperCase().replace(/[\s/\\:.,_-]+/g, '');
  return ['', 'TOBEFILLEDBYOEM', 'DEFAULTSTRING', 'NONE', 'SYSTEMSERIALNUMBER', 'UNKNOWN', 'NA', 'NOTSPECIFIED'].includes(serial) ? '' : serial;
}

function hardwareFactors(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  return factorNames.map((name, index) => {
    const value = normalizeSerial(Array.isArray(raw) ? raw[index] : raw[name]);
    return value ? crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16) : missingDigest;
  });
}

function factorsFromMachineCode(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9+/]{64}$/.test(code)) throw machineError();
  const decoded = Buffer.from(code, 'base64').toString('ascii');
  if (!/^[a-f0-9]{48}$/.test(decoded) || Buffer.from(decoded).toString('base64') !== code) throw machineError();
  const factors = decoded.match(/.{16}/g);
  if (factors.filter(value => value !== missingDigest).length < 2) throw machineError();
  return factors;
}

const hardwareScript = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$values=@{};foreach($item in @(@('baseboard','Win32_BaseBoard','SerialNumber'),@('bios','Win32_BIOS','SerialNumber'),@('processor','Win32_Processor','ProcessorId'))){try{$values[$item[0]]=Get-CimInstance $item[1] | Select-Object -First 1 -ExpandProperty $item[2]}catch{$values[$item[0]]=''}};$values | ConvertTo-Json -Compress";

async function collectHardware(run = execFile, {attemptTimeoutMs = 9000, budgetMs = 19000} = {}) {
  const deadline = Date.now() + Math.min(20000, budgetMs);
  const collected = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const timeout = Math.min(10000, attemptTimeoutMs, deadline - Date.now());
    if (timeout <= 0) break;
    try {
      const observed = await new Promise((resolve, reject) => {
        let child, settled = false;
        const finish = (error, stdout) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) return reject(error);
          try {
            const value = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw machineError();
            resolve(value);
          } catch { reject(machineError()); }
        };
        const timer = setTimeout(() => { finish(machineError()); child?.kill?.(); }, timeout);
        try {
          child = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', hardwareScript], {timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 65536}, finish);
        } catch (error) { finish(error); }
      });
      // 进程正常退出不代表三个CIM类都读取成功；补采只填缺失项，保留首次有效值。
      for (const name of factorNames) if (!normalizeSerial(collected[name]) && typeof observed[name] === 'string') collected[name] = observed[name];
      if (factorNames.every(name => normalizeSerial(collected[name]))) return collected;
    } catch { /* 只重试一次，最终按缺失因子处理，不能阻止窗口打开。 */ }
  }
  return collected;
}

function readLicense(root, safeStorage) {
  try {
    const bytes = fs.readFileSync(path.join(root, 'license.dat'));
    if (!safeStorage?.isEncryptionAvailable()) throw Error('加密不可用');
    const saved = JSON.parse(safeStorage.decryptString(bytes));
    if (saved?.version !== 1 || typeof saved.code !== 'string' || saved.code.length > 16384) throw Error('格式错误');
    return {code: saved.code, error: null};
  } catch (error) {
    if (error.code === 'ENOENT') return {code: '', error: null};
    return {code: '', error: '授权文件无法读取，请重新输入激活码'};
  }
}

function writeLicense(root, safeStorage, code) {
  let temporary;
  try {
    if (typeof code !== 'string' || !code.trim() || code.length > 16384) throw Error('格式错误');
    if (!safeStorage?.isEncryptionAvailable()) throw Error('加密不可用');
    const encrypted = safeStorage.encryptString(JSON.stringify({version: 1, code}));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw Error('加密失败');
    fs.mkdirSync(root, {recursive: true});
    const file = path.join(root, 'license.dat');
    temporary = file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, encrypted, {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
  } catch {
    throw fail('LICENSE_SAVE_FAILED', '授权保存失败，请检查系统加密服务、磁盘空间和文件权限后重试');
  } finally {
    if (temporary) try { fs.rmSync(temporary, {force: true}); } catch { /* 不用清理错误覆盖原始保存结果。 */ }
  }
}

function decodeSegment(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw fail('LICENSE_INVALID', '激活码无效，请核对完整激活码后重试');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw fail('LICENSE_INVALID', '激活码无效，请核对完整激活码后重试');
  return bytes;
}

function createLicenseManager({root, safeStorage, publicKey, hardwareProvider, now = () => new Date(), execFile: run = execFile} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail('LICENSE_CONFIG_INVALID', '授权数据目录未配置，请联系软件提供方');
  let initialized, machine, cachedPayload = null, stateMessage = '', stateCode = 'unactivated', key;
  let activationQueue = Promise.resolve();
  function time() { const date = new Date(now()); if (!Number.isFinite(date.getTime())) throw fail('LICENSE_CLOCK_INVALID', '系统时间无效，请校准系统时间后重试'); return date; }
  function verificationKey() {
    if (key) return key;
    try {
      let value = publicKey;
      if (!value) { const exported = require('./license-public-key.cjs'); value = typeof exported === 'string' ? exported : exported.publicKey; }
      key = value?.type === 'public' ? value : crypto.createPublicKey({key: Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64'), type: 'spki', format: 'der'});
      if (key.asymmetricKeyType !== 'ed25519') throw Error('公钥算法错误');
      return key;
    } catch { throw fail('LICENSE_KEY_UNAVAILABLE', '授权校验配置不可用，请联系软件提供方'); }
  }
  function verify(code, {allowExpired = false} = {}) {
    if (typeof code !== 'string' || code.length > 16384) throw fail('LICENSE_INVALID', '激活码无效，请核对完整激活码后重试');
    const parts = code.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'SIP1') throw fail('LICENSE_INVALID', '激活码无效，请核对完整激活码后重试');
    const payloadBytes = decodeSegment(parts[1]), signature = decodeSegment(parts[2]);
    if (signature.length !== 64 || !crypto.verify(null, Buffer.from('SIP1.' + parts[1]), verificationKey(), signature)) throw fail('LICENSE_INVALID_SIGNATURE', '激活码签名无效，请核对激活码或联系软件提供方');
    let payload;
    try { payload = JSON.parse(payloadBytes.toString('utf8')); } catch { throw fail('LICENSE_INVALID', '激活码无效，请核对完整激活码后重试'); }
    const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (payload?.version !== 1 || !['basic', 'pro', 'enterprise'].includes(payload.tier) || !Array.isArray(payload.factors) || payload.factors.length !== 3 || payload.factors.some(value => typeof value !== 'string' || !/^[a-f0-9]{16}$/.test(value)) || !validDate(payload.issuedAt) || !(payload.expiresAt === null || validDate(payload.expiresAt)) || payload.expiresAt !== null && Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) throw fail('LICENSE_INVALID', '激活码内容无效，请联系软件提供方重新出码');
    if (machine.factors.filter(value => value !== missingDigest).length < 2) throw machineError();
    const matches = payload.factors.filter((value, index) => value !== missingDigest && value === machine.factors[index]).length;
    if (matches < 2) throw fail('LICENSE_MACHINE_MISMATCH', '激活码与本机不匹配，请使用当前机器码申请激活码');
    const current = time().getTime();
    if (Date.parse(payload.issuedAt) > current) throw fail('LICENSE_NOT_YET_VALID', '激活码尚未生效，请核对系统日期或联系软件提供方');
    if (!allowExpired && payload.expiresAt !== null && current >= Date.parse(payload.expiresAt)) throw fail('LICENSE_EXPIRED', '授权已到期，请联系软件提供方续期并输入新激活码');
    return structuredClone(payload);
  }
  function initialize() {
    if (!initialized) initialized = (async () => {
      let raw;
      try { raw = await (hardwareProvider ? hardwareProvider() : collectHardware(run)); } catch { raw = {}; }
      const factors = hardwareFactors(raw);
      machine = {factors, machineCode: Buffer.from(factors.join('')).toString('base64'), missingFactors: factorNames.filter((name, index) => factors[index] === missingDigest)};
      const saved = readLicense(root, safeStorage);
      if (saved.error) { stateMessage = saved.error; stateCode = 'unreadable'; }
      else if (saved.code) try { cachedPayload = verify(saved.code, {allowExpired: true}); } catch (error) { stateMessage = error.message; stateCode = error.code === 'LICENSE_EXPIRED' ? 'expired' : 'invalid'; }
    })();
    return initialized;
  }
  async function info() {
    await initialize();
    const available = machine.missingFactors.length <= 1;
    const expired = cachedPayload?.expiresAt !== null && cachedPayload?.expiresAt !== undefined && time().getTime() >= Date.parse(cachedPayload.expiresAt);
    const active = !!cachedPayload && !expired && available;
    return {active, activated: active, status: !available ? 'machine-unavailable' : expired ? 'expired' : active ? 'active' : stateCode, machineCode: available ? machine.machineCode : '', missingFactors: [...machine.missingFactors], missingFactorLabels: machine.missingFactors.map(name => factorLabels[name]), tier: cachedPayload?.tier || '', issuedAt: cachedPayload?.issuedAt || null, expiresAt: cachedPayload?.expiresAt ?? null, permanent: active && cachedPayload.expiresAt === null, message: !available ? machineError().message : expired ? '授权已到期，请联系软件提供方续期并输入新激活码' : active ? '软件已激活' : stateMessage || '软件未激活，请先输入激活码'};
  }
  async function activate(code) {
    const work = async () => { await initialize(); const payload = verify(code); writeLicense(root, safeStorage, code.trim()); cachedPayload = payload; stateCode = 'active'; stateMessage = ''; return info(); };
    const result = activationQueue.then(work, work);
    activationQueue = result.catch(() => {});
    return result;
  }
  return {
    info, activate,
    machineCode: async () => { await initialize(); if (machine.missingFactors.length > 1) throw machineError(); return machine.machineCode; },
    verifyLicense: async code => { await initialize(); return verify(code); },
    assert: async action => { if (unlicensedActions.has(action)) return true; const state = await info(); if (!state.active) throw fail('LICENSE_REQUIRED', state.status === 'unactivated' ? '软件未激活，请先输入激活码' : state.message); return true; }
  };
}

module.exports = {createLicenseManager, normalizeSerial, hardwareFactors, factorsFromMachineCode, collectHardware, readLicense, writeLicense};
