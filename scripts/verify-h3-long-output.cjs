const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {LocalAsr}=require('../server/local-asr.cjs');
const {digest}=require('../server/h3-plan.cjs');
const root=path.resolve(process.argv[2]||'evidence/validation/h3-long-generation');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const hash=file=>digest(fs.readFileSync(file));
const normalize=text=>String(text).replace(/[\p{P}\p{Z}\s]/gu,'');

// 仅核验产品实际取回的完整新长片，未生成完成时直接失败，不创建替代素材。
async function main(){
 const data=read('workspace/studio.json'),launch=read('launch.json'),calls=read('http-calls.json'),planReport=read('plan-verification.json');
 const run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1');
 if(run?.status!=='succeeded'||!run.output?.id)throw Error('原长片尚未完成，不能核验成片');
 const draft=data.drafts.find(item=>item.id===run.draftId),asset=data.assets.find(item=>item.id===run.output.id),plan=run.remote.plan;
 assert.equal(draft.video.assetId,asset.id);assert.equal(asset.origin,'comfy-h3-sequence');assert.equal(hash(asset.path),asset.h3.outputSha256);
 assert.equal(digest(plan),run.remote.planSha256);assert.equal(planReport.planSha256,run.remote.planSha256);
 const submits=calls.filter(call=>call.method==='POST'&&call.url==='/prompt');
 const reused=run.remote.segments.filter(segment=>segment.reusedFrom),newCount=plan.segments.length-reused.length;
 assert.equal(submits.length,newCount);assert.equal(new Set(submits.map(call=>call.promptId)).size,newCount);
 for(const segment of run.remote.segments){
  assert.equal(segment.status,'succeeded');
  if(segment.reusedFrom){
   const source=JSON.parse(fs.readFileSync(launch.protectedFiles[0].file,'utf8')).runs.find(item=>item.id===segment.reusedFrom.runId);
   assert.equal(source.status,'succeeded');assert(source.remote.segments.some(item=>item.remoteId===segment.remoteId&&item.output.sha256===segment.output.sha256));
   assert.equal(segment.reusedFrom.sha256,segment.output.sha256);
  }else assert(submits.some(call=>call.promptId===segment.remoteId&&call.clientId===segment.remote.clientId&&call.graphSha256===segment.remote.graphSha256));
  assert.equal(hash(segment.output.path),segment.output.sha256);
 }
 const speechRun=data.runs.find(item=>item.type==='speech'&&item.status==='succeeded'&&item.output?.id===run.parameters.input.audio.assetId);
 assert.equal(data.assets.find(item=>item.id===run.parameters.input.audio.assetId)?.origin,'windows-speech');
 if(launch.protectedFiles){for(const item of launch.protectedFiles)assert.equal(hash(item.file),item.sha256);}
 else{assert.equal(speechRun?.output.origin,'windows-speech');assert.equal(hash(launch.originalFile),launch.originalSha256);assert.equal(hash(launch.sourceFile),launch.sourceSha256);}
 const media=new Media({data}),probe=await media.probe(asset.path),directory=path.join(root,'product-output');fs.mkdirSync(directory,{recursive:true});
 assert.equal(Number(probe.streams.find(stream=>stream.codec_type==='video').nb_frames),plan.totalFrames);
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const contactSheet=path.join(directory,'contact-sheet.jpg');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf','fps=0.5,scale=240:-1,tile=9x1','-frames:v','1','-update','1',contactSheet]);
 const seams=[];
 for(const part of plan.segments.slice(0,-1)){
  const target=path.join(directory,'seam-'+part.index+'.jpg'),start=part.endFrame-4,end=part.endFrame+4;
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`select='between(n,${start},${end})',scale=240:-1,tile=9x1`,'-frames:v','1','-update','1',target]);seams.push({at:part.endFrame/24,image:target,frames:[start,end]});
 }
 const audio=path.join(directory,'decoded-final-audio.pcm');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-map','0:a:0','-ac','1','-ar','32000','-c:a','pcm_s16le','-f','s16le',audio]);
 const original=fs.readFileSync(plan.fullAudio),decoded=fs.readFileSync(audio),samples=Math.min(original.length,decoded.length)/2;let dot=0,left=0,right=0;
 for(let i=0;i<samples;i++){const a=original.readInt16LE(i*2),b=decoded.readInt16LE(i*2);dot+=a*b;left+=a*a;right+=b*b;}
 const report={at:new Date().toISOString(),runId:run.id,planId:plan.id,video:asset.path,bytes:fs.statSync(asset.path).size,sha256:hash(asset.path),probe,
  planVerification:planReport,modelIds:run.remote.segments.map(segment=>segment.remoteId),submitCount:submits.length,newModelVideo:newCount>0,newGeneratedSegmentCount:newCount,reusedSegments:reused.map(segment=>segment.reusedFrom),newSystemSpeech:!!speechRun,voiceSource:speechRun?'windows-system-new-synthesis':'reused-windows-system-synthesis',newVoiceClone:false,
  sourceImageOrigin:'first-own-h3-generation',audioOrigin:'original-full-driver-remuxed',audioComparison:{originalSamples:original.length/2,decodedSamples:decoded.length/2,comparedSamples:samples,correlationAtZeroLag:dot/Math.sqrt(left*right)},
  fullDecodeVerified:true,boundToDraft:true,contactSheet,seams,originalUnchanged:true,previousValidationWorkspaceUnchanged:true,
  qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,audioAudited:false,continuousLipSyncReviewed:false,seamQualityAccepted:false};
 try{report.asr=await new LocalAsr({data,asset:id=>data.assets.find(item=>item.id===id)},media).transcribe(asset.id,{progress:(value,message)=>console.log(message)});report.asrTextMatchesInput=normalize(report.asr.text)===normalize(draft.finalText);}
 catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(directory,'media-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({video:asset.path,duration:probe.format.duration,sha256:report.sha256,modelIds:report.modelIds,fullDecodeVerified:true,asrTextMatchesInput:report.asrTextMatchesInput,contactSheet,seams},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
