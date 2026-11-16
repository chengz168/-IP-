const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const {sourceIndex}=require('../integrations/musetalk-local/production-input.cjs');
const {simplified,normalize}=require('./verify-indextts-output.cjs');
const directory=path.resolve('evidence/validation/musetalk-integration-20261115'),mode=process.argv[2];
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(data,null,2));
async function main(){
 const data=read('workspace/studio.json'),prepared=read('prepared.json'),store={data,asset:id=>{const a=data.assets.find(a=>a.id===id);if(!a)throw Error('素材不存在');return a;}},media=new Media(store),{ffmpeg,ffprobe}=media.binaries();
 const draft=data.drafts.find(d=>d.id===prepared.draftId),speech=data.runs.find(r=>r.type==='speech'&&r.draftId===draft.id&&r.status==='succeeded');assert(speech?.output?.id);
 const voice=store.asset(speech.output.id);assert.equal(voice.origin,'local-indextts');assert.equal(digest(voice.path),voice.speech.outputSha256);assert.notEqual(digest(voice.path),prepared.reference.sha256);
 const checkProtection=()=>prepared.protectedFiles.map(row=>({...row,unchanged:digest(row.file)===row.sha256}));
 if(mode==='speech'){
  const destination=path.join(directory,'speech-signal.pcm');
  await runProcess(ffmpeg,['-v','error','-n','-i',voice.path,'-map','0:a:0','-c:a','pcm_s16le','-f','s16le',destination]);
  const bytes=fs.readFileSync(destination);let peak=0,clipped=0,sum=0;
  for(let i=0;i<bytes.length;i+=2){const sample=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;if(Math.abs(sample)>=32767)clipped++;}assert(peak>0);assert.equal(clipped,0);
  const asr=await new LocalAsr(store,media).transcribe(voice.id,{progress:(_value,message)=>console.log(message)}),recognized=simplified(asr.text),expected=speech.parameters.input.text;
  const protection=checkProtection();assert(protection.every(row=>row.unchanged));
  write('speech-inspection.json',{at:new Date().toISOString(),runId:speech.id,asset:voice,newSpeechGenerated:true,referenceOnlyReused:true,expectedText:expected,asr,recognizedSimplified:recognized,
   literalTextMatches:normalize(recognized)===normalize(expected),signal:{samples:bytes.length/2,peakNormalized:peak/32768,rmsNormalized:Math.sqrt(sum/(bytes.length/2))/32768,fullScaleSamples:clipped},protectedFiles:protection,
   contentReview:{accepted:false,notes:['正文中“不非得”搭配不自然，仍需人工口播编辑复核；本批先验证新文字到新配音新口型技术链。']},listeningAccepted:false,qualityAccepted:false});
  console.log(JSON.stringify({duration:voice.duration,literalTextMatches:normalize(recognized)===normalize(expected),recognized,fullScaleSamples:clipped,qualityAccepted:false}));return;
 }
 if(mode==='render'){
  const run=data.runs.find(r=>r.draftId===draft.id&&r.type==='render');assert.equal(run?.status,'succeeded',run?.error);assert.equal(draft.edit.resultId,run.output.id);
  const asset=store.asset(run.output.id),source=store.asset(draft.video.assetId);assert.equal(source.origin,'local-musetalk');assert.notEqual(digest(source.path),digest(asset.path));
  const probe=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',asset.path]));assert(probe.streams.some(s=>s.codec_type==='audio'));assert(probe.streams.some(s=>s.codec_type==='video'));assert(Math.abs(Number(probe.format.duration)-source.duration)<.15);
  await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-map','0:v:0','-map','0:a:0','-f','null','-']);
  const file=path.join(directory,'示例二-新文案新配音-字幕成片.mp4');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);
  const times=[1,4,12,23];for(let i=0;i<times.length;i++)await runProcess(ffmpeg,['-v','error','-n','-ss',String(times[i]),'-i',file,'-frames:v','1','-vf','scale=432:768:flags=lanczos',path.join(directory,'render-'+String(i).padStart(2,'0')+'.png')]);
  const montage=path.join(directory,'render-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(directory,'render-%02d.png'),'-vf','tile=4x1','-frames:v','1','-q:v','2',montage]);
  const protectedFiles=checkProtection();assert(protectedFiles.every(row=>row.unchanged));
  write('render-media-inspection.json',{at:new Date().toISOString(),runId:run.id,sourceAssetId:source.id,assetId:asset.id,output:file,sha256:digest(file),probe,fullDecodeVerified:true,captions:draft.edit.captions,subtitleTemplate:draft.edit.subtitleTemplate,montage,protectedFiles,qualityAccepted:false,referenceParityAccepted:false});
  console.log(JSON.stringify({output:file,duration:probe.format.duration,captionCount:draft.edit.captions.length,fullDecodeVerified:true}));return;
 }
 if(mode!=='video')throw Error('请选择speech、video或render');
 const run=data.runs.find(r=>r.type==='avatar'&&r.draftId===draft.id&&r.status==='succeeded');assert(run?.output?.id);assert.equal(draft.video.assetId,run.output.id);
 const asset=store.asset(run.output.id),workerDirectory=run.local.directory,result=JSON.parse(fs.readFileSync(path.join(workerDirectory,'result.json'),'utf8')),input=JSON.parse(fs.readFileSync(path.join(workerDirectory,'input-snapshot.json'),'utf8'));
 assert.equal(input.audio.sha256,digest(voice.path));assert.equal(asset.lipSync.outputSha256,digest(asset.path));assert.equal(result.status,'technical-complete');
 const measurements=fs.readFileSync(path.join(workerDirectory,'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(measurements.length,input.frameCount);assert(measurements.every((row,index)=>row.frame===index&&row.sourceFrame===sourceIndex(index,input.sourceFrameCount)&&row.outsideFaceBoxIdenticalBeforeEncoding));assert(measurements.every(row=>row.changedPixelsInsideFaceBox>0));
 const probe=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',asset.path])),picture=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
 assert.equal(Number(picture.nb_read_frames),input.frameCount);assert.equal(picture.width,input.width);assert.equal(picture.height,input.height);assert.equal(Number(audio.nb_read_frames)>0,true);
 await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-map','0:v:0','-map','0:a:0','-f','null','-']);
 const pcm=path.join(directory,'video-audio.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',asset.path,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',pcm]);
 const actual=fs.readFileSync(pcm),voicePcm=path.join(directory,'voice-16k.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',voice.path,'-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',voicePcm]);const original=fs.readFileSync(voicePcm);
 let aa=0,bb=0,ab=0;const samples=Math.min(actual.length,original.length)/2;for(let i=0;i<samples;i++){const a=actual.readInt16LE(i*2),b=original.readInt16LE(i*2);aa+=a*a;bb+=b*b;ab+=a*b;}const correlation=ab/Math.sqrt(aa*bb);assert(correlation>.95);
 const file=path.join(directory,'示例二-新文案新配音-MuseTalk.mp4');fs.copyFileSync(asset.path,file,fs.constants.COPYFILE_EXCL);
 const times=[0,1,4,5,12,19.7,20,23];
 for(let i=0;i<times.length;i++)await runProcess(ffmpeg,['-v','error','-n','-ss',String(times[i]),'-i',file,'-frames:v','1','-vf','scale=324:576:flags=lanczos',path.join(directory,'generated-'+String(i).padStart(2,'0')+'.png')]);
 const montage=path.join(directory,'generated-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-framerate','1','-i',path.join(directory,'generated-%02d.png'),'-vf','tile=4x2','-frames:v','1','-q:v','2',montage]);
 const protectedFiles=checkProtection();assert(protectedFiles.every(row=>row.unchanged));
 write('media-inspection.json',{at:new Date().toISOString(),runId:run.id,output:file,sha256:digest(file),probe,frameCount:input.frameCount,sourceFrameCount:input.sourceFrameCount,
  sourceFramePolicy:input.sourceFramePolicy,reversePlaybackGeneratedFrames:Math.max(0,input.frameCount-input.sourceFrameCount),allOutsideFaceBoxesIdenticalBeforeEncoding:true,
  everyFrameFaceModified:true,inferenceCalls:result.inferenceCalls,drivingAudio:{id:voice.id,sha256:digest(voice.path),newSpeechGenerated:true,correlation,samples},featurePaddingSamples:input.featurePaddingSamples,
  fullDecodeVerified:true,largeFrameCacheRemoved:result.largeFrameCacheRemoved,protectedFiles,montage,sampleTimes:times,newModelGeneration:true,sourceBodyAndBackgroundReused:true,listeningAccepted:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false});
 console.log(JSON.stringify({output:file,frames:input.frameCount,duration:probe.format.duration,reverseFrames:Math.max(0,input.frameCount-input.sourceFrameCount),correlation,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
