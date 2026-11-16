// 沿用用户偏好的C，仅调整两处断句；不把自动检查当作真人感验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-C-prosody-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),state=()=>read(workspace),load=name=>read(path.join(root,name));
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
async function connected(work){const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');try{const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);return await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}));}finally{await browser.close();}}
function active(data){return data.runs.filter(r=>['running','queued','unknown'].includes(r.status));}
async function main(){
 fs.mkdirSync(root,{recursive:true});const mode=process.argv[2];
 if(mode==='submit')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'baseline.json')),'已有准备记录，查询原任务，不重复创建');const before=state();assert.equal(active(before).length,0);
  const C=read('evidence/validation/voice-listening-review-20261115/preparation.json').candidates.find(c=>c.id==='C');assert.equal(digest(C.file),C.sha256);
  const old=before.runs.find(r=>r.id===C.runId);assert.equal(old.status,'succeeded');assert.equal(old.output.speech.speed,1);assert.equal(old.output.speech.emotion,'');
  const voiceId='7b4368bc-fac1-4732-aa5c-feee7abb7fb4',voice=before.voices.find(v=>v.id===voiceId);assert(voice);const reference=before.assets.find(a=>a.id===voice.sampleId);assert.equal(digest(reference.path),old.output.speech.referenceSha256);
  const text='晚上出来走一走，刚好路边的灯都亮了。忙了一天先给自己留几分钟，慢慢走也慢慢聊。';assert.equal(normalize(text),normalize(C.text));
  const protectedFiles=read('evidence/validation/voice-design-20261115/prepared.json').protectedFiles;assert(protectedFiles.every(p=>digest(p.file)===p.sha256));
  write('baseline.json',{at:new Date().toISOString(),currentId:before.currentId,drafts:before.drafts,settings:before.settings,publishRecords:before.publishRecords,voices:before.voices,protectedFiles});
  const draft=await call('newDraft');write('draft-created.json',{id:draft.id});
  Object.assign(draft,{title:'C音色-两处断句对照',mode:'manual',step:2,sourceText:text,rewrite:text,finalText:text,confirmed:true});Object.assign(draft.voice,{profile:voiceId,audioId:'',speed:1,emotion:'',strength:.7});
  await call('saveDraft',draft);await page.reload();await page.locator('.voice-config').waitFor();
  write('submission-intent.json',{at:new Date().toISOString(),draftId:draft.id,text,baselineC:C,referenceId:reference.id,referenceSha256:digest(reference.path),seed:42,speed:1,emotion:'',strength:.7,onlyPunctuationChanged:true});
  await page.getByRole('button',{name:'生成声音',exact:true}).click();
  const start=Date.now();let run;while(Date.now()-start<15000){run=state().runs.find(r=>r.type==='speech'&&r.draftId===draft.id);if(run)break;await new Promise(r=>setTimeout(r,200));}
  assert(run,'已点击但未查到任务，不得自动重交');write('submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:draft.id,throughActualProductButton:true});console.log(JSON.stringify({runId:run.id,status:run.status,text}));
 });
 const input=load('submission-intent.json'),submitted=load('submitted.json'),data=state(),run=data.runs.find(r=>r.id===submitted.runId);assert(run);
 if(mode==='status'){console.log(JSON.stringify({id:run.id,status:run.status,progress:run.progress,error:run.error}));return;}
 assert.equal(run.status,'succeeded',run.error||'原任务未完成，不重新提交');
 const asset=data.assets.find(a=>a.id===run.output.id);assert(asset);assert.equal(asset.speech.referenceSha256,input.referenceSha256);assert.equal(asset.speech.speed,input.speed);assert.equal(asset.speech.seed,input.seed);assert.equal(asset.speech.emotion,input.emotion);assert.equal(asset.speech.strength,input.strength);
 if(mode==='collect'){
  const file=path.join(root,'C1-合并两处断句.wav');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);assert.equal(digest(file),asset.speech.outputSha256);
  write('generated.json',{at:new Date().toISOString(),run,asset,file,sha256:digest(file),text:input.text,newInference:true,onlyPunctuationChanged:true,naturalnessAccepted:false});console.log(JSON.stringify({file,duration:asset.duration}));return;
 }
 if(mode==='inspect'){
  assert(!fs.existsSync(path.join(root,'inspection.json')),'已有检查，不重复');const media=new Media({data,asset:id=>data.assets.find(a=>a.id===id)}),{ffmpeg}=media.binaries(),probe=await media.probe(asset.path);
  await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-f','null','-']);const pcm=path.join(root,'native.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-map','0:a:0','-f','s16le',pcm]);
  const bytes=fs.readFileSync(pcm);let fullScale=0,peak=0;for(let i=0;i<bytes.length;i+=2){const n=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(n));if(n===32767||n===-32768)fullScale++;}assert(peak>0);assert.equal(fullScale,0);
  const asr=await new LocalAsr(media.store,media).transcribe(asset.id),recognized=simplified(asr.text),textMatches=normalize(recognized)===normalize(input.text);
  const gaps=asr.segments.flatMap(s=>s.words||[]).flatMap((w,i,all)=>i?[{before:w.word,gap:w.start-all[i-1].end}]:[]);
  write('inspection.json',{at:new Date().toISOString(),file:asset.path,sha256:digest(asset.path),probe,fullDecodeVerified:true,signal:{peakNormalized:peak/32768,fullScaleSamples:fullScale},asr,recognized,textMatches,wordGaps:gaps,naturalnessAccepted:false});console.log(JSON.stringify({duration:probe.format.duration,recognized,textMatches,fullScale}));return;
 }
 if(mode==='playback-finish')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'finished.json')),'已有恢复凭据');await call('selectDraft',{id:submitted.draftId});await page.reload();await page.locator('.voice-config').waitFor();
  const audio=page.locator('.audio-result audio[controls]');await audio.waitFor();await audio.evaluate(async n=>{n.currentTime=0;n.muted=false;await n.play()});await page.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.ended,null,{timeout:60000});
  const ended=await audio.evaluate(n=>({ended:n.ended,duration:n.duration,muted:n.muted,source:n.currentSrc,error:n.error?.message||null}));assert(!ended.muted&&!ended.error);assert.equal(ended.source,'media://asset/'+asset.id);
  const current=state(),baseline=load('baseline.json');assert.equal(active(current).length,0);for(const original of baseline.drafts)assert.deepEqual(current.drafts.find(d=>d.id===original.id),original);for(const key of ['settings','publishRecords','voices'])assert.deepEqual(current[key],baseline[key]);assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));
  await call('selectDraft',{id:baseline.currentId});await page.reload();await page.locator('.app main').waitFor();
  write('finished.json',{at:new Date().toISOString(),ended,fullNativePlaybackToEnded:true,originalDraftsUnchanged:true,settingsUnchanged:true,voicesUnchanged:true,protectedFilesUnchanged:baseline.protectedFiles.length,restoredDraftId:baseline.currentId,unfinishedRuns:0,naturalnessAccepted:false,productionDefaultsChanged:false});console.log(JSON.stringify({ended,restoredDraftId:baseline.currentId}));
 });
 throw Error('未知动作');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
