const fs=require('node:fs'),path=require('node:path');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../server/h3-plan.cjs');
const root=path.resolve(process.argv[3]||'evidence/validation/h3-long-generation');
async function main(){
 const index=Number(process.argv[2]||0);if(!Number.isInteger(index)||index<0)throw Error('片段编号无效');
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1'),segment=run?.remote.segments[index];
 if(segment?.status!=='succeeded'||!segment.output?.path)throw Error('原片段尚未取回，不生成替代画面');
 const video=segment.output.path;if(digest(fs.readFileSync(video))!==segment.output.sha256)throw Error('片段文件哈希已变化');
 const directory=path.join(root,'segment-'+index);fs.mkdirSync(directory,{recursive:true});const media=new Media({data}),probe=await media.probe(video),contactSheet=path.join(directory,'contact-sheet.jpg');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',video,'-vf','fps=0.75,scale=240:-1,tile=6x1','-frames:v','1','-update','1',contactSheet]);
 const lower=path.join(directory,'lower-frames');fs.mkdirSync(lower,{recursive:true});
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',video,'-vf','crop=608:360:0:696,scale=304:180,tile=4x8','-q:v','2',path.join(lower,'frames-%02d.jpg')]);
 const report={at:new Date().toISOString(),runId:run.id,index,modelId:segment.remoteId,video,sha256:segment.output.sha256,probe,planned:run.remote.plan.segments[index],contactSheet,
  lowerFrameSheets:fs.readdirSync(lower).filter(name=>name.endsWith('.jpg')).map(name=>path.join(lower,name)),reviewed:false,qualityAccepted:false,continuousLipSyncReviewed:false};
 fs.writeFileSync(path.join(directory,'inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({index,modelId:segment.remoteId,contactSheet,sheets:report.lowerFrameSheets.length,qualityAccepted:false},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
