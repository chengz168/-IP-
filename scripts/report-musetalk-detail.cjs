// 汇总真实短片和静态候选，明确保留未达原版的质量结论。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { digest } = require('../integrations/musetalk-local/input.cjs');
const root = path.resolve(__dirname, '../evidence/validation/musetalk-detail-20261116');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const media = read(path.resolve(root, '../musetalk-long-20261116/long-media-report.json'));
const diagnostic = read(path.join(root, 'full-resolution-v2/diagnostic-report.json'));
const enhanced = read(path.join(root, 'existing-esrgan-v2/enhancement-report.json'));
const short = read(path.join(root, 'short-motion/short-trial-report.json'));
const ffmpeg = 'F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe';
const command = args => {
  const result = spawnSync(ffmpeg, args, { windowsHide: true, maxBuffer: 16*1024*1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
};
assert.equal(diagnostic.inputsUnchanged, true);
assert.equal(enhanced.modelActuallyExecuted, true);
assert.equal(short.modelActuallyExecuted, true);
assert.equal(short.frames, 120);
assert.equal(short.audioBetweenCandidatesIdentical, true);
for (const output of short.outputs) assert.equal(digest(output.path), output.sha256);
const sourceAudio = command(['-v','error','-ss','99','-i',short.source.path,'-t','4','-map','0:a:0','-ar','16000','-ac','1','-f','s16le','-']);
const candidateAudio = command(['-v','error','-i',short.outputs[1].path,'-map','0:a:0','-ar','16000','-ac','1','-f','s16le','-']);
let aa=0,bb=0,ab=0;
const samples = Math.min(sourceAudio.length, candidateAudio.length)/2;
for(let i=0;i<samples;i++){const a=sourceAudio.readInt16LE(i*2),b=candidateAudio.readInt16LE(i*2);aa+=a*a;bb+=b*b;ab+=a*b;}
const correlation=ab/Math.sqrt(aa*bb);
assert(samples>=64000 && correlation>.99, '候选与正确时间段音轨不符');
const reference = path.join(root,'short-motion/99-103秒-参考原片.mp4');
assert(!fs.existsSync(reference),'不覆盖已有参考短片');
command(['-v','error','-n','-ss','99','-i',media.plan.video.path,'-t','4','-map','0:v:0','-map','0:a:0','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',reference]);
command(['-v','error','-xerror','-i',reference,'-map','0:v:0','-map','0:a:0','-f','null','-']);
const protection = read(path.resolve(root,'../musetalk-long-20261116/protected-files-check.json'));
for(const file of protection.files) assert.equal(digest(file.file),file.expected,file.file);
const result = {
  at:new Date().toISOString(),classification:'progress',overallGoalComplete:false,
  stageDiagnostic:path.join(root,'full-resolution-v2/diagnostic-report.json'),
  invalidFirstDiagnostic:path.join(root,'INVALID-FIRST-DIAGNOSTIC.json'),
  attempts:path.join(root,'attempts.json'),
  staticEnhancement:path.join(root,'existing-esrgan-v2/enhancement-report.json'),
  shortTrial:path.join(root,'short-motion/short-trial-report.json'),
  reference:{path:reference,sha256:digest(reference)},
  outputs:short.outputs,
  sourceAudioCheck:{samples,correlation,passed:true},
  model:short.model,shortInferenceCalls:short.inferenceCalls,
  shortTotalWallSeconds:short.elapsedSeconds,
  protectedFileCount:protection.files.length,protectedFilesUnchanged:true,
  productionCodeChanged:false,productionDefaultChanged:false,newDownload:false,
  newSpeechGenerated:false,newLipSyncGenerated:false,
  visualReview:{
    method:'direct-static-image-inspection',
    observedFiles:[path.join(root,'full-resolution-v2/comparison-3000.jpg'),path.join(root,'existing-esrgan-v2/comparison-3000.jpg'),path.join(root,'existing-esrgan-v2/comparison-6225.jpg'),short.contactSheet],
    observations:[
      '100秒对照中仅缩放与VAE重建仍可见原牙齿结构，现有口型产物嘴形与牙齿表现不同，不能把差异全归因于缩放。',
      '整脸增强使眼镜、眼睛等区域也发生改变；局部增强保留掩码外像素。',
      '增强候选的部分嘴唇轮廓更利落，但100秒处原牙齿结构未恢复；不足以判断达到原版。',
      '短片八时间点抽样只能检查静态边缘，不能代替完整连续闪烁和音画自然度审查。'
    ],
    continuousFlickerReviewed:false,qualityAccepted:false,referenceParityAccepted:false,
    decision:'暂不接入默认生成；保留原产物与候选供对照，继续解决真实口型细节。'
  }
};
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = file=>escape(pathToFileURL(file).href);
const videos = [{name:'参考原片',path:reference},{name:'现有本地口型',path:short.outputs[0].path},{name:'嘴周增强候选',path:short.outputs[1].path}];
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>嘴周细节四秒对照</title><style>
*{box-sizing:border-box}body{margin:0;background:#171922;color:#eef0fa;font:16px/1.65 "Microsoft YaHei",sans-serif}main{max-width:1180px;margin:auto;padding:28px}h1{font-size:25px;margin:0 0 16px}h2{font-size:18px;margin:0 0 12px}p{color:#c5cadc;overflow-wrap:anywhere}.notice{color:#ffe0a0}.videos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}article,section{padding:18px;background:#242733;border:1px solid #404758;border-radius:12px;margin:20px 0}article{min-width:0}video{width:100%;display:block;max-height:66vh;background:#111}img{display:block;max-width:100%;height:auto;margin:14px auto}button{font:inherit;border:1px solid #7292bd;border-radius:7px;padding:8px 16px;color:#f3f5ff;background:#344b6c;cursor:pointer}.hint{font-size:14px}@media(max-width:720px){main{padding:16px}.videos{grid-template-columns:1fr}article{margin:4px 0}h1{font-size:22px}}
</style><main><h1>嘴周细节四秒对照</h1><p>同一人物、同一时间段：原长片99—103秒，4秒、120帧、1080×1920。播放其中一个版本时，其余版本自动暂停。</p><p class="notice">候选真实运行了本机已有增强模型，但只改善了部分轮廓，尚未恢复原片牙齿结构，暂不替换默认生成。此处没有重新生成C配音或新口型。</p><button id="reset" type="button">全部回到开头</button><div class="videos">${videos.map(item=>`<article><h2>${item.name}</h2><video controls preload="auto" src="${url(item.path)}"></video></article>`).join('')}</div><section><h2>100秒的阶段定位</h2><p>从左到右：原片、仅256缩放、VAE重建、现有口型产物。缩放存在损失，但不是全部差异的来源。</p><img src="${url(path.join(root,'full-resolution-v2/comparison-3000.jpg'))}" alt="100秒四阶段脸部对照"></section><section><h2>增强候选静态对照</h2><p>从左到右：原片、现有口型、整脸增强、嘴周局部增强。局部候选在编码前保持掩码外像素不变；编码本身仍会引入压缩变化。</p><img src="${url(path.join(root,'existing-esrgan-v2/comparison-3000.jpg'))}" alt="100秒增强方式对照"></section><section><h2>短片八时间点</h2><p>每组左为现有口型，右为局部增强候选。静态抽样不能证明没有闪烁，请用上方视频检查运动中的表现。</p><img src="${url(short.contactSheet)}" alt="99至102.5秒八时间点嘴周对照"></section><p class="hint">120次增强模型推理，含解码、封装和验证用时${short.elapsedSeconds.toFixed(1)}秒。两对照音轨解码后完全一致，与正确原音轨片段相关性${correlation.toFixed(6)}。该值不代表口型分数。原正式数据及6项受保护文件未变。</p></main><script>
const players=[...document.querySelectorAll('video')];for(const player of players){player.addEventListener('play',()=>{for(const other of players)if(other!==player)other.pause()})}document.querySelector('#reset').addEventListener('click',()=>{for(const player of players){player.pause();player.currentTime=0}});
</script></html>`;
fs.writeFileSync(path.join(root,'嘴周细节四秒对照.html'),html,{flag:'wx'});
fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({sourceAudioCorrelation:correlation,protectedFiles:protection.files.length,review:path.join(root,'嘴周细节四秒对照.html'),defaultChanged:false}));
