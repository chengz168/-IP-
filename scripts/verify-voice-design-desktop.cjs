const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),workspace=path.resolve('evidence/validation/musetalk-integration-20261115/workspace');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
async function main(){
 const action=process.argv[2],kind=process.argv[3]||'clear',browser=await chromium.connectOverCDP('http://127.0.0.1:9351'),page=browser.contexts()[0].pages()[0],errors=[];
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 const call=(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload});
 const until=async predicate=>{for(let n=0;n<150;n++){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,200));}throw Error('等待产品状态超时，先查原任务，禁止重复生成');};
 const menu=async name=>{await page.locator('.top-menu>button').click();await page.getByRole('navigation',{name:'主菜单',exact:true}).getByRole('button',{name,exact:true}).click();};
 const open=async()=>{if(await page.getByRole('dialog',{name:'设计新音色',exact:true}).count())return;await menu('声音管理');await page.getByRole('button',{name:'设计新音色',exact:true}).click();await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor();};
 try{
  if(action==='prepare'){
   assert(!fs.existsSync(path.join(root,'ui-prepared.json')),'已有配置验证，先读取已有收据');
   await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('textbox',{name:'自主音色环境路径',exact:true}).fill('D:/AI-Runtimes/super-ip/qwen3-tts-voice-design');
   await page.getByRole('button',{name:'保存设置',exact:true}).click();await until(async()=>{const state=await call('state');return state.settings.provider.voiceDesignHome==='D:/AI-Runtimes/super-ip/qwen3-tts-voice-design';});
   await open();await page.screenshot({path:path.join(root,'voice-design-empty.png')});write('ui-prepared.json',{at:new Date().toISOString(),settingsSavedThroughButton:true,modalOpenedThroughButton:true,pageErrors:errors});return;
  }
  if(action==='check'){
   await menu('设置');await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'检查自主音色环境',exact:true}).click();
   await page.getByRole('dialog',{name:'自主音色环境检查通过',exact:true}).waitFor({timeout:180000});
   await page.screenshot({path:path.join(root,'voice-design-environment-ready.png')});write('ui-environment-ready.json',{at:new Date().toISOString(),checkedThroughProductButton:true,pageErrors:errors});
   await page.getByRole('button',{name:'知道了',exact:true}).click();return;
  }
  if(action==='submit'){
   const file='qwen-'+kind+'-submission.json';assert(!fs.existsSync(path.join(root,file)),'已有提交记录，先查询原ID');
   const state=await call('state');assert(!state.runs.some(run=>['running','queued','unknown'].includes(run.status)));
   await open();const job=read('job-'+kind+'.json'),labels={clear:'清亮夜聊',warm:'温暖从容',lively:'轻松生活感',chat:'连贯聊天对照',oral:'口语正文对照'};assert(labels[kind]);
   // 新实验只通过既有表单填写，不把未经听审的描述改成生产预设。
   if(['chat','oral'].includes(kind))await page.locator('#design-voice-description').fill(job.instruct);
   else await page.getByRole('button',{name:labels[kind],exact:true}).click();
   await page.locator('#design-voice-text').fill(job.text);await page.getByRole('textbox',{name:'声音名称',exact:true}).fill(labels[kind]);
   assert.equal(await page.locator('#design-voice-description').inputValue(),job.instruct);
   const submission={at:new Date().toISOString(),kind,draftId:state.currentId,job,clicked:false};write(file,submission);
   await page.getByRole('button',{name:'生成试听',exact:true}).click();submission.clicked=true;write(file,submission);
   const run=await until(async()=>{const data=await call('state');return data.runs.find(run=>run.type==='voice-design'&&run.draftId===submission.draftId&&!state.runs.some(prior=>prior.id===run.id));});
   submission.runId=run.id;submission.submittedThroughProductButton=true;write(file,submission);console.log(JSON.stringify({runId:run.id,status:run.status,kind}));return;
  }
  const submission=read('qwen-'+kind+'-submission.json'),state=await call('state'),run=state.runs.find(run=>run.id===submission.runId);assert(run);
  if(action==='status'){write('qwen-'+kind+'-status.json',{at:new Date().toISOString(),run});let worker;try{worker=JSON.parse(fs.readFileSync(path.join(run.local.directory,'result.json'),'utf8'));}catch{}console.log(JSON.stringify({id:run.id,status:run.status,error:run.error,local:run.local,worker:worker?{status:worker.status,modelLoaded:worker.modelLoaded,inferenceStarted:worker.inferenceStarted,error:worker.error}:null}));return;}
  if(action==='collect'){
   assert.equal(run.status,'succeeded',run.error);const stored=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8')),asset=stored.assets.find(asset=>asset.id===run.output.assetId);assert(asset);assert.equal(asset.voiceDesign.outputSha256,digest(asset.path));
   const file=path.join(root,'Qwen-'+kind+'-自主音色.wav');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);write('qwen-'+kind+'-generated.json',{at:new Date().toISOString(),run,file,sha256:digest(file),generatedThroughProductButton:true,newSpeechGenerated:true,referenceAudio:null,qualityAccepted:false});
   console.log(JSON.stringify({file,duration:asset.duration,kind,qualityAccepted:false}));return;
  }
  if(action==='playback'){
   assert.equal(run.status,'succeeded',run.error);await open();const audio=page.locator('.voice-design-audition audio');await audio.waitFor();await page.waitForFunction(()=>document.querySelector('.voice-design-audition audio')?.readyState>=2);
   await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.voice-design-audition audio')?.ended,null,{timeout:90000});
   const ended=await audio.evaluate(node=>({ended:node.ended,duration:node.duration,muted:node.muted,error:node.error?.message||''}));assert(ended.ended&&!ended.muted&&!ended.error);
   await page.screenshot({path:path.join(root,'qwen-'+kind+'-played.png')});await page.reload();await page.locator('.app main').waitFor();await open();await page.locator('.voice-design-audition audio').waitFor();
   const refreshed=await call('state'),latest=refreshed.runs.find(run=>run.type==='voice-design'&&run.draftId===submission.draftId);assert.equal(latest.id,submission.runId);assert(await page.getByRole('button',{name:'保存到声音库',exact:true}).isDisabled());
   write('qwen-'+kind+'-playback.json',{at:new Date().toISOString(),runId:run.id,ended,fullNativePlaybackToEnded:true,refreshCandidateRecovered:true,saveRequiresNewAudition:true,pageErrors:errors,listeningAccepted:false,qualityAccepted:false});return;
  }
  if(action==='save'){
   assert.equal(run.status,'succeeded',run.error);await open();
   await page.getByRole('textbox',{name:'声音名称',exact:true}).fill(({clear:'清亮夜聊',warm:'温暖从容',lively:'轻松生活感'})[kind]+'候选');
   const audio=page.locator('.voice-design-audition audio');await page.waitForFunction(()=>document.querySelector('.voice-design-audition audio')?.readyState>=2);
   await audio.evaluate(async node=>{node.currentTime=0;node.muted=false;await node.play();});await page.waitForFunction(()=>document.querySelector('.voice-design-audition audio')?.ended,null,{timeout:90000});
   await page.getByRole('button',{name:'保存到声音库',exact:true}).click();await page.getByRole('dialog',{name:'设计新音色',exact:true}).waitFor({state:'detached'});
   const updated=await call('state'),resource=updated.voices.find(voice=>voice.sampleId===run.output.assetId);assert(resource);assert.equal(resource.provenance.qualityAccepted,false);
   await page.reload();await page.locator('.app main').waitFor();const refreshed=await call('state');assert(refreshed.voices.some(voice=>voice.id===resource.id));
   write('qwen-'+kind+'-saved.json',{at:new Date().toISOString(),resource,actualSaveButton:true,refreshLibraryPreserved:true,pageErrors:errors,userQualityAccepted:false});console.log(JSON.stringify({voiceId:resource.id,name:resource.name,qualityAccepted:false}));return;
  }
  throw Error('未知验证动作');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
