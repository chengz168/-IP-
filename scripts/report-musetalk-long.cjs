// 汇总真实终态证据，页面仅供对照观看，不自动填写人工质量结论。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { digest } = require('../integrations/musetalk-local/input.cjs');
const root = path.resolve(__dirname, '../evidence/validation/musetalk-long-20261116');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const media = read('long-media-report.json'), playback = read('long-product-playback.json'), prepared = read('prepared.json');
assert.equal(media.checks.technicalComplete, true);
assert.equal(playback.fullNativePlaybackToEnded, true);
assert.equal(playback.refreshBinding, true);
const state = read('workspace/studio.json'), run = state.runs.find(item => item.id === media.runId);
assert.equal(run.status, 'succeeded');
assert.equal(digest(media.asset.path), media.output.sha256);
const protection = read('protected-files-check.json');
for (const item of protection.files) assert.equal(digest(item.file), item.expected, item.file);
const elapsed = (Date.parse(run.endedAt) - Date.parse(run.createdAt)) / 1000;
// 静态观察只记录实际可见差异，不推导连续音画同步或听感结论。
const visualReview = {
  at: new Date().toISOString(), method: 'direct-static-image-inspection',
  contactSheet: path.join(root, 'long-face-contact-sheet.jpg'),
  sampledSeconds: [0, 20, 60, 100, 140, 180, 207.5],
  layout: '各对照左侧原片，右侧本地产物',
  observations: [
    '抽样对照可见，本地产物的嘴唇边缘和牙齿细节比原片偏软、模糊，100秒处尤为明显。',
    '相同时间点嘴形存在差异；不能仅据静态嘴形差异断言音画不同步。'
  ],
  continuousLipSyncReviewed: false, fullAudioListeningReviewed: false,
  qualityAccepted: false, referenceParityAccepted: false
};
const report = {
  at: new Date().toISOString(), classification: 'progress', overallGoalComplete: false,
  runId: run.id, model: 'MuseTalk 1.5', frames: media.checks.videoFrames,
  inferenceCalls: media.receipt.inferenceCalls,
  output: { path: media.asset.path, sha256: media.output.sha256, duration: media.checks.videoDuration, width: 1080, height: 1920, fps: 30 },
  evidence: { media: path.join(root, 'long-media-report.json'), playback: path.join(root, 'long-product-playback.json'), visual: path.join(root, 'visual-review.json') },
  visualReview,
  performance: { totalWallSeconds: elapsed, outputSeconds: 208, processingToVideoDurationRatio: elapsed / 208, endToEndFramesPerSecond: 6240 / elapsed },
  technicalComplete: true, fullNativePlayback: true, refreshBinding: true, protectedFileCount: protection.files.length, protectedFilesUnchanged: true,
  sourceVideoAndAudioReused: true, cVoiceUsed: false, newSpeechGenerated: false,
  sourceBodyAndBackgroundReused: true, sampledFrames: media.sampledFrames,
  largeFrameCacheRemoved: media.receipt.largeFrameCacheRemoved,
  packagedExeStarted: false, productionCodeChanged: false,
  qualityAccepted: false, characterMatchAccepted: false, referenceParityAccepted: false,
  limitations: [
    '本次输入为既有208秒参考成片及其原音轨，未验证C音色长配音或新文案长片。',
    '源视频和输出都是6240帧，本次未覆盖超过源片长度的往返动作复用。',
    '静态画面对照和正常播放不能代替连续口型、牙齿、嘴周和真人感人工验收。',
    '已查看的抽帧中嘴唇和牙齿细节较原片偏软，当前不能判定画质达到原版。',
    '本机处理耗时以performance字段为准，不能据一次成功声称生成速度已满足日常使用要求。',
    '全部页面、模板、功能、交互和真实平台上传及独立打包启动仍未完成总体验收。'
  ]
};
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const url = file => escape(pathToFileURL(file).href);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>208秒本地口型长片对照</title><style>
body{margin:0;background:#14151b;color:#e9eaf2;font:16px/1.65 "Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:25px}p{color:#bdc1d2;overflow-wrap:anywhere}section{margin:24px 0;background:#22242e;border:1px solid #414554;border-radius:14px;padding:20px}.videos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}video{display:block;width:100%;max-height:68vh;background:#111;border-radius:8px}h2{font-size:18px;margin:0 0 12px}.pair{max-width:720px;width:100%;height:auto}.notice{color:#ffe4a5}a{color:#a8ceff}figure{margin:28px 0}figcaption{margin:10px 0}@media(max-width:680px){main{padding:16px}.videos{grid-template-columns:1fr}}
</style><main><h1>208秒本地口型长片对照</h1><p>已完成6240帧真实口型处理与完整媒体技术检查。此处用于原片和本地产物的人工观看，质量尚未验收。</p><p class="notice">原片身体、背景及原音轨被复用。本次没有生成C配音，也未证明新文案长片能力。</p><section class="videos"><div><h2>原始参考成片</h2><video controls preload="metadata" src="${url(prepared.source.path)}"></video></div><div><h2>本地MuseTalk口型产物</h2><video controls preload="metadata" src="${url(media.asset.path)}"></video></div></section><section><h2>实际执行与限制</h2><p>208秒 · 1080×1920 · 30fps · 6240帧 · ${report.inferenceCalls}个推理批次。总用时${elapsed.toFixed(1)}秒，约${(elapsed / 60).toFixed(1)}分钟；时长比${(elapsed / 208).toFixed(2)}。从头原速、不静音播放至结束及刷新绑定检查通过。</p><p class="notice">抽帧观察：产物嘴唇和牙齿细节较原片偏软、模糊，100秒处尤其明显。当前不能判定画质达到原版。</p><p>检查连续口型、牙齿和嘴周边界时，请观看完整视频；下面七个时间点只提供静态对照。</p></section><section><h2>脸部同时间点对照</h2><p>每张图左侧为原片，右侧为本地产物。</p>${media.sampledFrames.map(item => `<figure><figcaption>${item.time}秒 · 第${item.frameIndex}帧</figcaption><img class="pair" src="${url(item.pairFile)}" alt="${item.time}秒原片与本地产物脸部对照"></figure>`).join('')}</section><p>SHA-256：${escape(media.output.sha256)}</p></main></html>`;
fs.writeFileSync(path.join(root, 'visual-review.json'), JSON.stringify(visualReview, null, 2), { flag: 'wx' });
fs.writeFileSync(path.join(root, '208秒本地口型长片对照.html'), html, { flag: 'wx' });
fs.writeFileSync(path.join(root, 'delivery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ technicalComplete: true, fullPlayback: true, totalWallSeconds: elapsed, review: path.join(root, '208秒本地口型长片对照.html'), output: media.asset.path }));
