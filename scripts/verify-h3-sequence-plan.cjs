const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../server/h3-plan.cjs');
const root=path.resolve(process.argv[2]||'evidence/validation/h3-long-generation');

// 用真实FFmpeg解码逐段驱动，核对它们与完整驱动的精确采样区间，未提交模型任务。
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1');
 if(!run)throw Error('尚未产生真实分段计划');
 const remote=run.remote,plan=remote.plan,media=new Media({data}),pcm=fs.readFileSync(plan.fullAudio);assert.equal(digest(plan),remote.planSha256);
 const verified=[];let cursor=0,frame=0;
 for(const part of plan.segments){
  assert.equal(part.startSample,cursor);assert.equal(part.startFrame,frame);const target=path.join(root,'decoded-driver-'+part.index+'.pcm');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',part.audio,'-map','0:a:0','-f','s16le','-acodec','pcm_s16le','-ar','32000','-ac','1',target]);
  const decoded=fs.readFileSync(target),expected=pcm.subarray(part.startSample*2,part.endSample*2);assert(decoded.equals(expected));
  verified.push({index:part.index,startSample:part.startSample,endSample:part.endSample,frameCount:part.frameCount,duration:part.duration,boundary:part.boundary,decodedSamples:decoded.length/2,decodedSha256:digest(decoded),exactSourceInterval:true});cursor=part.endSample;frame=part.endFrame;
 }
 assert.equal(cursor,plan.totalSamples);assert.equal(frame,plan.totalFrames);assert.equal(digest(fs.readFileSync(plan.sourceAudio)),plan.sourceAudioSha256);
 const report={at:new Date().toISOString(),runId:run.id,planId:plan.id,planSha256:remote.planSha256,totalSamples:plan.totalSamples,totalFrames:plan.totalFrames,duration:plan.duration,segments:verified,allSamplesCoveredExactlyOnce:true,allFramesCoveredExactlyOnce:true,archivedOriginalDriverVerified:true,qualityAccepted:false};
 fs.writeFileSync(path.join(root,'plan-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
