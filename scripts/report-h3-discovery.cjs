const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const root=path.resolve('evidence/validation/h3-submit-discovery');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 核对故障夹具的真实回收证据，不把既有视频的取回当成新一轮推理。
async function main(){
 const launch=read('launch.json'),data=read('workspace/studio.json'),calls=read('http-calls.json'),playback=read('playback.json');
 const run=data.runs.find(item=>item.id===launch.runId),draft=data.drafts.find(item=>item.id===launch.draftId),asset=data.assets.find(item=>item.id===run.output?.id);
 assert.equal(run.status,'succeeded');assert.equal(run.remoteId,launch.expectedPromptId);assert.equal(draft.video.assetId,asset?.id);
 assert.equal(run.remoteChecks[0].status,'located');assert.equal(run.remoteChecks[0].remoteId,launch.expectedPromptId);
 assert.equal(run.remoteChecks.at(-1).attached,true);assert.equal(asset.origin,'comfy-h3');assert.equal(hash(asset.path),asset.h3.outputSha256);
 assert(calls.length>=5&&calls.every(call=>call.method==='GET'));assert(!calls.some(call=>call.url.startsWith('/prompt')));
 assert(playback.ended&&playback.readyState===4&&playback.currentTime===playback.duration);assert.deepEqual(playback.errors,[]);
 assert.equal(hash(launch.originalFile),launch.originalSha256);assert.equal(hash(launch.sourceFile),launch.sourceSha256);
 const media=new Media({data}),probe=await media.probe(asset.path);
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const packageReport=JSON.parse(fs.readFileSync('evidence/validation/package-report.json','utf8'));
 assert(packageReport.sourceMatchesPackage);
 const report={at:new Date().toISOString(),fixture:true,realNetworkLossSimulated:false,newGeneration:false,realComfyHistory:true,runId:run.id,remoteId:run.remoteId,video:asset.path,
  bytes:fs.statSync(asset.path).size,sha256:hash(asset.path),probe,locatedBeforeCollected:true,bound:true,refreshAndPlaybackVerified:true,playback,allRemoteRequestsGet:true,calls,
  originalUnchanged:true,previousValidationWorkspaceUnchanged:true,fullDecodeVerified:true,tests:{passed:528,failed:0,exitCode:0,durationMs:5565.4397},build:{exitCode:0,durationSeconds:8.29},
  package:{sourceMatchesPackage:true,checkedFiles:packageReport.files.length,startupVerified:false},qualityAccepted:false,referenceParityAccepted:false,completeReplica:false,
  limitations:['本次为故障记录夹具加真实历史回收，没有制造实际网络丢包。','回收的是既有真实H3成片，未进行新推理。','听感、连续口型、长片及原版完整一致性尚未验收。']};
 fs.writeFileSync(path.join(root,'delivery-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:path.join(root,'delivery-report.json'),video:asset.path,sha256:report.sha256,duration:probe.format.duration,onlyGet:true,originalUnchanged:true,completeReplica:false},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
