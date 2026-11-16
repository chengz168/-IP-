const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../server/h3-plan.cjs');
const {graphSignature}=require('../server/comfy-h3.cjs');
const root=path.resolve('evidence/validation/h3-continuity'),hash=file=>digest(fs.readFileSync(file));

// 与前一段实际保留末帧的解码像素对照，并验证服务器真正收到的图像。
async function main(){
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
 const data=read('workspace/studio.json'),inputs=read('inputs.json'),run=data.runs.find(item=>item.id===inputs.runId),remote=run.remote,part=remote.segments[1],reference=part.reference,prior=remote.segments[0];
 assert.equal(remote.plan.referencePolicy,'previous-planned-last-frame-v1');assert(reference&&part.remoteId);
 assert.equal(reference.frame,remote.plan.segments[0].frameCount-1);assert.equal(reference.frame,203);
 assert.equal(reference.sourceSegment,0);assert.equal(reference.sourceSha256,hash(prior.output.path));assert.equal(hash(reference.path),reference.sha256);
 assert.equal(prior.reusedFrom.runId,inputs.sourceRunId);assert.equal(prior.output.sha256,inputs.sourceFirstSha256);
 assert.equal(part.remote.image.sha256,reference.sha256);assert.equal(graphSignature(part.remote.graph),part.remote.graphSha256);
 assert.equal(part.remote.graph['17'].inputs.image,part.remote.image.subfolder+'/'+part.remote.image.name);
 const directory=path.join(root,'reference-verification');fs.mkdirSync(directory,{recursive:true});const media=new Media({data});
 const original=path.join(directory,'prior-join-frame.rgb'),actual=path.join(directory,'reference.rgb');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',prior.output.path,'-vf',`trim=start_frame=${reference.frame}:end_frame=${reference.frame+1}`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',original]);
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',reference.path,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',actual]);
 assert(fs.readFileSync(original).equals(fs.readFileSync(actual)));
 const params=new URLSearchParams({filename:part.remote.image.name,subfolder:part.remote.image.subfolder,type:'input'}),response=await fetch(remote.baseUrl+'/view?'+params);
 assert.equal(response.status,200);assert.equal(digest(Buffer.from(await response.arrayBuffer())),reference.sha256);
 const before=JSON.parse(fs.readFileSync(path.resolve('evidence/validation/h3-long-generation/workspace/studio.json'),'utf8')).runs.find(item=>item.id===inputs.sourceRunId).remote.segments[1];
 assert.equal(before.remote.seed,part.remote.seed);assert.equal(before.remote.duration,part.remote.duration);assert.equal(before.remote.audio.sha256,part.remote.audio.sha256);
 const left=structuredClone(before.remote.graph),right=structuredClone(part.remote.graph);
 for(const graph of [left,right]){graph['17'].inputs.image='实验图片路径';graph['18'].inputs.audio='同字节音轨路径';graph['16'].inputs.filename_prefix='实验输出前缀';}
 assert.deepEqual(right,left);
 const calls=read('http-calls.json'),submits=calls.filter(call=>call.method==='POST'&&call.url==='/prompt');assert.equal(submits.length,1);assert.equal(submits[0].promptId,part.remoteId);
 const report={at:new Date().toISOString(),runId:run.id,newSecondModelId:part.remoteId,firstSegmentReused:true,firstSegmentSource:prior.reusedFrom,reference,
  referenceIsActualRetainedLastFrame:true,decodedPixelsExactlyEqual:true,uploadedBytesExactlyEqual:true,sourceAudioBytesExactlyEqual:true,sameSeedAndOtherGraphParameters:true,
  submitCount:1,newVoiceGeneration:false,qualityAccepted:false,seamQualityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(root,'reference-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
