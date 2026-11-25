const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {factorsFromMachineCode} = require('../server/license.cjs');

const repoRoot = path.resolve(__dirname, '..');
const privateRelative = 'scripts/.license-private.pem';
const publicRelative = 'server/license-public-key.cjs';
const invalid = message => new Error(message);

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

function assertPrivateIgnored(root) {
  try {
    // 同时核对仓库规则与Git实际匹配结果，已被跟踪的私钥即使匹配忽略规则也拒绝。
    if (!fs.readFileSync(path.join(root, '.gitignore'), 'utf8').trim()) throw invalid('缺少忽略规则');
    const tracked = git(root, ['ls-files', '--', privateRelative]);
    if (tracked) throw invalid('私钥已被跟踪');
    const matched = git(root, ['check-ignore', '--no-index', '--verbose', '--', privateRelative]);
    const rule = /^\.gitignore:\d+:([^\t]+)\t/.exec(matched)?.[1];
    if (!rule || rule.startsWith('!')) throw invalid('私钥未受仓库忽略规则保护');
  } catch { throw invalid('私钥保护检查失败，请先在 .gitignore 忽略 scripts/.license-private.pem，并确认它未被 Git 跟踪'); }
}

function publicDer(privateKey) {
  return crypto.createPublicKey(privateKey).export({type: 'spki', format: 'der'}).toString('base64');
}

function ensureKeyPair(root) {
  assertPrivateIgnored(root);
  const privateFile = path.join(root, privateRelative), publicFile = path.join(root, publicRelative);
  if (!fs.existsSync(privateFile) && fs.existsSync(publicFile)) throw invalid('发行私钥缺失，已保留现有公钥；请恢复原私钥，不要重新生成导致旧激活码失效');
  let privateKey;
  if (!fs.existsSync(privateFile)) {
    const pair = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(privateFile), {recursive: true});
    // 独占创建，已有发行私钥绝不覆盖。私钥仅落在经过忽略检查的位置。
    fs.writeFileSync(privateFile, pair.privateKey.export({type: 'pkcs8', format: 'pem'}), {flag: 'wx', mode: 0o600});
    privateKey = pair.privateKey;
  } else {
    try { privateKey = crypto.createPrivateKey(fs.readFileSync(privateFile)); }
    catch { throw invalid('发行私钥无法读取，请恢复正确私钥文件后重试'); }
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw invalid('发行私钥算法错误，必须使用 Ed25519');
  const expected = publicDer(privateKey);
  if (fs.existsSync(publicFile)) {
    let exported;
    try { exported = require(publicFile); } catch { throw invalid('发行公钥文件无法读取，请联系维护人员核对'); }
    if (exported !== expected) throw invalid('发行公钥与私钥不匹配，已停止出码；请恢复原密钥对');
  } else {
    fs.mkdirSync(path.dirname(publicFile), {recursive: true});
    fs.writeFileSync(publicFile, "// 发行端 Ed25519 公钥，仅含 SPKI-DER base64，不含私钥。\nmodule.exports = '" + expected + "';\n", {flag: 'wx'});
  }
  return {privateKey, publicKey: expected};
}

function issueLicense({machine, tier = 'basic', days, now = new Date(), privateKey}) {
  const factors = factorsFromMachineCode(machine);
  if (!['basic', 'pro', 'enterprise'].includes(tier)) throw invalid('档位无效，请使用 basic、pro 或 enterprise');
  if (days !== undefined && (!Number.isSafeInteger(days) || days < 1 || days > 365000)) throw invalid('有效天数必须为 1 至 365000 的整数；不传 --days 表示永久');
  const issuedAt = new Date(now);
  if (!Number.isFinite(issuedAt.getTime())) throw invalid('签发时间无效，请校准系统日期后重试');
  const expiresAt = days === undefined ? null : new Date(issuedAt.getTime() + days * 86400000).toISOString();
  const payload = {version: 1, tier, factors, issuedAt: issuedAt.toISOString(), expiresAt};
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signed = 'SIP1.' + body;
  if (privateKey?.asymmetricKeyType !== 'ed25519') throw invalid('签名私钥必须为 Ed25519');
  return signed + '.' + crypto.sign(null, Buffer.from(signed), privateKey).toString('base64url');
}

function parseArgs(args) {
  if (args.length === 1 && ['--init-key', '--check-release', '--help'].includes(args[0])) return {mode: args[0]};
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--machine', '--tier', '--days'].includes(name) || !value || value.startsWith('--') || Object.hasOwn(options, name)) throw invalid('参数无效，请使用 --machine <机器码> [--tier basic] [--days 天数]');
    options[name] = value;
  }
  if (!options['--machine']) throw invalid('请填写 --machine <买家机器码>；首次准备密钥可运行 --init-key');
  const daysText = options['--days'];
  if (daysText !== undefined && !/^[1-9]\d*$/.test(daysText)) throw invalid('有效天数必须为正整数；不传 --days 表示永久');
  return {mode: 'issue', machine: options['--machine'], tier: options['--tier'] || 'basic', ...(daysText !== undefined ? {days: Number(daysText)} : {})};
}

function checkRelease(root) {
  let status;
  try { status = git(root, ['status', '--porcelain', '--untracked-files=all']); }
  catch { throw invalid('无法核对发行源码状态，请在有效 Git 仓库执行打包'); }
  if (status) throw invalid('发行工作区存在未提交改动，请由负责人核对并提交干净后再打包');
  assertPrivateIgnored(root);
  try {
    const value = require(path.join(root, publicRelative));
    const key = crypto.createPublicKey({key: Buffer.from(value, 'base64'), type: 'spki', format: 'der'});
    if (key.asymmetricKeyType !== 'ed25519') throw invalid('公钥无效');
  } catch { throw invalid('发行公钥不可用，请先准备正确 Ed25519 公钥后再打包'); }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) throw invalid('发行版本与依赖锁版本不一致，请同步 package-lock.json 后提交');
  return true;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.mode === '--help') return console.log('出码：node scripts/make-license.cjs --machine <机器码> [--tier basic] [--days 天数]\n不传 --days 为永久授权；3650 天是有限期。首次准备密钥：--init-key；发行前门禁：--check-release');
  if (options.mode === '--check-release') { checkRelease(repoRoot); return console.log('发行源码门禁通过：工作区干净、公钥有效、版本一致；尚未执行打包'); }
  if (options.mode === '--init-key') { const pair = ensureKeyPair(repoRoot); return console.log('发行密钥对已就绪；公钥 SPKI-DER 字节数：' + Buffer.from(pair.publicKey, 'base64').length + '。请离线备份私钥，切勿提交或分发'); }
  // 先校验买家参数，避免误操作生成新的发行密钥。
  factorsFromMachineCode(options.machine);
  if (!['basic', 'pro', 'enterprise'].includes(options.tier) || options.days !== undefined && (!Number.isSafeInteger(options.days) || options.days < 1 || options.days > 365000)) throw invalid('档位或有效天数无效，请核对参数后重试');
  const {privateKey} = ensureKeyPair(repoRoot);
  console.log(issueLicense({...options, privateKey}));
}

function cliErrorMessage(error) {
  const fallback = '出码失败，请核对忽略规则、机器码、密钥与文件权限后重试';
  const message = error?.message;
  if (typeof message !== 'string' || !/[\u3400-\u9fff]/u.test(message) || /(?:[a-z]:[\\/]|\\\\|file:\/\/|(?:^|\s)\/(?:Users|home|tmp|var|usr)\/|\n\s*at\s|Traceback|\bError:)/iu.test(message)) return fallback;
  return message.replace(/[\r\n]+/g, ' ').slice(0, 600);
}

module.exports = {assertPrivateIgnored, ensureKeyPair, issueLicense, parseArgs, checkRelease, main, cliErrorMessage};
if (require.main === module) {
  try { main(); } catch (error) {
    // 对外仅给出可执行中文提示，不打印异常堆栈和内部文件路径。
    console.error(cliErrorMessage(error));
    process.exitCode = 1;
  }
}
