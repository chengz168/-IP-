const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createService}=require('../server/service.cjs');
const {runProcess}=require('../server/media.cjs');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'evidence/validation/reference-sample-20261115'),workspace=path.join(directory,'workspace');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2));
async function main(){
 const mode=process.argv[2];
 if(!['generate','status'].includes(mode))throw Error('必须显式选择generate或status');
 if(mode==='status'){
  const state=JSON.parse(fs.readFileSync(path.join(workspace,'studio.json'),'utf8'));
  console.log(JSON.stringify({draft:state.drafts[0],runs:state.runs.map(run=>({id:run.id,type:run.type,status:run.status,remoteId:run.remoteId,progress:run.progress,activity:run.activity,error:run.error,outputId:run.output?.id,logs:run.logs.slice(-2)}))}));return;
 }
 if(fs.existsSync(path.join(workspace,'studio.json')))throw Error('本次工作区已存在，必须查询原任务，禁止重新提交');
 const queue=await (await fetch('http://127.0.0.1:8188/queue')).json();
 if(queue.queue_running.length||queue.queue_pending.length)throw Error('本机模型仍有任务，未提交');
 const source='F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4';
 const original='F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4';
 const configFile=path.join(root,'evidence/validation/indextts-generation/workspace/studio.json');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const protectedFiles=[source,original,path.join(root,'data/studio.json'),configFile].map(file=>({file,sha256:hash(file)}));
 const service=createService(workspace),store=service.store;
 store.data.settings={...config.settings,view:'new',outputDir:path.join(workspace,'outputs'),provider:{...config.settings.provider,avatarProtocol:'comfy-h3',avatarUrl:'http://127.0.0.1:8188'}};
 store.data.avatars=[];store.data.voices=[];store.data.runs=[];store.save();
 const shape=store.addAsset(source,{name:'示例2-夜间.mp4',origin:'user-selected-reference-builtin-avatar'});
 const avatar={id:crypto.randomUUID(),name:'示例2-夜间',assetId:shape.id,createdAt:new Date().toISOString(),status:'sample-only'};store.data.avatars.push(avatar);
 const driver=path.join(directory,'reference-first-8s.wav');
 await runProcess(service.media.binaries().ffmpeg,['-v','error','-n','-i',original,'-t','8','-vn','-ac','1','-ar','32000','-c:a','pcm_s16le',driver]);
 const audio=store.addAsset(driver,{name:'对标原音轨前8秒.wav',origin:'reference-audio-reused-for-comparison',duration:8});
 const draft=store.draft();draft.title='示例2夜间·同输入真实H3画面对照';draft.step=3;draft.mode='manual';draft.finalText='';draft.confirmed=false;
 draft.video={...draft.video,mode:'single',avatarId:avatar.id,audioId:audio.id,assetId:''};store.save();
 write('inputs.json',{at:new Date().toISOString(),draftId:draft.id,source,original,avatarId:avatar.id,shapeId:shape.id,audio:{id:audio.id,path:audio.path,sha256:hash(audio.path),duration:8},protectedFiles,originalAudioReused:true,newSpeechGenerated:false,newVideoGenerated:false,fullLengthReferenceDuration:208,targetDuration:8,qualityAccepted:false});
 console.log(JSON.stringify({stage:'submitted-via-product-service',draftId:draft.id,audio:audio.id,source}));
 const output=await service.invoke('avatar',{id:draft.id});
 const run=store.data.runs.find(run=>run.type==='avatar');
 write('generated-video.json',{at:new Date().toISOString(),runId:run.id,promptId:run.remoteId,output,sha256:hash(output.path),newVideoGenerated:true,originalAudioReused:true,newSpeechGenerated:false,protectedFiles:protectedFiles.map(item=>({...item,unchanged:hash(item.file)===item.sha256})),qualityAccepted:false});
 console.log(JSON.stringify({stage:'generated',runId:run.id,promptId:run.remoteId,file:output.path}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
