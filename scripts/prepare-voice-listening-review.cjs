// 整理已有同稿真实结果，隐藏来源供人工试听，不自动判定真人感。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Media, runProcess } = require('../server/media.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = path.resolve('evidence/validation/voice-listening-review-20261115');
const workspace = path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');

function pageHtml(samples, text) {
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>声音对照试听</title>
<style> *{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#202633;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:28px;line-height:1.4}p{margin:12px 0}.note{color:#5c6472}.text{background:#eaf0ff;padding:20px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:24px 0}article{background:white;border:1px solid #dde1e9;border-radius:14px;padding:20px;min-width:0}h2{font-size:20px;margin:0 0 12px}audio{display:block;width:100%;margin:12px 0}label{display:block;margin-top:14px}select,textarea,button{font:inherit;border:1px solid #c5cbd6;border-radius:8px;padding:10px;max-width:100%}select,textarea{width:100%;background:white}textarea{resize:vertical;min-height:96px}button{background:#234fd4;color:white;cursor:pointer;margin:0 12px 12px 0}button:disabled{background:#d9deea;color:#60697a;cursor:default}.status{font-size:14px;min-height:24px;color:#596578}.source{margin-top:12px;overflow-wrap:anywhere}.actions{margin-top:24px}button:focus-visible,select:focus-visible,textarea:focus-visible,audio:focus-visible{outline:3px solid #738de8;outline-offset:3px}@media(max-width:740px){main{margin:24px auto;padding:0 16px}.grid{grid-template-columns:1fr}}</style>
<main><h1>先听声音，再看来源</h1><p>这里有三条相同正文的已有生成结果。先按自己的听感记录，再揭示模型来源。</p><p class="note">这不是一次新的语音生成，也没有已确认的真人同稿录音。程序只核对播放和文件，不能替你判断自然度或人物匹配。</p><p class="text" id="script"></p><div class="grid" id="samples"></div><div class="actions"><button id="reveal" disabled>揭示来源</button><button id="export" disabled>导出我的听感</button><button id="reset">清除本页评分</button></div><p class="note" id="message" role="status">每条完整播放后可评分；不需要为了给分反复试听。</p><p class="note">试听仅统一采样规格和恒定音量；保留原语速、音高和停顿。没有使用动态响度处理、变调、混响或降噪。没有通过人工听审的声音不会因此成为生产默认。</p></main>
<script>
const samples=${JSON.stringify(samples)}, script=${JSON.stringify(text)}, key='superip-voice-listening-20261115-v1';
document.querySelector('#script').textContent=script;
let stored={};try{stored=JSON.parse(localStorage.getItem(key)||'{}')}catch{}
let reviews=Object.fromEntries(samples.map(s=>[s.id,{ended:false,rating:'',issues:'',...(stored[s.id]||{})}]));
let revealed=false;
const save=()=>{try{localStorage.setItem(key,JSON.stringify(reviews))}catch{document.querySelector('#message').textContent='浏览器未允许本地保存，可用导出按钮保存听感。'}};
const update=()=>{document.querySelector('#reveal').disabled=!samples.every(s=>reviews[s.id].ended&&reviews[s.id].rating);document.querySelector('#export').disabled=!samples.some(s=>reviews[s.id].rating);};
for(const s of samples){
 const card=document.createElement('article');card.dataset.id=s.id;
 card.innerHTML='<h2>候选 '+s.id+'</h2><audio controls preload="metadata"></audio><div class="status" role="status"></div><label>自然度<select disabled><option value="">请先完整试听</option><option value="1">1 明显机械或失真</option><option value="2">2 多处像合成朗读</option><option value="3">3 大体顺畅，仍有AI感</option><option value="4">4 接近自然，少量瑕疵</option><option value="5">5 这段没有察觉明显合成感</option></select></label><label>哪里不自然<textarea placeholder="例如：哪一句停顿生硬、尾音发飘、重音不合适"></textarea></label><p class="source" hidden></p>';
 const audio=card.querySelector('audio'),status=card.querySelector('.status'),rating=card.querySelector('select'),issues=card.querySelector('textarea');
 audio.src=s.data;rating.disabled=!reviews[s.id].ended;rating.value=String(reviews[s.id].rating);issues.value=reviews[s.id].issues;status.textContent=reviews[s.id].ended?'本浏览器已记录完整播放；听感由你填写':'尚未完整播放';
 let covered=0,last=0;
 // 不以拖到末尾代替完整试听；允许正常暂停和回听。
 audio.addEventListener('play',()=>{document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause()});last=audio.currentTime;});
 audio.addEventListener('seeking',()=>{last=audio.currentTime;});
 audio.addEventListener('timeupdate',()=>{const t=audio.currentTime;if(!audio.seeking&&t>=last&&t-last<1.5&&last<=covered+.35)covered=Math.max(covered,t);last=t;});
 audio.addEventListener('ended',()=>{if(covered>=audio.duration-.4){reviews[s.id].ended=true;rating.disabled=false;status.textContent='已完整播放；请填写真实听感';save();update()}else{status.textContent='本次跳过了部分内容，可从头播放后评分';}});
 audio.addEventListener('error',()=>{status.textContent='音频加载失败，请保留文件并查看浏览器错误';});
 rating.addEventListener('change',()=>{reviews[s.id].rating=rating.value;save();update()});issues.addEventListener('input',()=>{reviews[s.id].issues=issues.value;save()});document.querySelector('#samples').append(card);
}
document.querySelector('#reveal').onclick=()=>{revealed=true;for(const s of samples){const node=document.querySelector('[data-id="'+s.id+'"] .source');node.textContent=s.source;node.hidden=false;}document.querySelector('#message').textContent='已揭示来源。更喜欢某条不代表该模型或所有长文都通过验收。'};
document.querySelector('#export').onclick=()=>{const result={at:new Date().toISOString(),kind:'user-listening-not-automatic-quality-test',text:script,revealedBeforeExport:revealed,reviews,sources:samples.map(({id,source,sha256})=>({id,source,sha256})),qualityAutomaticallyAccepted:false};const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='声音听感记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.querySelector('#reset').onclick=()=>{try{localStorage.removeItem(key)}catch{}location.reload()};update();
</script></html>`;
}

async function measure(ffmpeg, file) {
 let output='';
 await runProcess(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-23:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], {onStderr:chunk=>{output=(output+chunk).slice(-24000);}});
 const match = output?.match(/\{\s*"input_i"[\s\S]*?\}/);
 assert(match, '缺少响度测量结果');
 const parsed = JSON.parse(match[0]);
 const integrated = Number(parsed.input_i), peak = Number(parsed.input_tp);
 assert(Number.isFinite(integrated) && Number.isFinite(peak), '响度测量不是有限值');
 return {integratedLufs: integrated, truePeakDbtp: peak};
}

async function main() {
 assert(!fs.existsSync(root), '已有本轮试听目录，不覆盖');
 const state = read(workspace), before = digest(workspace);
 assert(!state.runs.some(r => ['running', 'queued', 'unknown'].includes(r.status)), '尚有未结束任务');
 const protectedFiles = read('evidence/validation/voice-design-20261115/prepared.json').protectedFiles;
 assert(protectedFiles.every(p => digest(p.file) === p.sha256));
 const candidates = [
  {receipt:'evidence/validation/voice-match-review-20261115/generated-normal.json', source:'IndexTTS 2.5，已有授权参考音色，普通语速', inspection:'evidence/validation/voice-match-review-20261115/inspection-normal.json'},
  {receipt:'evidence/validation/voice-design-20261115/qwen-chat-generated.json', source:'Qwen3-TTS VoiceDesign，已有 chat 候选', inspection:'evidence/validation/voice-design-20261115/qwen-chat-inspection.json'},
  {receipt:'evidence/validation/voice-design-20261115/qwen-warm-generated.json', source:'Qwen3-TTS VoiceDesign，已有 warm 候选', inspection:'evidence/validation/voice-design-20261115/qwen-warm-inspection.json'}
 ];
 const media = new Media({data:state}), {ffmpeg} = media.binaries();
 for(const c of candidates) {
  const receipt=read(c.receipt), inspection=read(c.inspection);
  c.original=receipt.file;c.originalSha256=digest(c.original);assert.equal(c.originalSha256,receipt.sha256);
  c.text=receipt.text||receipt.run.parameters.job.text;
  assert.equal(inspection.asrTextMatchesInput,true,'同稿候选正文曾出现自动核对差异，应单列人工核对');
  c.runId=receipt.run.id;assert.equal(state.runs.find(r=>r.id===c.runId)?.status,'succeeded');
  c.before=await measure(ffmpeg,c.original);
 }
 assert(candidates.every(c=>c.text===candidates[0].text),'输入正文不一致');
 // 顺序随机化只用于隐藏已有来源，不解释为正式统计盲测。
 for(let i=candidates.length-1;i>0;i--){const j=crypto.randomInt(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
 const targetLufs=Math.min(-23,...candidates.map(c=>c.before.integratedLufs));
 fs.mkdirSync(root,{recursive:true});
 const output=[], embedded=[];
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],id=String.fromCharCode(65+i),gainDb=Math.min(targetLufs-c.before.integratedLufs,-1.5-c.before.truePeakDbtp),file=path.join(root,'候选'+id+'.wav');
  await runProcess(ffmpeg,['-v','error','-n','-i',c.original,'-map','0:a:0','-af','volume='+gainDb.toFixed(6)+'dB','-ar','48000','-ac','1','-c:a','pcm_s16le',file]);
  await runProcess(ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-']);
  const probe=await media.probe(file), originalProbe=await media.probe(c.original),after=await measure(ffmpeg,file);
  assert(Math.abs(Number(probe.format.duration)-Number(originalProbe.format.duration))<.002,'音频时长改变');
  assert(after.truePeakDbtp<=-1.35,'试听真峰值余量不足');
  assert.equal(digest(c.original),c.originalSha256);
  output.push({...c,id,file,sha256:digest(file),gainDb,targetLufs,after,duration:Number(probe.format.duration),fullDecodeVerified:true,newInference:false});
  embedded.push({id,source:c.source,sha256:digest(file),data:'data:audio/wav;base64,'+fs.readFileSync(file).toString('base64')});
 }
 assert.equal(digest(workspace),before);assert(protectedFiles.every(p=>digest(p.file)===p.sha256));
 const html=path.join(root,'声音对照试听.html');fs.writeFileSync(html,pageHtml(embedded,candidates[0].text),{flag:'wx'});
 const spread=Math.max(...output.map(c=>c.after.integratedLufs))-Math.min(...output.map(c=>c.after.integratedLufs));
 const report={at:new Date().toISOString(),html,text:candidates[0].text,candidates:output,loudnessSpreadLu:spread,comparableLoudness:spread<.3,processing:'constant-gain-and-48000Hz-mono-pcm16-only',newModelSubmissions:0,verifiedHumanControl:false,humanListeningAccepted:false,naturalnessAccepted:false,characterMatchAccepted:false,productionDefaultsChanged:false,workspaceUnchanged:true,protectedFilesUnchanged:protectedFiles.length,completeReplica:false};
 fs.writeFileSync(path.join(root,'preparation.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({html,samples:output.map(({id,duration,after})=>({id,duration,after})),loudnessSpreadLu:spread,naturalnessAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
