const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-match-review-20261115'),mode=process.argv[2];
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2));
async function main(){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const poll=async(predicate,timeout=180000)=>{const start=Date.now();while(Date.now()-start<timeout){const result=await predicate();if(result)return result;await new Promise(r=>setTimeout(r,500));}throw Error('等待已有声音任务超时，禁止自动重交');};
 try{
  if(mode==='prepare'){
   assert(!fs.existsSync(path.join(root,'candidates.json')),'已有候选任务记录，不覆盖');
   const prepared=read('prepared.json'),source=prepared.files.find(f=>f.role.startsWith('参考原声'));assert.equal(digest(source.path),source.sha256);
   const before=await call('state');assert(!before.runs.some(r=>['running','queued'].includes(r.status)));
   write('authorization.json',{at:new Date().toISOString(),kind:'user-confirmation',userStatement:'有使用授权，按原声音色做对照',source:source.source,sourceSha256:source.sourceSha256,scope:'本地声音克隆短句对照与视频制作',independentContractVerified:false});
   const sample=await call('importFile',{name:'示例二原声-授权参考12秒.wav',base64:fs.readFileSync(source.path).toString('base64')});assert.equal(digest(sample.path),source.sha256);
   const voice=await call('saveResource',{type:'voice',item:{name:'示例二原声-授权参考',sampleId:sample.id}}),drafts=[];
   for(const [label,speed] of [['normal',1],['slower',.95]]){
    const draft=await call('newDraft');Object.assign(draft,{title:'示例二原声短句对照-'+label,step:2,mode:'manual',sourceText:prepared.testText,rewrite:prepared.testText,finalText:prepared.testText,confirmed:true});
    Object.assign(draft.voice,{profile:voice.id,audioId:'',speed,emotion:'',strength:.7});await call('saveDraft',draft);drafts.push({label,speed,id:draft.id});
   }
   write('candidates.json',{at:new Date().toISOString(),returnDraftId:before.currentId,reference:{...source,id:sample.id,assetPath:sample.path},voiceId:voice.id,text:prepared.testText,drafts,inputSetupThroughProductApi:true,modelSubmissions:0,qualityAccepted:false});
   console.log(JSON.stringify({prepared:true,drafts,originalVoiceCloneAuthorizedByUser:true}));return;
  }
  const candidates=read('candidates.json'),label=process.argv[3],candidate=candidates.drafts.find(d=>d.label===label);assert(candidate,'请选择normal或slower');
  if(mode==='generate'){
   const submissionName='submission-'+label+'.json';assert(!fs.existsSync(path.join(root,submissionName)),'已有该候选提交凭据，不重复生成');
   const before=await call('state');assert(!before.runs.some(r=>['running','queued'].includes(r.status)));assert(!before.runs.some(r=>r.draftId===candidate.id));
   await call('selectDraft',{id:candidate.id});await page.reload();await page.locator('.voice-config').waitFor();
   const state=await call('state'),draft=state.drafts.find(d=>d.id===candidate.id);assert.equal(draft.finalText,candidates.text);assert.equal(draft.voice.profile,candidates.voiceId);assert.equal(draft.voice.speed,candidate.speed);assert.equal(draft.voice.emotion,'');
   assert((await page.locator('.voice-config').innerText()).includes('示例二原声-授权参考'));
   write(submissionName,{at:new Date().toISOString(),candidate,clicked:false,referenceSha256:candidates.reference.sha256,text:candidates.text});
   await page.getByRole('button',{name:'生成声音',exact:true}).click();write(submissionName,{...read(submissionName),clicked:true,submittedThroughProductButton:true});
   const run=await poll(async()=>{const state=await call('state');return state.runs.find(r=>r.draftId===candidate.id&&r.type==='speech');});write(submissionName,{...read(submissionName),runId:run.id});
   const finished=await poll(async()=>{const state=await call('state'),run=state.runs.find(r=>r.draftId===candidate.id&&r.type==='speech');return run&&run.status!=='running'&&run.status!=='queued'?run:false;},600000);assert.equal(finished.status,'succeeded',finished.error);
   assert.equal(finished.output.speech.referenceSha256,candidates.reference.sha256);assert.equal(finished.output.speech.speed,candidate.speed);
   const file=path.join(root,'原声参考-新生成-'+label+'.wav');fs.copyFileSync(finished.output.path,file,fs.constants.COPYFILE_EXCL);
   write('generated-'+label+'.json',{at:new Date().toISOString(),run:finished,file,sha256:digest(file),text:candidates.text,newSpeechGenerated:true,referenceAudioOnlyReused:true,submittedThroughProductButton:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});
   await page.screenshot({path:path.join(root,'generated-'+label+'.png')});console.log(JSON.stringify({label,runId:finished.id,file,duration:finished.output.duration}));return;
  }
  if(mode==='playback'){
   const generated=read('generated-'+label+'.json');await call('selectDraft',{id:candidate.id});await page.reload();await page.locator('.voice-config').waitFor();
   const audio=page.locator('.audio-result audio[controls]');await audio.waitFor();await page.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.readyState>=2);
   await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.audio-result audio[controls]')?.ended,null,{timeout:90000});
   const ended=await audio.evaluate(node=>({ended:node.ended,duration:node.duration,error:node.error?.message||'',muted:node.muted}));assert(ended.ended&&!ended.error&&!ended.muted);
   await page.reload();await page.locator('.voice-config').waitFor();const state=await call('state');assert.equal(state.drafts.find(d=>d.id===candidate.id).voice.audioId,generated.run.output.id);
   write('playback-'+label+'.json',{at:new Date().toISOString(),runId:generated.run.id,ended,fullNativePlaybackToEnded:true,refreshBinding:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});return;
  }
  throw Error('未知候选操作');
 }catch(error){write('error-'+mode+'-'+Date.now()+'.json',{error:error.stack,pageErrors:errors});throw error;}
 finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
