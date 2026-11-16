// 分段观察同一真实产品任务，保留原始音频、识别差异和播放凭据，不自动评价真人感。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve(__dirname,'../evidence/validation/voice-C-long-script-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const state=()=>read('workspace/studio.json');
const write=(name,data)=>fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2),{flag:'wx'});
const mode=process.argv[2];
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,200))}throw Error('原任务观察超时，查原凭据，不重交');}
function source(){
 const input=read('prepared.json'),data=state(),submitted=read('submitted.json'),run=data.runs.find(item=>item.id===submitted.runId);
 assert(run);assert.equal(run.status,'succeeded',run.error||'原任务未结束');
 for(const key of ['text','referenceId','referenceSha256','seed','speed','emotion','strength','prosodyReferenceId'])assert.equal(run.parameters.input[key],input[key],key);
 assert.equal(run.parameters.input.model,'IndexTTS-2.5');
 const asset=data.assets.find(item=>item.id===run.output.id);assert(asset);assert.equal(asset.origin,'local-indextts');assert.equal(digest(asset.path),asset.speech.outputSha256);
 assert.equal(data.drafts.find(item=>item.id===input.draftId).voice.audioId,asset.id);
 return {input,data,run,asset};
}
async function connected(work){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9373');
 try{
  const pages=browser.contexts().flatMap(context=>context.pages());assert.equal(pages.length,1);
  const page=pages[0];page.setDefaultTimeout(15000);await page.locator('.voice-config').waitFor();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await work(page,(action,payload={})=>page.evaluate(({action,payload})=>window.studio.invoke(action,payload),{action,payload}),errors);
 }finally{await browser.close().catch(()=>{})}
}
async function main(){
 if(mode==='status'){
  const data=state(),submitted=read('submitted.json'),run=data.runs.find(item=>item.id===submitted.runId);assert(run);
  const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*local-indextts.py*' } | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress"],{windowsHide:true,encoding:'utf8'}).trim()||'[]');
  console.log(JSON.stringify({runId:run.id,status:run.status,progress:run.progress,error:run.error||null,workerProcesses:processes}));return;
 }
 if(mode==='inspect-ui')return connected(async(page,call)=>{
  const data=await call('state');assert.equal(data.currentId,read('prepared.json').draftId);
  console.log(JSON.stringify({textboxes:await page.getByRole('textbox').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),placeholder:node.getAttribute('placeholder')}))),buttons:await page.getByRole('button').allTextContents()}));
 });
 if(mode==='capture-first-playback')return connected(async(page)=>{
  const observed=await page.locator('.audio-result audio[controls]').evaluate(node=>({ended:node.ended,duration:node.duration,source:node.currentSrc,currentTime:node.currentTime,times:node.__times,seeks:node.__seeks,muted:node.muted,rate:node.playbackRate,error:node.error?.message||null}));
  write('playback-first-observation.json',{at:new Date().toISOString(),...observed,validationPassed:false,reason:'原检查在监听seeking之后设置currentTime=0，初始化定位也进入计数；重新播放核对，不重交生成'});
  console.log(JSON.stringify({ended:observed.ended,seeks:observed.seeks,observations:observed.times?.length}));
 });
 if(mode==='configure')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'configured.json')),'配置已完成，请继续原任务');
  const input=read('prepared.json'),before=await call('state');assert.equal(before.currentId,input.draftId);assert.equal(before.runs.length,0);
  const textbox=page.getByRole('textbox',{name:'最终文案',exact:true});await textbox.fill(input.text);await textbox.blur();
  const draft=await until(()=>{const draft=state().drafts.find(item=>item.id===input.draftId);return draft.finalText===input.text?draft:null});
  for(const [key,value] of Object.entries({profile:input.voiceId,speed:1,emotion:'',strength:.7,prosodyReferenceId:''}))assert.equal(draft.voice[key],value);
  assert(await page.getByRole('button',{name:'生成声音',exact:true}).isEnabled());
  await page.screenshot({path:path.join(root,'configured.png')});
  write('configured.json',{at:new Date().toISOString(),draftId:draft.id,text:draft.finalText,throughActualTextField:true,voice:draft.voice,pageErrors:errors});
  assert.equal(errors.length,0);console.log(JSON.stringify({draftId:draft.id,textLength:draft.finalText.length}));
 });
 if(mode==='submit')return connected(async(page,call)=>{
  assert(fs.existsSync(path.join(root,'configured.json')));assert(!fs.existsSync(path.join(root,'submission-intent.json')),'已有提交意图，不重复点击');
  const input=read('prepared.json'),data=await call('state');assert.equal(data.currentId,input.draftId);assert.equal(data.runs.length,0);
  assert.equal(data.drafts.find(item=>item.id===input.draftId).finalText,input.text);
  write('submission-intent.json',{at:new Date().toISOString(),...input,actualProductButton:true});
  await page.getByRole('button',{name:'生成声音',exact:true}).click();
  const run=await until(()=>state().runs.find(item=>item.type==='speech'&&item.draftId===input.draftId));
  write('submitted.json',{at:new Date().toISOString(),runId:run.id,draftId:input.draftId,actualProductButton:true});
  console.log(JSON.stringify({runId:run.id,status:run.status}));
 });
 if(mode==='collect'){
  assert(!fs.existsSync(path.join(root,'generated.json')));const {input,run,asset}=source();
  const file=path.join(root,'C音色-新文案连续口播.wav');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);
  write('generated.json',{at:new Date().toISOString(),run,asset,file,sha256:digest(file),text:input.text,newInference:true,humanQualityAccepted:false});
  console.log(JSON.stringify({file,duration:asset.duration,runId:run.id}));return;
 }
 if(mode==='inspect-audio'){
  assert(!fs.existsSync(path.join(root,'inspection.json')));const {input,data,run,asset}=source();
  const store={data,asset:id=>data.assets.find(item=>item.id===id)},media=new Media(store),{ffmpeg}=media.binaries();
  const metadata=await media.probe(asset.path);await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-f','null','-']);
  const file=path.join(root,'native.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-map','0:a:0','-f','s16le',file]);
  const bytes=fs.readFileSync(file);let peak=0,sum=0,fullScale=0;
  for(let i=0;i<bytes.length;i+=2){const sample=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;if(sample===32767||sample===-32768)fullScale++}
  assert(peak>0);assert.equal(fullScale,0);
  let meter='';await runProcess(ffmpeg,['-hide_banner','-nostats','-i',asset.path,'-af','silencedetect=noise=-40dB:d=0.35,loudnorm=I=-23:TP=-1.5:LRA=11:print_format=json','-f','null','-'],{onStderr:chunk=>{meter+=chunk}});
  fs.writeFileSync(path.join(root,'audio-meter.log'),meter,{flag:'wx'});
  const match=meter.match(/\{\s*"input_i"[\s\S]*?\}/);assert(match);const loudness=JSON.parse(match[0]);
  const silences=Array.from(meter.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g),value=>({end:Number(value[1]),duration:Number(value[2]),start:Number(value[1])-Number(value[2])}));
  console.log('正在对新配音进行本地自动转写，保留任何正文差异');
  const asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(_value,message)=>console.log(message)}),recognized=simplified(asr.text),normalizedExpected=normalize(input.text),normalizedActual=normalize(recognized);
  write('inspection.json',{at:new Date().toISOString(),runId:run.id,sha256:digest(asset.path),metadata,fullDecode:true,signal:{samples:bytes.length/2,peak:peak/32768,rms:Math.sqrt(sum/(bytes.length/2))/32768,fullScaleSamples:fullScale},loudness,silences,asr,recognized,normalizedExpected,normalizedActual,textMatches:normalizedExpected===normalizedActual,humanQualityAccepted:false});
  console.log(JSON.stringify({duration:Number(metadata.format.duration),fullScaleSamples:fullScale,recognized,textMatches:normalizedExpected===normalizedActual,silences:loudness.input_i?silences:[],humanQualityAccepted:false}));return;
 }
 if(mode==='excerpts'){
  assert(!fs.existsSync(path.join(root,'listening-segments.json')));const {asset,data}=source(),inspection=read('inspection.json');
  const media=new Media({data,asset:id=>data.assets.find(item=>item.id===id)}),{ffmpeg}=media.binaries();
  const cases=[{label:'一会儿',pattern:/一會|一会/,expected:'正好可以慢慢逛一会儿'},{label:'空当',pattern:/空蕩|空荡/,expected:'不用赶时间的空当'},{label:'这儿',pattern:/先聊到/,expected:'今天就先聊到这儿'}];
  const segments=await Promise.all(cases.map(async item=>{
   const row=inspection.asr.segments.find(row=>item.pattern.test(row.text));assert(row,'找不到复听句子的真实识别时段：'+item.label);
   const start=Math.max(0,row.start-.25),end=Math.min(asset.duration,row.end+.25),file=path.join(root,'需复听-'+item.label+'.wav');
   await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-ss',String(start),'-t',String(end-start),'-map','0:a:0','-c:a','pcm_s16le',file]);
   await runProcess(ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-']);
   return {label:item.label,start,end,expectedPhrase:item.expected,recognizedSegment:row.text,file,sha256:digest(file),fullDecode:true,processing:'仅截取原音频，未变速变调或改音量',actualPronunciationAccepted:false};
  }));
  write('listening-segments.json',{at:new Date().toISOString(),sourceId:asset.id,sourceSha256:digest(asset.path),segments,interpretation:'自动转写差异的复听片段，不凭转写判实际读错'});
  console.log(JSON.stringify({excerpts:segments.map(item=>({file:item.file,start:item.start,end:item.end}))}));return;
 }
 if(mode==='playback')return connected(async(page,call,errors)=>{
  assert(!fs.existsSync(path.join(root,'playback.json')));const {input,asset}=source();
  await page.reload();const audio=page.locator('.audio-result audio[controls]');await audio.waitFor();
  await audio.evaluate(async node=>{if(node.readyState===0)await new Promise(resolve=>node.addEventListener('loadedmetadata',resolve,{once:true}));if(node.currentTime!==0)throw Error('完整播放必须从0开始');node.__times=[];node.__seeks=0;node.addEventListener('timeupdate',()=>node.__times.push(node.currentTime));node.addEventListener('seeking',()=>node.__seeks++);node.volume=1;node.muted=false;await node.play()});
  console.log(JSON.stringify({playing:true,assetId:asset.id,duration:asset.duration}));
  const result=await until(()=>audio.evaluate(node=>node.ended?{ended:node.ended,duration:node.duration,muted:node.muted,rate:node.playbackRate,source:node.currentSrc,times:node.__times,seeks:node.__seeks,error:node.error?.message||null}:null),Math.ceil(asset.duration*1000)+15000);
  write('playback-corrected-observation.json',{at:new Date().toISOString(),...result});
  assert.equal(result.source,'media://asset/'+asset.id);assert(!result.muted&&!result.error);assert.equal(result.rate,1);assert.equal(result.seeks,0);assert(result.times.length>asset.duration*2);
  await page.screenshot({path:path.join(root,'playback-ended.png')});const count=state().runs.length;
  await page.reload();await page.waitForFunction(id=>document.querySelector('.audio-result audio[controls]')?.src==='media://asset/'+id,asset.id);
  assert.equal(state().runs.length,count);assert.equal(count,1);assert.equal(state().currentId,input.draftId);assert.equal(errors.length,0);
  write('playback.json',{at:new Date().toISOString(),...result,fullNativeUnmutedPlayback:true,refreshBinding:true,noNewTasksAfterReload:true,pageErrors:errors,humanQualityAccepted:false});
  console.log(JSON.stringify({fullNativeUnmutedPlayback:true,duration:result.duration,refreshBinding:true}));
 });
 throw Error('未知动作：'+mode);
}
main().catch(error=>{fs.appendFileSync(path.join(root,'errors.jsonl'),JSON.stringify({at:new Date().toISOString(),mode,error:error.stack})+'\n');console.error(error);process.exitCode=1});
