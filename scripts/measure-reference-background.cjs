const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const directory=path.resolve('evidence/validation/lipsync-native-input-20261115');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(path.join(directory,'background-measurement.json')))throw Error('测量已有回执，请先检查，避免覆盖');
 const settings=JSON.parse(fs.readFileSync('evidence/validation/video-driver-audio/workspace/studio.json','utf8')).settings;
 const files=[['source','F:/Software/轻语IP智能体/aigc-human/resources/assets/videos/示例2-夜间.mp4'],['original','F:/Software/轻语IP智能体/aigc-human/outputs/videos/cloud_1794663289391.mp4'],['image',path.resolve('evidence/validation/reference-sample-20261115/generated.mp4')],['reference',path.resolve('evidence/validation/reference-video-night-20261115/generated-ref2va.mp4')]];
 const w=108,h=192,frameSize=w*h,decoded=[];
 for(const [key,file]of files){const result=spawnSync(settings.ffmpegPath,['-v','error','-i',file,'-map','0:v:0','-an','-vf',`fps=30,scale=${w}:${h}:flags=area,format=gray`,'-t','8','-f','rawvideo','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024,timeout:60000});if(result.error||result.status!==0)throw result.error||Error(result.stderr.toString());if(result.stdout.length!==240*frameSize)throw Error(key+'帧数不符');decoded.push({key,file,fileSha256:hash(fs.readFileSync(file)),decodedSha256:hash(result.stdout),frames:240,data:result.stdout});}
 const reference=decoded[0].data,results=[];
 for(const candidate of decoded.slice(1)){
  const regions={full:{count:0,absolute:0,square:0},edges:{count:0,absolute:0,square:0}},perFrame=[];
  for(let frame=0;frame<240;frame++){
   let sum=0,count=0;for(let pixel=0;pixel<frameSize;pixel++){const difference=Math.abs(reference[frame*frameSize+pixel]-candidate.data[frame*frameSize+pixel]);const x=pixel%w;for(const region of ['full',...(x<Math.floor(w*.2)||x>=Math.ceil(w*.8)?['edges']:[])]){regions[region].count++;regions[region].absolute+=difference;regions[region].square+=difference*difference;}if(x<Math.floor(w*.2)||x>=Math.ceil(w*.8)){sum+=difference;count++;}}
   perFrame.push({frame,time:frame/30,edgeMAE:sum/count});
  }
  results.push({key:candidate.key,regions:Object.fromEntries(Object.entries(regions).map(([name,v])=>[name,{pixels:v.count,meanAbsoluteError:v.absolute/v.count,rmse:Math.sqrt(v.square/v.count),psnr:v.square?10*Math.log10(255*255/(v.square/v.count)):null,identical:v.square===0}])),perFrame});
 }
 const report={at:new Date().toISOString(),method:{duration:8,fps:30,width:w,height:h,color:'gray',alignment:'相同时间戳，不进行身份或运动配准',edges:'左右各20%，避开当前示例中央脸部；仅观察固定样本背景',limitations:['108×192缩放会隐藏高频细节','局部像素差异不是身份、口型或真实感评分','没有自动质量通过阈值']},files:decoded.map(({data,...row})=>row),results,newModelSubmissions:0,newVideoGenerated:false,qualityAccepted:false};
 fs.writeFileSync(path.join(directory,'background-measurement.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(results.map(({key,regions})=>({key,regions})),null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
