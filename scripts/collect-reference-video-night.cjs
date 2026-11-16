const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {ComfyH3}=require('../server/comfy-h3.cjs'),{Store}=require('../server/store.cjs'),{Media,runProcess}=require('../server/media.cjs');
const directory=path.resolve('evidence/validation/reference-video-night-20261115'),receipt=JSON.parse(fs.readFileSync(path.join(directory,'submission.json'),'utf8'));
const write=(file,data)=>fs.writeFileSync(path.join(directory,file),JSON.stringify(data,null,2)),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 if(fs.existsSync(path.join(directory,'collection.json')))throw Error('已有回收记录，禁止重复创建资产');
 if(!receipt.promptId)throw Error('尚未查回原任务ID');
 const h3=new ComfyH3({},{}),activity=[];
 const observer=await h3.observe(receipt.remote,{activity:details=>{activity.push(details);write('activity.json',activity);console.log(JSON.stringify(details));}});observer.bind(receipt.promptId);
 let state;
 try{
  const until=Date.now()+45*60*1000;
  while(Date.now()<until){
   state=await h3.query(receipt.promptId,receipt.remote);write('status.json',{at:new Date().toISOString(),...state});
   if(state.status==='succeeded')break;
   if(['failed','cancelled'].includes(state.status))throw Error('原任务已确认'+state.status+'：'+state.error);
   await new Promise(resolve=>setTimeout(resolve,5000));
  }
  if(state.status!=='succeeded')throw Error('等待时限已到，保留原任务，不能重交');
 }finally{observer.close();}
 const workspace=path.join(directory,'workspace'),store=new Store(workspace);
 const previous=JSON.parse(fs.readFileSync(path.resolve('evidence/validation/reference-sample-20261115/workspace/studio.json'),'utf8'));
 store.data.settings={...previous.settings,outputDir:path.join(workspace,'outputs')};store.save();
 const media=new Media(store),collector=new ComfyH3(store,media);
 const asset=await collector.collect(state,receipt.remote,{referenceVideoSha256:receipt.reference.sha256,experimental:true});
 await runProcess(media.binaries().ffmpeg,['-v','error','-i',asset.path,'-f','null','-']);
 const probe=await media.probe(asset.path),picture=probe.streams.find(stream=>stream.codec_type==='video');
 const exported=path.join(directory,'generated-ref2va.mp4');fs.copyFileSync(asset.path,exported);
 write('collection.json',{at:new Date().toISOString(),promptId:receipt.promptId,asset,exported,sha256:hash(exported),width:picture.width,height:picture.height,frames:picture.nb_frames,duration:Number(probe.format.duration),fullDecodeVerified:true,submittedThroughProductButton:false,experimental:true,originalAudioReused:true,newSpeechGenerated:false,qualityAccepted:false});
 console.log(JSON.stringify({collected:true,promptId:receipt.promptId,exported}));
}
main().catch(error=>{write('collection-error.json',{at:new Date().toISOString(),promptId:receipt.promptId,error:error.stack});console.error(error);process.exitCode=1;});
