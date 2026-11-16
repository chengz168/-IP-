const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{H3Sequence}=require('../server/h3-sequence.cjs'),{LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../server/h3-plan.cjs'),{graphSignature}=require('../server/comfy-h3.cjs');
const root=path.resolve('evidence/validation/h3-multi-generation'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),hash=file=>digest(fs.readFileSync(file));
const normalize=text=>String(text).replace(/[\p{P}\p{Z}\s]/gu,'');

async function main(){
 const data=read('workspace/studio.json'),inputs=read('inputs.json'),launch=read(fs.existsSync(path.join(root,'launch.json'))?'launch.json':'relaunch.json'),calls=read('http-calls.json');
 const run=data.runs.find(item=>item.draftId===inputs.draftId&&item.remote?.plan.mode==='multi');
 if(run?.status!=='succeeded'||!run.output?.id)throw Error('实际多镜头尚未完成，不能生成成片验收收据');
 const draft=data.drafts.find(item=>item.id===run.draftId),asset=data.assets.find(item=>item.id===run.output.id),plan=run.remote.plan,directory=path.join(root,'product-output');fs.mkdirSync(directory,{recursive:true});
 const store={data,asset:id=>data.assets.find(item=>item.id===id)},media=new Media(store);new H3Sequence(store,media,{}).validate(run.remote,{source:true});
 assert.equal(draft.video.assetId,asset.id);assert.equal(asset.origin,'comfy-h3-sequence');assert.equal(hash(asset.path),asset.h3.outputSha256);
 const submitted=calls.filter(call=>call.method==='POST'&&call.url==='/prompt');assert.equal(submitted.length,plan.segments.length);assert.equal(new Set(submitted.map(call=>call.promptId)).size,plan.segments.length);
 const provenance=[];
 for(const part of run.remote.segments){
  const section=plan.segments[part.index],shot=plan.shots[section.shotIndex];assert.equal(part.status,'succeeded');assert.equal(part.reusedFrom,undefined);
  assert(submitted.some(call=>call.promptId===part.remoteId&&call.clientId===part.remote.clientId&&call.graphSha256===part.remote.graphSha256));assert.equal(graphSignature(part.remote.graph),part.remote.graphSha256);
  assert.equal(part.remote.image.sha256,shot.imageSha256);assert.equal(part.remote.audio.sha256,section.audioSha256);assert.equal(hash(part.output.path),part.output.sha256);
  for(const [remote,expected]of [[part.remote.image,shot.imageSha256],[part.remote.audio,section.audioSha256]]){
   const response=await fetch(plan.baseUrl+'/view?'+new URLSearchParams({filename:remote.name,subfolder:remote.subfolder,type:'input'}));assert.equal(response.status,200);assert.equal(digest(Buffer.from(await response.arrayBuffer())),expected);
  }
  const record=asset.h3.segments[part.index];assert.equal(record.shotIndex,section.shotIndex);assert.equal(record.avatarId,shot.avatarId);
  provenance.push({segment:part.index,shotIndex:section.shotIndex,avatarId:shot.avatarId,modelId:part.remoteId,newModelInference:true,imageMatchesSelectedShot:true,uploadedAudioMatchesPlan:true});
 }
 for(const item of launch.protectedFiles)assert.equal(hash(item.file),item.sha256);
 assert.equal(hash(inputs.audio.path),inputs.audio.sha256);assert.equal(hash(plan.sourceAudio),inputs.audio.sha256);
 const probe=await media.probe(asset.path),video=probe.streams.find(stream=>stream.codec_type==='video');assert.equal(Number(video.nb_frames),plan.totalFrames);assert.equal(video.width,608);assert.equal(video.height,1056);assert.equal(video.avg_frame_rate,'24/1');
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const contactSheet=path.join(directory,'contact-sheet.jpg'),cut=plan.shots[0].endFrame;
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf','fps=1,scale=240:-1,tile=5x2','-frames:v','1','-update','1',contactSheet]);
 const cutSheet=path.join(directory,'cut-frames.jpg');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`select='between(n,${cut-4},${cut+4})',scale=240:-1,tile=9x1`,'-frames:v','1','-update','1',cutSheet]);
 // 连续帧的下部拼图用于排查伪字幕，不能代替连续音画与口型听审。
 const bottomSheets=[];
 for(let start=0;start<plan.totalFrames;start+=56){
  const end=Math.min(plan.totalFrames-1,start+55),file=path.join(directory,'bottom-'+start+'-'+end+'.jpg');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`select='between(n,${start},${end})',crop=iw:ih*0.3:0:ih*0.7,scale=240:-1,tile=8x7`,'-frames:v','1','-update','1',file]);bottomSheets.push({frames:[start,end],file});
 }
 const audio=path.join(directory,'final-audio.pcm');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-map','0:a:0','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',audio]);
 const original=fs.readFileSync(plan.fullAudio),decoded=fs.readFileSync(audio),count=Math.min(original.length,decoded.length)/2;let dot=0,left=0,right=0;
 for(let i=0;i<count;i++){const a=original.readInt16LE(i*2),b=decoded.readInt16LE(i*2);dot+=a*b;left+=a*a;right+=b*b;}
 const report={at:new Date().toISOString(),runId:run.id,planId:plan.id,video:asset.path,sha256:hash(asset.path),probe,shots:plan.shots,provenance,submitCount:submitted.length,newGeneratedSegmentCount:provenance.length,reusedGeneratedSegments:0,newVoiceClone:false,voiceSource:inputs.audio.origin,fullDecodeVerified:true,boundToDraft:true,protectedWorkspacesUnchanged:true,contactSheet,cutSheet,bottomSheets,audioComparison:{originalSamples:original.length/2,decodedSamples:decoded.length/2,correlationAtZeroLag:dot/Math.sqrt(left*right)},qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,continuousLipSyncReviewed:false,audioAudited:false};
 try{report.asr=await new LocalAsr(store,media).transcribe(asset.id,{progress:(value,message)=>console.log(message)});report.asrTextMatchesInput=normalize(report.asr.text)===normalize(inputs.text);}catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(directory,'media-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({video:asset.path,sha256:report.sha256,duration:probe.format.duration,frames:video.nb_frames,submitCount:report.submitCount,fullDecodeVerified:true,asrTextMatchesInput:report.asrTextMatchesInput,contactSheet,cutSheet},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
