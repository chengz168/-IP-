const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// 仅保存公开仓库的文件和来源，不执行下载的代码，也不读取用户认证信息。
const root = path.resolve('evidence/research/generation-chain-20261115');
fs.mkdirSync(root, {recursive: true});
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const tasks = {
  'index-tts': ['index-tts/index-tts', ['README.md', 'LICENSE', 'indextts/infer_v2.py']],
  cosyvoice: ['FunAudioLLM/CosyVoice', ['README.md', 'LICENSE', 'example.py']],
  musetalk: ['TMElyralab/MuseTalk', ['README.md', 'LICENSE', 'requirements.txt']],
  latentsync: ['bytedance/LatentSync', ['README.md', 'LICENSE', 'requirements.txt']],
  'remotion-skills': ['remotion-dev/skills', ['README.md', 'skills/remotion-render/SKILL.md', 'skills/remotion-captions/SKILL.md']],
  'noiz-skills': ['NoizAI/skills', ['README.md', 'skills/tts/SKILL.md']],
  'indextts-local-skill': ['Bandukids/indextts-local', ['README.md', 'plugins/indextts-local/skills/indextts/SKILL.md', 'plugins/indextts-local/scripts/tts.py', 'plugins/indextts-local/scripts/worker.py', 'plugins/indextts-local/scripts/common.py', 'plugins/indextts-local/scripts/download_models.py']],
  'authorized-voice-skill': ['1025941202-blip/indextts2-authorized-voice-skill', ['README.md', 'LICENSE', 'indextts2-authorized-voice/SKILL.md', 'indextts2-authorized-voice/scripts/make_voice.py', 'indextts2-authorized-voice/references/setup-and-reuse.md']],
};
function getJson(url, file) {
  cp.execFileSync('curl.exe', ['-fsSL', '--retry', '0', '--max-time', '30', '-H', 'Accept: application/vnd.github+json', url, '-o', file], {stdio: ['ignore', 'ignore', 'pipe']});
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function inspect(key, [repo, files]) {
  const dir = path.join(root, key); fs.mkdirSync(dir, {recursive: true});
  const result = {repo, checkedAt: new Date().toISOString(), files: [], errors: [], codeExecuted: false};
  try {
    const meta = getJson(`https://api.github.com/repos/${repo}`, path.join(dir, 'repository.json'));
    result.branch = meta.default_branch; result.licenseSummary = meta.license?.spdx_id;
    const commit = getJson(`https://api.github.com/repos/${repo}/commits/${meta.default_branch}`, path.join(dir, 'commit.json'));
    result.commit = commit.sha;
    for (const name of files) {
      try {
        const output = path.join(dir, name.replaceAll('/', '__'));
        const data = getJson(`https://api.github.com/repos/${repo}/contents/${name}?ref=${result.commit}`, output + '.github.json');
        if (data.encoding !== 'base64') throw Error('接口未返回完整base64正文');
        const body = Buffer.from(data.content, 'base64'); fs.writeFileSync(output, body);
        result.files.push({name, file: path.relative(root, output), bytes: body.length, sha256: sha(body), source: data.html_url});
      } catch (error) {result.errors.push({name, error: error.message.slice(0, 500)});}
    }
  } catch (error) { result.errors.push({error: error.message.slice(0, 500)}); }
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
// 每个仓库固定到实际提交，外层按选中的仓库执行，避免无界下载。
(async () => {
  for (const key of process.argv.slice(2)) {
    if (!tasks[key]) throw Error('未知研究对象：' + key);
    await inspect(key, tasks[key]);
  }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
