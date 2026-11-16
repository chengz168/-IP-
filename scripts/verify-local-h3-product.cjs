const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
const {LocalAsr}=require('../server/local-asr.cjs');
const root=path.resolve('evidence/validation/local-generation');

// 读取真实产品任务及其绑定资产，只验证已有产物，不提交新的推理请求。
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8'));
 const run=data.runs.find(r=>r.type==='avatar'&&r.remote?.kind==='comfy-h3-v1');
 if(!run||run.status!=='succeeded'||!run.output?.id)throw Error('真实产品 H3 任务尚未取回成功');
 const asset=data.assets.find(a=>a.id===run.output.id),draft=data.drafts.find(d=>d.id===run.draftId);
 if(!asset||asset.origin!=='comfy-h3'||asset.h3?.promptId!==run.remoteId)throw Error('产物来源或模型任务ID不匹配');
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 if(sha(asset.path)!==asset.h3.outputSha256)throw Error('产品输出文件散列不匹配');
 const media=new Media({data}),probe=await media.probe(asset.path),directory=path.join(root,'product-output');
 fs.mkdirSync(directory,{recursive:true});
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const frames=path.join(directory,'contact-sheet.jpg');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf','fps=1,scale=264:-1,tile=5x1','-frames:v','1','-update','1',frames]);
 const report={checkedAt:new Date().toISOString(),runId:run.id,promptId:run.remoteId,assetId:asset.id,video:asset.path,
  sha256:sha(asset.path),bytes:fs.statSync(asset.path).size,probe,fullDecodeVerified:true,contactSheet:frames,
  boundToOriginalDraft:draft.video.assetId===asset.id,sourceImageSha256:asset.h3.sourceImageSha256,driverSha256:asset.h3.driverSha256,
  newModelVideo:true,newVoiceGeneration:false,audioOrigin:asset.h3.audioOrigin,referenceInputsOrigin:'first-own-h3-generation',
  recoveredAfterActualRestart:!!run.unresolvedHistory,remoteChecks:run.remoteChecks,qualityAccepted:false,referenceParityAccepted:false,
  audioAudited:false,syncReviewed:false};
 try{report.asr=await new LocalAsr({data,asset:id=>data.assets.find(a=>a.id===id)},media).transcribe(asset.id,{progress:(v,m)=>console.log(m)});}
 catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(directory,'media-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({runId:run.id,promptId:run.remoteId,video:asset.path,duration:probe.format.duration,bytes:report.bytes,sha256:report.sha256,bound:report.boundToOriginalDraft,asr:report.asr?.text,contactSheet:frames}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
