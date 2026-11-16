const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// 固定来源并保留原始文件，安装环境时不修改现有 ComfyUI 或业务设置。
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'evidence/research/generation-chain-20261115/indextts-local-skill');
const destination = path.join(root, 'integrations/indextts-local');
const commit = '85655dc9719198d00370879620eb26949010ef57';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
fs.mkdirSync(path.join(destination, 'scripts'), {recursive: true});
const prior = JSON.parse(fs.readFileSync(path.join(source, 'receipt.json'), 'utf8'));
if (prior.commit !== commit) throw Error('运行器来源提交与审查记录不一致');
const files = [];
for (const name of ['tts.py', 'common.py', 'worker.py', 'download_models.py']) {
  const original = `plugins/indextts-local/scripts/${name}`;
  const file = path.join(source, original.replaceAll('/', '__'));
  const body = fs.readFileSync(file);
  const record = prior.files.find(item => item.name === original);
  if (!record || record.sha256 !== sha(body)) throw Error(`来源文件散列不一致：${name}`);
  const target = path.join(destination, 'scripts', name);
  if (fs.existsSync(target) && sha(fs.readFileSync(target)) !== sha(body)) throw Error(`拒绝覆盖已有修改：${target}`);
  fs.writeFileSync(target, body);
  files.push({path: `scripts/${name}`, sha256: sha(body), bytes: body.length});
}
const licenseJson = path.join(source, 'LICENSE.github.json');
let body;
try {
  cp.execFileSync('curl.exe', ['-fsSL', '--max-time', '30', '-H', 'Accept: application/vnd.github+json',
    `https://api.github.com/repos/Bandukids/indextts-local/contents/LICENSE?ref=${commit}`, '-o', licenseJson]);
  const license = JSON.parse(fs.readFileSync(licenseJson, 'utf8'));
  if (license.encoding !== 'base64') throw Error('未取得完整许可正文');
  body = Buffer.from(license.content, 'base64');
} catch {
  // API 限流时使用 Git 协议读取同一提交，不切换到未经核实的其他版本。
  const checkout = path.join(source, 'fixed-checkout');
  if (!fs.existsSync(path.join(checkout, '.git'))) {
    cp.execFileSync('git', ['clone', '--depth', '1', '--no-checkout', 'https://github.com/Bandukids/indextts-local.git', checkout], {stdio: 'inherit'});
  }
  cp.execFileSync('git', ['fetch', '--depth', '1', 'origin', commit], {cwd: checkout, stdio: 'inherit'});
  body = cp.execFileSync('git', ['show', `${commit}:LICENSE`], {cwd: checkout});
}
const tree = JSON.parse(fs.readFileSync(path.join(source, 'tree.json'), 'utf8'));
const expected = tree.tree.find(item => item.path === 'LICENSE').sha;
const blobSha = crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
if (blobSha !== expected) throw Error('许可证与已核实的 Git blob 不一致');
fs.writeFileSync(path.join(destination, 'LICENSE'), body);
files.push({path: 'LICENSE', sha256: sha(body), bytes: body.length});
const receipt = {repo: 'Bandukids/indextts-local', commit, preparedAt: new Date().toISOString(), files,
  upstreamCommit: 'd9e41aac89fd00b3d71497fddb287b7f24613712', localModifications: [],
  runtimeHome: 'D:/AI-Runtimes/super-ip/indextts-2.5', installed: false, inferenceVerified: false};
fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
