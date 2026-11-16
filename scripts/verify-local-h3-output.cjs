const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Media,runProcess}=require('../server/media.cjs');
const {LocalAsr}=require('../server/local-asr.cjs');
const variant=process.argv[2]||'first-generation';
if(!['first-generation','guided-generation','official-prompt-guided'].includes(variant))throw Error('未知实验类型');
const root=path.resolve('evidence/research/generation-chain-20261115/comfy-h3',variant);
async function main(){
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'receipt.json'),'utf8'));
 if(receipt.history?.status?.status_str!=='success')throw Error('真实 H3 任务尚未成功完成');
 const item=receipt.history.outputs['16'].images[0],outputRoot=path.resolve(root,'../output');
 const video=path.resolve(outputRoot,item.subfolder,item.filename);
 if(!video.startsWith(outputRoot+path.sep))throw Error('产物路径越出验证输出目录');
 const data=JSON.parse(fs.readFileSync('evidence/validation/pip-desktop-workspace/studio.json','utf8'));
 const media=new Media({data}),probe=await media.probe(video);
 const report={checkedAt:new Date().toISOString(),promptId:receipt.submission.prompt_id,video,
  bytes:fs.statSync(video).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'),
  probe,newModelGeneration:true,referenceVideoUsed:false,referenceAudioUsed:variant!=='first-generation',referenceImageUsed:variant!=='first-generation',
  inputReferenceAudio:receipt.inputReferenceAudio||null,inputReferenceImage:receipt.inputReferenceImage||null,qualityAccepted:false,
  audioAudited:false,syncReviewed:false,referenceParityAccepted:false};
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',video,'-f','null','-']);report.fullDecodeVerified=true;
 const frames=path.join(root,'contact-sheet.jpg');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',video,'-vf','fps=1,scale=264:-1,tile=5x1','-frames:v','1','-update','1',frames]);
 report.contactSheet=frames;
 const audio=path.join(root,'generated-audio.wav');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',video,'-map','0:a:0','-vn','-ac','1','-ar','16000',audio]);report.audio=audio;
 const store={data:{...data,assets:[{id:'h3-output',type:'video',path:video}]},asset:()=>({id:'h3-output',type:'video',path:video})};
 try{report.asr=await new LocalAsr(store,media).transcribe('h3-output',{progress:(value,message)=>console.log(message)});}
 catch(error){report.asrError=error.message;}
 fs.writeFileSync(path.join(root,'media-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({video,bytes:report.bytes,sha256:report.sha256,streams:probe.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height})),duration:probe.format.duration,asr:report.asr?.text,asrError:report.asrError,frames}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
