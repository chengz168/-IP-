// 复用已有真实口型视频验证字幕、封面和后台流程，不冒充重新生成声音或口型。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs'),{Media,runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/caption-cover-readability-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),state=()=>read(workspace),load=name=>read(path.join(root,name)),write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
const active=data=>data.runs.filter(r=>['running','queued','unknown'].includes(r.status));
async function connected(work){const b=await chromium.connectOverCDP('http://127.0.0.1:9351');try{const p=b.contexts()[0].pages()[0];p.setDefaultTimeout(15000);return await work(p,(action,payload={})=>p.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}));}finally{await b.close();}}
async function until(work,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){const result=await work();if(result)return result;await new Promise(r=>setTimeout(r,300));}throw Error('观察原任务超时，查询既有任务，不重新提交');}
async function shot(page,name){const session=await page.context().newCDPSession(page);try{const image=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(root,name),Buffer.from(image.data,'base64'),{flag:'wx'});}finally{await session.detach();}}
async function main(){
 fs.mkdirSync(root,{recursive:true});const mode=process.argv[2];
 if(mode==='cover-config')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'prepared.json')),'已有配置收据');const id=load('created.json').id;
  await page.getByRole('button',{name:'V3-黄字描黑',exact:true}).click({noWaitAfter:true});
  await until(()=>state().drafts.find(d=>d.id===id).cover.scene?.layers.find(l=>l.id==='main')?.style.boxWidth===972);
  const draft=state().drafts.find(d=>d.id===id);assert.equal(draft.edit.subtitleTemplate,'simple_blue_white');
  await shot(page,'cover-configured.png');await page.locator('.steps>button').nth(1).click({noWaitAfter:true});await until(()=>state().drafts.find(d=>d.id===id).step===1);
  const plan=await call('planWorkflow',{id});assert.deepEqual(plan.issues,['请先确认最终文案']);const old=read('evidence/validation/local-full-workflow-20261115/generated.json');
  write('prepared.json',{at:new Date().toISOString(),draftId:id,text:old.draft.finalText,source:old.outputs.avatar,plan,newSpeechGenerated:false,newLipSyncGenerated:false,subtitleAndCoverChosenThroughActualButtons:true});console.log(JSON.stringify({draftId:id,plan:plan.stages.map(s=>({key:s.key,action:s.action}))}));return;
 });
 if(['prepare','configure','surface'].includes(mode))return connected(async(page,call)=>{
  const resume=mode!=='prepare';assert(resume||!fs.existsSync(path.join(root,'baseline.json')),'已有准备记录，禁止重复创建');assert(!fs.existsSync(path.join(root,'prepared.json')),'配置已完成');const before=state();assert.equal(active(before).length,0);assert(!(before.workflowJobs||[]).some(j=>['running','queued','stopping'].includes(j.status)));
  const protectedFiles=read('evidence/validation/voice-design-20261115/prepared.json').protectedFiles;assert(protectedFiles.every(p=>digest(p.file)===p.sha256));
  const old=read('evidence/validation/local-full-workflow-20261115/generated.json');assert.equal(digest(old.outputs.avatar.path),old.outputs.avatar.sha256);
  if(!resume)write('baseline.json',{at:new Date().toISOString(),currentId:before.currentId,drafts:before.drafts,settings:before.settings,voices:before.voices,publishRecords:before.publishRecords,protectedFiles,runIds:before.runs.map(r=>r.id)});
  const draft=resume?before.drafts.find(d=>d.id===load('created.json').id):await call('newDraft');assert(draft);if(!resume)write('created.json',{id:draft.id});const text=old.draft.finalText;
  Object.assign(draft,{title:'字幕与封面宽度-真实验证',mode:'auto',step:4,sourceText:text,rewrite:text});
  Object.assign(draft.edit,{sourceId:old.outputs.avatar.id,subtitlesEnabled:true,captions:[],speed:1,volume:1});draft.cover.title=old.draft.cover.title;
  Object.assign(draft.publish,{title:old.draft.cover.title,description:text,tags:['#夜间散步']});if(mode!=='surface'){await call('saveDraft',draft);await page.reload();await page.locator('.steps>button').nth(4).click({noWaitAfter:true});}
  if(!await page.getByRole('group',{name:'字幕模式',exact:true}).count())await page.locator('.edit-nav .edit-nav-select').filter({hasText:'字幕'}).click({noWaitAfter:true});if(state().drafts.find(d=>d.id===draft.id).edit.subtitleMode!=='template')await page.getByRole('group',{name:'字幕模式',exact:true}).getByRole('button',{name:'模板',exact:true}).click({noWaitAfter:true});
  const {getSubtitleTemplate}=await import('../server/subtitle-templates.mjs');await page.getByRole('button',{name:getSubtitleTemplate('simple_blue_white').name,exact:true}).click({noWaitAfter:true});
  await page.locator('.steps>button').nth(5).click({noWaitAfter:true});await page.getByRole('button',{name:'V3-黄字描黑',exact:true}).click({noWaitAfter:true});
  await until(()=>state().drafts.find(d=>d.id===draft.id).cover.scene?.layers.find(l=>l.id==='main')?.style.boxWidth===972);
  await shot(page,'cover-configured.png');await page.locator('.steps>button').nth(1).click();await until(()=>state().drafts.find(d=>d.id===draft.id).step===1);
  const plan=await call('planWorkflow',{id:draft.id});assert.deepEqual(plan.issues,['请先确认最终文案']);assert.equal(plan.stages.find(s=>s.key==='transcribe').action,'generate');assert.equal(plan.stages.find(s=>s.key==='render').action,'generate');assert.equal(plan.stages.find(s=>s.key==='title').action,'reuse');
  write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,text,source:old.outputs.avatar,plan,newSpeechGenerated:false,newLipSyncGenerated:false,subtitleAndCoverChosenThroughActualButtons:true});console.log(JSON.stringify({draftId:draft.id,plan:plan.stages.map(s=>({key:s.key,action:s.action}))}));
 });
 const prepared=load('prepared.json');
 if(mode==='submit')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交意图，只查询原任务');assert.equal(state().currentId,prepared.draftId);assert.equal(active(state()).length,0);
  write('submission-intent.json',{at:new Date().toISOString(),draftId:prepared.draftId});await page.getByRole('button',{name:'确认使用',exact:true}).click();
  const job=await until(()=>state().workflowJobs.find(j=>j.draftId===prepared.draftId));write('submitted.json',{at:new Date().toISOString(),jobId:job.id,actualConfirmButton:true});console.log(JSON.stringify({id:job.id,status:job.status}));
 });
 const submitted=load('submitted.json'),data=state(),job=data.workflowJobs.find(j=>j.id===submitted.jobId);assert(job);
 if(mode==='status'){console.log(JSON.stringify({id:job.id,status:job.status,phase:job.phase,error:job.error,stages:job.stages.map(s=>({key:s.key,status:s.status,runId:s.runId,error:s.error}))}));return;}
 assert.equal(job.status,'awaiting_publish',job.error||'原任务未完成');
 const draft=data.drafts.find(d=>d.id===prepared.draftId),runs=data.runs.filter(r=>r.parameters?.workflowJobId===job.id);
 if(mode==='collect'){
  assert(runs.every(r=>r.status==='succeeded'));assert(!runs.some(r=>['speech','avatar'].includes(r.type)));
  const transcription=runs.find(r=>r.type==='transcribe'),raw=transcription.output.rawRecognition;assert(raw?.segments.some(s=>s.words?.length),'原始词级结果必须保留');
  const before=(await import('../server/caption-recognition.mjs')).recognitionRows(raw,prepared.source.duration,{maxChars:6});assert.deepEqual(before,draft.edit.captions);
  assert(!draft.edit.captions.some(r=>r.text==='了,'),'实际字幕仍有已确认的极短单字尾');assert(draft.edit.captions.some(r=>r.text.endsWith('亮了,')));
  const normalized=t=>String(t).replace(/\s/gu,'');assert.equal(normalized(draft.edit.captions.map(r=>r.text).join('')),normalized(raw.segments.map(r=>r.text).join('')));
  const outputs={};for(const [kind,id]of Object.entries({render:draft.edit.resultId,cover:draft.cover.assetId})){const asset=data.assets.find(a=>a.id===id);assert(asset);const target=path.join(root,kind+path.extname(asset.path));fs.copyFileSync(asset.path,target,fs.constants.COPYFILE_EXCL);outputs[kind]={...asset,file:target,sha256:digest(target)};}
  assert.equal(draft.cover.scene.layers.find(l=>l.id==='main').style.boxWidth,972);
  write('generated.json',{at:new Date().toISOString(),job,draft,runs,outputs,newSpeechGenerated:false,newLipSyncGenerated:false,rawWordEvidencePreserved:true});console.log(JSON.stringify({captions:draft.edit.captions,outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,v.file]))}));return;
 }
 if(mode==='media'){
  const generated=load('generated.json'),media=new Media({data}),{ffmpeg,ffprobe}=media.binaries(),probes={};
  for(const [kind,asset]of Object.entries(generated.outputs)){assert.equal(digest(asset.path),asset.sha256);probes[kind]=JSON.parse(await runProcess(ffprobe,['-v','error','-show_streams','-show_format','-of','json',asset.file]));await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.file,'-f','null','-']);assert.equal(probes[kind].streams.find(s=>s.codec_type==='video').width,1080);}
  const sample=draft.edit.captions.find(r=>r.text.endsWith('亮了,'));assert(sample);const time=(sample.start+sample.end)/2;
  await runProcess(ffmpeg,['-v','error','-n','-ss',String(time),'-i',generated.outputs.render.file,'-frames:v','1','-vf','scale=540:960',path.join(root,'caption-rebalanced.png')]);
  const pcms={};for(const [kind,file]of Object.entries({source:prepared.source.path,render:generated.outputs.render.file})){const pcm=path.join(root,kind+'.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',file,'-map','0:a:0','-ac','1','-ar','16000','-f','s16le',pcm]);pcms[kind]=fs.readFileSync(pcm);}
  let xx=0,yy=0,xy=0;for(let i=0;i<Math.min(pcms.source.length,pcms.render.length);i+=2){const x=pcms.source.readInt16LE(i),y=pcms.render.readInt16LE(i);xx+=x*x;yy+=y*y;xy+=x*y;}const correlation=xy/Math.sqrt(xx*yy);assert(correlation>.95);
  write('media.json',{at:new Date().toISOString(),probes,fullDecodeVerified:true,audioCorrelation:correlation,sampledCaption:sample,sampledTime:time,rawWordEvidencePreserved:true,coverQualityAccepted:false,sourceBodyAndBackgroundReused:true});console.log(JSON.stringify({correlation,sample}));return;
 }
 if(mode==='playback-finish')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'finished.json')),'已有恢复记录');await call('selectDraft',{id:draft.id});await page.reload();await page.locator('.steps>button').nth(6).click();const video=page.locator('.publish-columns video');await video.waitFor();await video.evaluate(async n=>{n.currentTime=0;n.muted=false;await n.play()});await page.waitForFunction(()=>document.querySelector('.publish-columns video')?.ended,null,{timeout:60000});
  const ended=await video.evaluate(n=>({ended:n.ended,source:n.currentSrc,duration:n.duration,muted:n.muted,error:n.error?.message||null}));assert.equal(ended.source,'media://asset/'+draft.edit.resultId);assert(!ended.error&&!ended.muted);await shot(page,'publish-playback.png');
  await page.locator('.steps>button').nth(5).click();await page.getByLabel('封面编辑画布',{exact:true}).waitFor();await shot(page,'cover-editor.png');
  await page.reload();await page.getByLabel('封面编辑画布',{exact:true}).waitFor();const after=state(),baseline=load('baseline.json');assert.equal(active(after).length,0);for(const original of baseline.drafts)assert.deepEqual(after.drafts.find(d=>d.id===original.id),original);for(const key of ['settings','voices','publishRecords'])assert.deepEqual(after[key],baseline[key]);assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));
  assert.equal(after.drafts.find(d=>d.id===draft.id).cover.assetId,draft.cover.assetId);assert.equal(after.workflowJobs.filter(j=>j.draftId===draft.id).length,1);
  await call('selectDraft',{id:baseline.currentId});await page.reload();await page.locator('.app main').waitFor();write('finished.json',{at:new Date().toISOString(),ended,originalDraftsUnchanged:true,settingsUnchanged:true,publishRecordsUnchanged:true,voicesUnchanged:true,protectedFilesUnchanged:baseline.protectedFiles.length,restoredDraftId:baseline.currentId,refreshBinding:true,duplicateJobs:0,unfinishedRuns:0,naturalnessAccepted:false,referenceParityAccepted:false});console.log(JSON.stringify({ended,restored:baseline.currentId}));
 });
 throw Error('未知动作');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
