// 验证实际剪辑烧录、原音轨、产品完整播放及刷新绑定。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/DELL/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve(__dirname,'../evidence/validation/caption-phrases-C-20261116');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2),{flag:'wx'});
const ffmpeg='F:/Software/轻语IP智能体/aigc-human/resources/ffmpeg/bin/ffmpeg.exe',ffprobe=ffmpeg.replace('ffmpeg.exe','ffprobe.exe');
const command=(binary,args)=>{const result=spawnSync(binary,args,{windowsHide:true,maxBuffer:16*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,String(result.stderr));return result.stdout;};
async function main(){
 assert(!fs.existsSync(path.join(root,'media-result.json')),'保留已有成功验收');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9372');
 try{
  const page=browser.contexts()[0].pages()[0],prepared=read('prepared.json'),recognition=read('recognition-result.json');
  const call=()=>page.evaluate(()=>window.studio.invoke('state'));
  const state=await call(),draft=state.drafts.find(d=>d.id===prepared.draftId),run=state.runs.find(r=>r.type==='render');
  assert.equal(run?.status,'succeeded',run?.error||'等待原剪辑任务终态，不重交');
  // 界面state不暴露磁盘path，媒体校验从已持久化工作区读取真实路径。
  const stored=read('workspace/studio.json'),asset=stored.assets.find(a=>a.id===draft.edit.resultId);
  assert.equal(run.output.id,asset.id);assert.deepEqual(asset.renderedCaptions,recognition.captions);
  assert.equal(digest(prepared.source.path),prepared.source.sha256);
  const metadata=JSON.parse(command(ffprobe,['-v','error','-count_frames','-show_entries','stream=codec_type,width,height,avg_frame_rate,duration,nb_read_frames:format=duration','-of','json',asset.path]));
  const video=metadata.streams.find(s=>s.codec_type==='video'),audio=metadata.streams.find(s=>s.codec_type==='audio');
  assert.equal(video.width,1080);assert.equal(video.height,1920);assert.equal(video.avg_frame_rate,'30/1');assert.equal(Number(video.nb_read_frames),200);
  assert(Math.abs(Number(video.duration)-prepared.source.duration)<.001);assert(Math.abs(Number(audio.duration)-prepared.source.duration)<.05);
  command(ffmpeg,['-v','error','-xerror','-i',asset.path,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  const pcm=file=>command(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-ar','16000','-ac','1','-f','s16le','-']);
  const a=pcm(prepared.source.path),b=pcm(asset.path),samples=Math.min(a.length,b.length)/2;
  let aa=0,bb=0,ab=0;for(let i=0;i<samples;i++){const x=a.readInt16LE(i*2),y=b.readInt16LE(i*2);aa+=x*x;bb+=y*y;ab+=x*y;}
  const correlation=ab/Math.sqrt(aa*bb);assert(correlation>.99);
  const previous=JSON.parse(fs.readFileSync(path.resolve(root,'../caption-correction-C-20261116/delivery-report.json'),'utf8'));
  assert.equal(digest(previous.video.path),previous.video.sha256);
  const frames=[];
  for(const time of [.65,4.7]){
   const oldFile=path.join(root,'before-'+time+'.png'),newFile=path.join(root,'after-'+time+'.png');
   for(const [input,file]of [[previous.video.path,oldFile],[asset.path,newFile]])command(ffmpeg,['-v','error','-n','-ss',String(time),'-i',input,'-frames:v','1','-vf','scale=540:-1',file]);
   frames.push({time,before:oldFile,after:newFile});
  }
  const errors=await page.evaluate(()=>window.__phrasePageErrors||[]);
  page.on('pageerror',error=>errors.push(error.message));
  const player=page.getByLabel('剪辑成片视频',{exact:true});
  await player.waitFor();await page.waitForFunction(()=>document.querySelector('video[aria-label="剪辑成片视频"]')?.readyState>=2);
  assert((await player.evaluate(n=>n.currentSrc)).includes(asset.id));
  await player.evaluate(n=>{n.pause();n.currentTime=0});
  await page.waitForFunction(()=>!document.querySelector('video[aria-label="剪辑成片视频"]').seeking);
  const playback=await player.evaluate(node=>new Promise(async(resolve,reject)=>{
   const samples=[],sample=()=>samples.push({time:node.currentTime,rate:node.playbackRate,muted:node.muted,volume:node.volume});let seeks=0;
   const onSeek=()=>seeks++;node.playbackRate=1;node.muted=false;node.volume=1;node.addEventListener('seeking',onSeek);
   const timer=setInterval(sample,100),timeout=setTimeout(()=>{clearInterval(timer);reject(Error('完整播放等待超时'))},20000);
   node.addEventListener('ended',()=>{sample();clearTimeout(timeout);clearInterval(timer);node.removeEventListener('seeking',onSeek);resolve({ended:node.ended,duration:node.duration,samples,seeks,error:node.error?.message||null})},{once:true});
   sample();try{await node.play()}catch(error){clearTimeout(timeout);clearInterval(timer);reject(error)}
  }));
  assert(playback.ended&&playback.seeks===0&&!playback.error);
  assert(playback.samples[0].time<.05&&Math.abs(playback.samples.at(-1).time-prepared.source.duration)<.05);
  assert(playback.samples.every((s,i)=>s.rate===1&&!s.muted&&s.volume>0&&(i===0||s.time-playback.samples[i-1].time<1)));
  await page.screenshot({path:path.join(root,'product-playback-ended.png')});
  await page.reload();await page.locator('.steps').waitFor();
  const after=await call();assert.equal(after.runs.length,state.runs.length);assert.equal(after.drafts.find(d=>d.id===draft.id).edit.resultId,asset.id);
  assert.deepEqual(after.drafts.find(d=>d.id===draft.id).edit.captions,recognition.captions);
  assert.deepEqual(errors,[]);
  const baseline=read('baseline.json');for(const item of baseline.protectedFiles)assert.equal(digest(item.file),item.sha256,item.file);
  write('media-result.json',{at:new Date().toISOString(),runId:run.id,draftId:draft.id,output:{id:asset.id,path:asset.path,sha256:digest(asset.path)},source:prepared.source,metadata,fullDecode:true,renderedCaptions:asset.renderedCaptions,audio:{correlation,samples},frames,productPlayback:playback,refreshBinding:true,noNewSubmissionAfterReload:true,protectedFilesUnchanged:true,protectedFileCount:baseline.protectedFiles.length,pageErrors:errors,newSpeechGenerated:false,newLipSyncGenerated:false,naturalnessAccepted:false,referenceParityAccepted:false});
  console.log(JSON.stringify({runId:run.id,frames:Number(video.nb_read_frames),duration:Number(video.duration),audioCorrelation:correlation,fullPlayback:true,refreshBinding:true,output:asset.path}));
 }finally{await browser.close()}
}
main().catch(error=>{fs.appendFileSync(path.join(root,'media-errors.jsonl'),JSON.stringify({at:new Date().toISOString(),error:error.stack})+'\n');console.error(error);process.exitCode=1});
