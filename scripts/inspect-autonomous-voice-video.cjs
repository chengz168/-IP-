const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs'),{digest}=require('../integrations/musetalk-local/input.cjs');
const {sourceIndex}=require('../integrations/musetalk-local/production-input.cjs');
const root=path.resolve('evidence/validation/voice-design-20261115'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
async function main(){
 const candidate=read('product-candidate.json'),speech=read('product-generated.json'),submission=read('video-submission.json');
 const data=JSON.parse(fs.readFileSync('evidence/validation/musetalk-integration-20261115/workspace/studio.json','utf8'));
 const store={data,asset:id=>{const a=data.assets.find(a=>a.id===id);assert(a);return a;}},media=new Media(store),{ffmpeg,ffprobe}=media.binaries();
 const run=data.runs.find(r=>r.id===submission.runId),draft=data.drafts.find(d=>d.id===candidate.draftId);assert.equal(run?.status,'succeeded',run?.error);
 const asset=store.asset(run.output.id),voice=store.asset(speech.run.output.id);assert.equal(draft.video.assetId,asset.id);assert.equal(digest(voice.path),speech.sha256);
 const worker=run.local.directory,result=JSON.parse(fs.readFileSync(path.join(worker,'result.json'),'utf8')),input=JSON.parse(fs.readFileSync(path.join(worker,'input-snapshot.json'),'utf8'));
 assert.equal(result.status,'technical-complete');assert.equal(result.generatedFrames,input.frameCount);assert(result.modelExecuted);
 assert.equal(input.audio.sha256,speech.sha256);assert.equal(input.width,1080);assert.equal(input.height,1920);assert.equal(input.fps,30);
 const measurements=fs.readFileSync(path.join(worker,'face-measurements.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(measurements.length,input.frameCount);assert(measurements.every((row,index)=>row.frame===index&&row.sourceFrame===sourceIndex(index,input.sourceFrameCount)&&row.outsideFaceBoxIdenticalBeforeEncoding&&row.changedPixelsInsideFaceBox>0));
 const probe=JSON.parse(await runProcess(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',asset.path])),picture=probe.streams.find(s=>s.codec_type==='video');
 assert.equal(Number(picture.nb_read_frames),input.frameCount);assert.equal(picture.width,1080);assert.equal(picture.height,1920);
 await runProcess(ffmpeg,['-v','error','-xerror','-i',asset.path,'-map','0:v:0','-map','0:a:0','-f','null','-']);
 const videoPcm=path.join(root,'video-sound.s16le'),voicePcm=path.join(root,'driving-sound.s16le');
 for(const [source,target] of [[asset.path,videoPcm],[voice.path,voicePcm]])await runProcess(ffmpeg,['-v','error','-n','-i',source,'-map','0:a:0','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le',target]);
 const actual=fs.readFileSync(videoPcm),expected=fs.readFileSync(voicePcm),samples=Math.min(actual.length,expected.length)/2;let aa=0,bb=0,ab=0;
 for(let i=0;i<samples;i++){const a=actual.readInt16LE(i*2),b=expected.readInt16LE(i*2);aa+=a*a;bb+=b*b;ab+=a*b;}
 const correlation=ab/Math.sqrt(aa*bb);assert(correlation>.99);
 const video=path.join(root,'示例二-自主夜聊女声-新口型短片.mp4');fs.copyFileSync(asset.path,video,fs.constants.COPYFILE_EXCL);
 const montage=path.join(root,'autonomous-video-grid.jpg');await runProcess(ffmpeg,['-v','error','-n','-i',video,'-vf','fps=0.5,scale=270:480,tile=4x1','-frames:v','1','-update','1',montage]);
 const prepared=read('prepared.json'),protection=prepared.protectedFiles.map(row=>({...row,unchanged:digest(row.file)===row.sha256}));assert(protection.every(r=>r.unchanged));
 const report={at:new Date().toISOString(),runId:run.id,draftId:draft.id,assetId:asset.id,video,sha256:digest(video),probe,workerDirectory:worker,
  frames:input.frameCount,inferenceCalls:result.inferenceCalls,sourceFrameCount:input.sourceFrameCount,sourceFramePolicy:input.sourceFramePolicy,
  everyFaceFrameModified:true,allOutsideFaceBoxesIdenticalBeforeEncoding:true,bodyAndBackgroundReused:true,
  newSpeechGenerated:true,drivingAudio:{id:voice.id,sha256:speech.sha256,correlation,samples},originalHumanReferenceAudioInput:false,
  fullDecodeVerified:true,montage,protectedFiles:protection,listeningAccepted:false,characterMatchAccepted:false,qualityAccepted:false,referenceParityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(root,'video-inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({video,frames:input.frameCount,duration:probe.format.duration,correlation,qualityAccepted:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
