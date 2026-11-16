// 从实际确认按钮开始验证本地自动链；只查询已提交任务，不因观察超时重交。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/local-full-workflow-20261115');
const workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),state=()=>read(workspace);
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
const active=data=>data.runs.filter(r=>['running','queued','unknown'].includes(r.status));
async function connected(work){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9351');
 try{const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));return await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),errors);}
 finally{await browser.close();}
}
async function until(work,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){const value=await work();if(value)return value;await new Promise(r=>setTimeout(r,200));}throw Error('观察原任务超时，请查询现有凭据，禁止自动重新提交');}
async function menu(page,label){if(!await page.getByRole('navigation',{name:'主菜单',exact:true}).count())await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name:label,exact:true}).click();}
async function screenshot(page,name){const session=await page.context().newCDPSession(page);try{const result=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(root,name),Buffer.from(result.data,'base64'),{flag:'wx'});}finally{await session.detach();}}
async function main(){
 const mode=process.argv[2];
 if(mode==='prepare')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'baseline.json')),'已有准备凭据，不重复创建草稿');
  const before=await call('state');assert.equal(active(before).length,0);assert(!(before.workflowJobs||[]).some(j=>['queued','running','stopping'].includes(j.status)));
  const protectedFiles=read('evidence/validation/voice-design-20261115/prepared.json').protectedFiles;assert(protectedFiles.every(p=>digest(p.file)===p.sha256));
  write('baseline.json',{at:new Date().toISOString(),currentId:before.currentId,drafts:before.drafts,publishRecords:before.publishRecords,settings:before.settings,runIds:before.runs.map(r=>r.id),protectedFiles});
  const draft=await call('newDraft');write('draft-created.json',{id:draft.id});
  Object.assign(draft,{title:'本地完整自动制作链-技术验收',mode:'auto',step:1,sourceText:'路边的灯亮了，出来走走。忙了一天，给自己留几分钟。',rewrite:'路边的灯亮了，出来走走。忙了一天，给自己留几分钟。'});
  Object.assign(draft.voice,{profile:'fbe0424d-c019-4c13-9c9e-60e7f1b7498a',speed:1,emotion:'',strength:.7,audioId:''});
  Object.assign(draft.video,{mode:'single',avatarId:'musetalk-night-shape',audioId:'',assetId:'',shots:[]});
  const voice=before.voices.find(v=>v.id===draft.voice.profile);assert.equal(voice.provenance.qualityAccepted,false);
  assert(before.avatars.some(a=>a.id===draft.video.avatarId));await call('saveDraft',draft);await page.reload();await page.locator('.steps>button').first().waitFor();await menu(page,'新工作流');
  await page.locator('.steps>button').nth(4).click();await page.locator('.edit-nav .edit-nav-select').filter({hasText:'字幕'}).click();
  await page.getByRole('group',{name:'字幕模式',exact:true}).getByRole('button',{name:'模板',exact:true}).click();
  const {subtitleTemplates}=await import('../server/subtitle-templates.mjs'),template=subtitleTemplates.find(t=>t.id==='simple_blue_white');assert(template);
  await page.getByRole('button',{name:template.name,exact:true}).click();
  await page.locator('.steps>button').nth(5).click();await page.getByRole('button',{name:'V3-黄字描黑',exact:true}).click();
  await until(()=>{const d=state().drafts.find(d=>d.id===draft.id);return d.edit.subtitleTemplate===template.id&&d.cover.template==='v3'});
  await page.locator('.steps>button').nth(1).click();await until(()=>state().drafts.find(d=>d.id===draft.id).step===1);
  const configured=(await call('state')).drafts.find(d=>d.id===draft.id);assert(!configured.confirmed);assert(!configured.voice.audioId&&!configured.video.assetId&&!configured.edit.resultId&&!configured.cover.assetId);
  const plan=await call('planWorkflow',{id:draft.id});assert.deepEqual(plan.issues,['请先确认最终文案']);assert(plan.stages.filter(s=>s.key!=='publish').every(s=>s.action==='generate'));
  write('prepared.json',{at:new Date().toISOString(),draftId:draft.id,text:configured.rewrite,input:configured,plan,voiceQualityAccepted:false,subtitleTemplateSelectedThroughButton:true,coverTemplateSelectedThroughButton:true,pageErrors:errors});
  await screenshot(page,'configured.png');console.log(JSON.stringify({draftId:draft.id,plan:plan.stages.map(s=>({key:s.key,action:s.action})),voiceQualityAccepted:false}));
 });
 const prepared=read(path.join(root,'prepared.json'));
 if(mode==='submit')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交凭据，只查询原任务');const before=await call('state');assert.equal(active(before).length,0);assert.equal(before.currentId,prepared.draftId);assert(!(before.workflowJobs||[]).some(j=>j.draftId===prepared.draftId));
  write('submission-intent.json',{at:new Date().toISOString(),draftId:prepared.draftId,oldJobIds:(before.workflowJobs||[]).map(j=>j.id)});
  await page.getByRole('button',{name:'确认使用',exact:true}).click();
  const job=await until(async()=>{const s=await call('state');return s.workflowJobs?.find(j=>j.draftId===prepared.draftId)});
  write('submitted.json',{at:new Date().toISOString(),draftId:prepared.draftId,jobId:job.id,confirmedAndStartedThroughProductButton:true});
  assert(job.stages.filter(s=>s.key!=='publish').every(s=>s.action==='generate'));
  await menu(page,'任务中心');await page.reload();await page.locator('.app main').waitFor();await menu(page,'任务中心');
  const after=await call('state');assert.equal(after.workflowJobs.filter(j=>j.draftId===prepared.draftId).length,1);assert.equal(after.workflowJobs.find(j=>j.id===job.id).id,job.id);
  write('navigation.json',{at:new Date().toISOString(),jobId:job.id,statusAfterReload:after.workflowJobs.find(j=>j.id===job.id).status,workflowCountForDraft:1,pageErrors:errors});
  await screenshot(page,'background-running.png');console.log(JSON.stringify({jobId:job.id,status:job.status}));
 });
 const submitted=read(path.join(root,'submitted.json')),data=state(),job=data.workflowJobs.find(j=>j.id===submitted.jobId);assert(job);
 if(mode==='status'){
  const run=data.runs.find(r=>r.parameters?.workflowJobId===job.id&&r.status==='running');let livePid=false,workerStatus;
  if(run?.local?.pid){try{process.kill(run.local.pid,0);livePid=true}catch{}try{workerStatus=read(path.join(run.local.directory,'result.json')).status}catch{}}
  console.log(JSON.stringify({id:job.id,status:job.status,phase:job.phase,error:job.error,stages:job.stages.map(s=>({key:s.key,status:s.status,runId:s.runId,error:s.error})),run:run?{id:run.id,type:run.type,progress:run.progress,activity:run.activity,local:run.local,livePid,workerStatus}:null}));return;
 }
 assert.equal(job.status,'awaiting_publish',job.error||'原任务尚未完成，不重复提交');
 const draft=data.drafts.find(d=>d.id===prepared.draftId);
 if(mode==='collect'){
  assert(job.stages.filter(s=>s.key!=='publish').every(s=>s.status==='succeeded'));assert.equal(job.stages.find(s=>s.key==='publish').status,'waiting');
  const runs=data.runs.filter(r=>r.parameters?.workflowJobId===job.id);assert.equal(runs.length,8);assert(runs.every(r=>r.status==='succeeded'));
  const get=id=>{const asset=data.assets.find(a=>a.id===id);assert(asset);return {...asset,sha256:digest(asset.path)}};
  const speech=get(draft.voice.audioId),avatar=get(draft.video.assetId),render=get(draft.edit.resultId),cover=get(draft.cover.assetId);
  assert.equal(speech.origin,'local-indextts');assert.equal(avatar.origin,'local-musetalk');assert.equal(avatar.lipSync.drivingAudioId,speech.id);
  assert.equal(speech.speech.outputSha256,speech.sha256);assert.equal(avatar.lipSync.outputSha256,avatar.sha256);
  assert(draft.edit.captions.length>0);assert(draft.edit.captions.every(row=>Array.from(row.text).length<=6));
  assert.equal(draft.edit.subtitleTemplate,'simple_blue_white');assert.equal(draft.cover.template,'v3');assert(draft.cover.title.trim());
  assert(draft.publish.title.trim()&&draft.publish.description.trim()&&draft.publish.tags.length);assert(!draft.publish.recordId);
  const outputs={speech,avatar,render,cover};for(const [key,item] of Object.entries(outputs)){const target=path.join(root,key+path.extname(item.path));fs.copyFileSync(item.path,target,fs.constants.COPYFILE_EXCL);assert.equal(digest(target),item.sha256);item.reviewFile=target;}
  write('generated.json',{at:new Date().toISOString(),job,draft,runs,outputs,voiceQualityAccepted:false,newSpeechGenerated:true,newLipSyncGenerated:true,sourceBodyAndBackgroundReused:true});
  console.log(JSON.stringify({jobId:job.id,stages:job.stages.map(s=>({key:s.key,status:s.status})),captions:draft.edit.captions,title:draft.cover.title,metadata:draft.publish,outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,{file:v.reviewFile,duration:v.duration}]))}));return;
 }
 if(mode==='playback')return connected(async(page,call,errors)=>{
  const revision=process.argv[3]||'';assert(/^[a-z0-9-]*$/.test(revision));const suffix=revision?'-'+revision:'';
  assert(!fs.existsSync(path.join(root,'playback'+suffix+'.json')),'已有完整播放凭据');await call('selectDraft',{id:prepared.draftId});await page.reload();await menu(page,'新工作流');await page.locator('.steps>button').nth(6).click();
  const video=page.locator('.publish-columns video');await video.waitFor();await video.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play()});
  const ended=await until(async()=>{const value=await video.evaluate(node=>({ended:node.ended,duration:node.duration,currentTime:node.currentTime,muted:node.muted,error:node.error?.message||null,source:node.currentSrc,width:node.videoWidth,height:node.videoHeight}));assert(!value.error);return value.ended?value:null},60000);
  assert(!ended.muted);assert.equal(ended.source,'media://asset/'+draft.edit.resultId);await screenshot(page,'publish-result'+suffix+'.png');
  await page.reload();await page.locator('.publish-columns video').waitFor();const current=await call('state');assert.equal(current.drafts.find(d=>d.id===prepared.draftId).edit.resultId,draft.edit.resultId);assert.equal(current.workflowJobs.filter(j=>j.draftId===prepared.draftId).length,1);
  write('playback'+suffix+'.json',{at:new Date().toISOString(),jobId:job.id,ended,fullNativePlaybackToEnded:true,refreshBinding:true,duplicateJobs:0,pageErrors:errors,humanListeningAccepted:false});console.log(JSON.stringify({ended,refreshBinding:true}));
 });
 if(mode==='export')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'export-intent.json')),'已有导出意图，先查发布记录');const before=await call('state');assert.equal(before.publishRecords.length,read(path.join(root,'baseline.json')).publishRecords.length);
  write('export-intent.json',{at:new Date().toISOString(),draftId:prepared.draftId});await page.getByRole('button',{name:'导出发布包',exact:true}).click();
  const record=await until(async()=>{const current=await call('state');return current.publishRecords.find(r=>r.draftId===prepared.draftId)});assert.equal(record.status,'exported');
  const metadata=read(path.join(record.directory,'发布信息.json'));assert.equal(metadata.status,'exported');assert.match(metadata.note,/尚未上传/);
  assert.equal(digest(path.join(record.directory,'video'+path.extname(data.assets.find(a=>a.id===draft.edit.resultId).path))),digest(data.assets.find(a=>a.id===draft.edit.resultId).path));
  assert.equal(digest(path.join(record.directory,'cover'+path.extname(data.assets.find(a=>a.id===draft.cover.assetId).path))),digest(data.assets.find(a=>a.id===draft.cover.assetId).path));
  write('exported.json',{at:new Date().toISOString(),record,metadata,videoMatches:true,coverMatches:true,actualExportButton:true,uploaded:false,pageErrors:errors});
  console.log(JSON.stringify({directory:record.directory,status:record.status,uploaded:false}));
 });
 if(mode==='finish')return connected(async(page,call)=>{
  assert(!fs.existsSync(path.join(root,'finished.json')),'已有恢复凭据');const baseline=read(path.join(root,'baseline.json'));const current=await call('state');assert.equal(active(current).length,0);
  for(const original of baseline.drafts)assert.deepEqual(current.drafts.find(d=>d.id===original.id),original);
  assert.deepEqual(current.settings,baseline.settings);for(const original of baseline.publishRecords)assert.deepEqual(current.publishRecords.find(r=>r.id===original.id),original);
  assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));assert.equal(current.publishRecords.length,baseline.publishRecords.length+1);
  const dialog=page.getByRole('dialog',{name:'发布包已导出',exact:true});if(await dialog.count())await dialog.getByRole('button',{name:'知道了',exact:true}).click();
  await call('selectDraft',{id:baseline.currentId});await page.reload();await page.locator('.app main').waitFor();
  write('finished.json',{at:new Date().toISOString(),currentId:baseline.currentId,originalDraftsUnchanged:true,originalPublishRecordsUnchanged:true,settingsUnchanged:true,protectedFilesUnchanged:baseline.protectedFiles.length,unfinishedRuns:0,newWorkflowJobs:1,newExportRecords:1,uploaded:false,qualityAccepted:false});console.log(JSON.stringify({restored:baseline.currentId,qualityAccepted:false}));
 });
 throw Error('未知验证动作');
}
main().catch(error=>{console.error(error);process.exitCode=1});
