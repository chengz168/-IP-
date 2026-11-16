const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {H3Sequence}=require('../server/h3-sequence.cjs'),{Media,runProcess}=require('../server/media.cjs'),{avatarContext}=require('../server/avatar-request.cjs'),{digest}=require('../server/h3-plan.cjs');
const root=path.resolve('evidence/validation/h3-multi-generation');

async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),directory=path.join(root,'preflight');fs.mkdirSync(directory,{recursive:true});
 // 仅从桌面已保存数据建立只读快照；计划写在独立目录，不持锁或修改桌面工作区。
 const store={data,asset(id){const asset=data.assets.find(item=>item.id===id);if(!asset)throw Error('缺少实际输入资源');return asset;},outputDir:()=>directory};
 const draft=data.drafts.find(item=>item.id===data.currentId);assert.equal(draft.video.mode,'multi');
 const media=new Media(store),sequence=new H3Sequence(store,media,{}),context=avatarContext(store,draft);let remote;
 await sequence.prepare(draft,{remote:(id,value)=>{remote=value;}},context);sequence.validate(remote,{source:true});
 const plan=remote.plan,pcm=fs.readFileSync(plan.fullAudio),parts=[],images=[];let cursor=0,frame=0;
 for(const part of plan.segments){
  assert.equal(part.startSample,cursor);assert.equal(part.startFrame,frame);const output=path.join(directory,'decoded-'+part.index+'.pcm');
  await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',part.audio,'-map','0:a:0','-f','s16le','-ar','32000','-ac','1',output]);
  assert(fs.readFileSync(output).equals(pcm.subarray(part.startSample*2,part.endSample*2)));
  parts.push({index:part.index,shotIndex:part.shotIndex,startSample:part.startSample,endSample:part.endSample,startFrame:part.startFrame,endFrame:part.endFrame,exactPcmInterval:true});cursor=part.endSample;frame=part.endFrame;
 }
 for(const shot of plan.shots){
  const extracted=path.join(directory,'source-first-'+shot.index+'.rgb'),planned=path.join(directory,'planned-first-'+shot.index+'.rgb');
  for(const [file,output]of [[shot.sourceVideo,extracted],[shot.image,planned]])await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',output]);
  assert(fs.readFileSync(extracted).equals(fs.readFileSync(planned)));images.push({shotIndex:shot.index,avatarId:shot.avatarId,sourceVideoSha256:shot.sourceVideoSha256,imageSha256:shot.imageSha256,pixelsMatchActualSourceFirstFrame:true});
 }
 assert.equal(cursor,plan.totalSamples);assert.equal(frame,plan.totalFrames);assert.notEqual(plan.shots[0].imageSha256,plan.shots[1].imageSha256);
 const report={at:new Date().toISOString(),planSha256:remote.planSha256,duration:plan.duration,totalFrames:plan.totalFrames,totalSamples:plan.totalSamples,shots:images,segments:parts,allSamplesCoveredExactlyOnce:true,allFramesCoveredExactlyOnce:true,modelSubmissions:0,qualityAccepted:false};
 assert.equal(digest(plan),remote.planSha256);fs.writeFileSync(path.join(directory,'remote.json'),JSON.stringify(remote,null,2));fs.writeFileSync(path.join(root,'preflight-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
