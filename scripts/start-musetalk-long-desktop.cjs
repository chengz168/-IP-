const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'evidence', 'validation', 'musetalk-long-20261116');
const workspace = path.join(evidence, 'workspace');
const source = path.join(root, 'evidence', 'validation', 'edit-page-fidelity', 'interactive-workspace', 'assets', 'b5fb323b-5c36-4d0a-b498-b963d1853fe6.mp4');
const ffmpeg = 'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe';
const ffprobe = 'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffprobe.exe';
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2));
const sha256 = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function seed() {
  if (fs.existsSync(path.join(evidence, 'prepared.json'))) throw new Error('长片验证工作区已准备，拒绝覆盖');
  if (!fs.existsSync(source)) throw new Error('208秒源视频不存在');
  fs.mkdirSync(path.join(workspace, 'assets'), { recursive: true });
  const audio = path.join(workspace, 'assets', 'source-driver-208s.wav');
  const extract = spawnSync(ffmpeg, ['-y', '-i', source, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio], { encoding: 'utf8', windowsHide: true });
  if (extract.status !== 0 || !fs.existsSync(audio)) throw new Error('208秒音轨提取失败：' + (extract.stderr || '未知错误'));
  const { Store } = require('../server/store.cjs');
  const store = new Store(workspace);
  const sourceProbe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,sample_rate,channels', '-of', 'json', source], { encoding: 'utf8', windowsHide: true }).stdout);
  const audioProbe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,sample_rate,channels', '-of', 'json', audio], { encoding: 'utf8', windowsHide: true }).stdout);
  store.data.settings = {
    ...store.data.settings,
    outputDir: path.join(workspace, 'outputs'),
    ffmpegPath: ffmpeg,
    ffprobePath: ffprobe,
    provider: {
      ...store.data.settings.provider,
      avatarProtocol: 'musetalk-local',
      musetalkHome: 'D:/AI-Runtimes/super-ip/musetalk-1.5'
    }
  };
  const videoAsset = store.addAsset(source, { name: '208秒源形象.mp4', origin: 'long-reference-source', duration: Number(sourceProbe.format.duration) });
  const audioAsset = store.addAsset(audio, { name: '208秒原始驱动音轨.wav', origin: 'long-reference-driver', duration: Number(audioProbe.format.duration) });
  const avatar = { id: 'long-reference-avatar', name: '208秒参考人物', assetId: videoAsset.id };
  store.data.avatars = [avatar];
  const draft = store.draft();
  Object.assign(draft, {
    title: '208秒本地长片口型验证',
    step: 3,
    confirmed: true,
    finalText: '208秒本地长片口型技术验证，使用原始驱动音轨。',
    video: { ...draft.video, mode: 'single', avatarId: avatar.id, audioId: audioAsset.id, assetId: '' },
    voice: { ...draft.voice, audioId: audioAsset.id }
  });
  store.save();
  write('prepared.json', {
    at: new Date().toISOString(),
    workspace,
    draftId: draft.id,
    source: { path: source, sha256: sha256(source), probe: sourceProbe },
    audio: { path: audio, sha256: sha256(audio), probe: audioProbe },
    model: { protocol: 'musetalk-local', home: 'D:/AI-Runtimes/super-ip/musetalk-1.5' },
    expected: { duration: 208, frames: 6240, fps: 30, width: 1080, height: 1920 },
    qualityAccepted: false,
    cVoiceUsed: false
  });
  console.log(JSON.stringify({ seeded: true, draftId: draft.id, duration: sourceProbe.format.duration, audioDuration: audioProbe.format.duration }));
}

function launch() {
  if (!fs.existsSync(path.join(evidence, 'prepared.json'))) throw new Error('请先运行 --seed-only');
  if (fs.existsSync(path.join(evidence, 'launch.json'))) throw new Error('已有启动记录，拒绝重复启动');
  fs.mkdirSync(path.join(evidence, 'electron-profile'), { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.STUDIO_DEV_URL;
  const child = spawn(require('electron'), [__filename, '--remote-debugging-port=9371', '--studio-data-dir=' + workspace], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  write('launch.json', { at: new Date().toISOString(), pid: child.pid, port: 9371, workspace });
  const log = fs.createWriteStream(path.join(evidence, 'electron.log'), { flags: 'a' });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('exit', (code, signal) => { write('closed.json', { at: new Date().toISOString(), code, signal }); log.end(); });
  console.log(JSON.stringify({ pid: child.pid, port: 9371 }));
}

if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  require('electron').app.setPath('userData', path.join(evidence, 'electron-profile'));
  require('../electron/main.cjs');
} else {
  try {
    if (process.argv.includes('--seed-only')) seed();
    else launch();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
