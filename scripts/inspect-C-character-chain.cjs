// 核对C驱动、真实逐帧口型及剪辑输出；统计和抽帧不代替连续口型与听感验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {sourceIndex}=require('../integrations/musetalk-local/production-input.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const root=path.resolve('evidence/validation/voice-C-character-20261116');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),load=n=>read(path.join(root,n));
async function main(){
 const reportFile=path.join(root,'media.json');assert(!fs.existsSync(reportFile),'已有核验记录，不覆盖');
 const generated=load('generated.json'),baseline=load('baseline.json'),prepared=load('prepared.json');
 const data=read('evidence/validation/musetalk-integration-20261115/workspace/studio.json'),{ffmpeg,ffprobe}=new Media({data}).binaries();
 const run=generated.runs.find(r=>r.type==='avatar'),worker=read(path.join(run.local.directory,'result.json')),input=read(path.join(run.local.directory,'input-snapshot.json'));
 assert.equal(worker.status,'technical-complete');assert.equal(input.audio.sha256,prepared.audioSha256);assert.equal(digest(input.audio.path),prepared.audioSha256);
 const measurements=fs.readFileSync(path.join(run.local.directory,'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(measurements.length,input.frameCount);assert(measurements.every((row,i)=>row.frame===i&&row.sourceFrame===sourceIndex(i,input.sourceFrameCount)&&row.outsideFaceBoxIdenticalBeforeEncoding&&row.changedPixelsInsideFaceBox>0));
 const probes={},pcms={},correlations={};
 for(const [kind,asset]of Object.entries(generated.outputs)){
  assert.equal(digest(asset.file),asset.sha256);probes[kind]=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',asset.file]));
  await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.file,'-f','null','-']);
  if(kind!=='cover'){
   const pcm=path.join(root,kind+'.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',asset.file,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',pcm]);pcms[kind]=fs.readFileSync(pcm);
  }
 }
 for(const kind of ['avatar','render']){
  const picture=probes[kind].streams.find(s=>s.codec_type==='video');assert.equal(Number(picture.nb_read_frames),input.frameCount);assert.equal(picture.width,1080);assert.equal(picture.height,1920);
  let aa=0,bb=0,ab=0;const samples=Math.min(pcms.speech.length,pcms[kind].length)/2;
  for(let i=0;i<samples;i++){const a=pcms.speech.readInt16LE(i*2),b=pcms[kind].readInt16LE(i*2);aa+=a*a;bb+=b*b;ab+=a*b;}
  correlations[kind]=ab/Math.sqrt(aa*bb);assert(correlations[kind]>.95,'驱动声音和视频音轨差异异常');
 }
 const asr=generated.runs.find(r=>r.type==='transcribe').output.rawRecognition;assert(asr?.segments.some(s=>s.words?.length));
 const recognized=simplified(asr.text),literalTextMatches=normalize(recognized)===normalize(prepared.text);
 const times=[.3,1.5,3,4.5,6.2],sampleFiles=[];
 for(let i=0;i<times.length;i++){
  const frame=Math.floor(times[i]*input.fps),sourceTime=sourceIndex(frame,input.sourceFrameCount)/input.fps;
  for(const [kind,file,time]of [['source',baseline.shape.path,sourceTime],['avatar',generated.outputs.avatar.file,times[i]]]){
   const target=path.join(root,kind+'-'+i+'.jpg');await runProcess(ffmpeg,['-v','error','-n','-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=216:384','-q:v','2',target]);sampleFiles.push(target);
  }
 }
 for(const kind of ['source','avatar'])await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(root,kind+'-%d.jpg'),'-vf','tile=5x1','-frames:v','1','-q:v','2',path.join(root,kind+'-grid.jpg')]);
 const montage=path.join(root,'source-vs-C-lipsync.jpg');await runProcess(ffmpeg,['-v','error','-n','-i',path.join(root,'source-grid.jpg'),'-i',path.join(root,'avatar-grid.jpg'),'-filter_complex','[0:v][1:v]vstack=inputs=2','-frames:v','1','-q:v','2',montage]);
 const caption=generated.draft.edit.captions.find(row=>row.start>0)||generated.draft.edit.captions[0];await runProcess(ffmpeg,['-v','error','-n','-ss',String((caption.start+caption.end)/2),'-i',generated.outputs.render.file,'-frames:v','1','-vf','scale=540:960',path.join(root,'caption-review.png')]);
 assert(baseline.protectedFiles.every(p=>digest(p.file)===p.sha256));assert.equal(digest(baseline.shape.path),baseline.shapeSha256);
 const report={at:new Date().toISOString(),probes,fullDecodeVerified:true,frameCount:input.frameCount,inferenceCalls:worker.inferenceCalls,workerDirectory:run.local.directory,driverAudioSha256:input.audio.sha256,
  correlations,allFramesFaceModified:true,outsideFaceBoxesIdenticalBeforeEncoding:true,sourceBodyAndBackgroundReused:true,newSpeechGenerated:false,newLipSyncGenerated:true,
  expectedText:prepared.text,recognizedSimplified:recognized,literalTextMatches,rawRecognitionPreserved:true,captions:generated.draft.edit.captions,montage,sampleTimes:times,protectedFilesUnchanged:true,
  naturalnessAccepted:false,characterMatchAccepted:false,continuousLipSyncAccepted:false,completeReplica:false};
 fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({frameCount:input.frameCount,inferenceCalls:worker.inferenceCalls,correlations,literalTextMatches,recognized,montage}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
