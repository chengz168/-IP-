// 对已生成的精确素材进行原生音频播放；不重交模型任务，不以播放成功替代听感。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),kind=process.argv[2];
assert(['chat','oral'].includes(kind));
const target=path.join(root,'qwen-'+kind+'-exact-playback.json');assert(!fs.existsSync(target),'已有实际播放记录，不覆盖');
const generated=JSON.parse(fs.readFileSync(path.join(root,'qwen-'+kind+'-generated.json'),'utf8'));
assert.equal(digest(generated.file),generated.sha256);
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  const state=await page.evaluate(()=>window.studio.invoke('state',{})),run=state.runs.find(r=>r.id===generated.run.id);
  assert.equal(run?.status,'succeeded');assert.equal(run.output.assetId,generated.run.output.assetId);
  assert(!state.runs.some(r=>['running','queued','unknown'].includes(r.status)),'生成任务未结束，不干扰当前工作');
  // 使用产品实际媒体协议；历史候选不再要求成为弹窗中的最新候选。
  await page.evaluate(({assetId,runId})=>{
   const audio=new Audio('media://asset/'+assetId);audio.id='naturalness-exact-audition';audio.controls=true;audio.preload='auto';audio.muted=false;
   const holder=document.createElement('aside');holder.id='naturalness-exact-holder';holder.style.cssText='position:fixed;bottom:18px;left:18px;z-index:10000;padding:12px;background:white;border:1px solid #ccc;border-radius:10px';
   const label=document.createElement('div');label.textContent='本轮真实候选试听';holder.append(label,audio);document.body.append(holder);
   window.__naturalnessAudition={runId,assetId,ended:false,error:null};
   audio.addEventListener('ended',()=>{window.__naturalnessAudition={runId,assetId,ended:audio.ended,duration:audio.duration,currentTime:audio.currentTime,muted:audio.muted,source:audio.currentSrc,error:audio.error?.message||null};});
   audio.addEventListener('error',()=>{window.__naturalnessAudition.error=audio.error?.message||'音频加载失败';});
  },{assetId:run.output.assetId,runId:run.id});
  await page.locator('#naturalness-exact-audition').evaluate(audio=>audio.play());
  const started=Date.now();let ended;
  while(Date.now()-started<40000){ended=await page.evaluate(()=>window.__naturalnessAudition);if(ended.error)throw Error(ended.error);if(ended.ended)break;await new Promise(resolve=>setTimeout(resolve,200));}
  assert(ended?.ended&&!ended.muted&&!ended.error);assert.equal(ended.source,'media://asset/'+run.output.assetId);
  fs.writeFileSync(target,JSON.stringify({at:new Date().toISOString(),kind,runId:run.id,file:generated.file,sha256:generated.sha256,ended,
   fullNativePlaybackToEnded:true,exactAssetVerified:true,usedActualProductMediaProtocol:true,temporaryAuditionControl:true,
   refreshCandidateRecovered:false,refreshNotTested:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false},null,2),{flag:'wx'});
  console.log(JSON.stringify({kind,duration:ended.duration,fullNativePlaybackToEnded:true,qualityAccepted:false}));
 }finally{
  await page.evaluate(()=>{document.querySelector('#naturalness-exact-audition')?.pause();document.querySelector('#naturalness-exact-holder')?.remove();delete window.__naturalnessAudition;}).catch(()=>{});
  await browser.close();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
