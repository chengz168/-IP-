const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const directory=path.resolve('evidence/validation/h3-continuity/seam-comparison');

// 统计接缝两帧的像素变化；它不等价于听感、口型或自然度评分。
async function inspect(root,label){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1');
 assert.equal(run.status,'succeeded');const asset=data.assets.find(item=>item.id===run.output?.id),boundary=run.remote.plan.segments[0].endFrame,media=new Media({data});
 const file=path.join(directory,label+'.rgb');
 await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',asset.path,'-vf',`trim=start_frame=${boundary-1}:end_frame=${boundary+1},setpts=PTS-STARTPTS`,'-frames:v','2','-pix_fmt','rgb24','-f','rawvideo',file]);
 const bytes=fs.readFileSync(file),width=608,height=1056,size=width*height*3;assert.equal(bytes.length,size*2);
 const regions={full:{x:0,y:0,w:width,h:height},face:{x:170,y:140,w:280,h:360},hands:{x:20,y:790,w:560,h:266}},metrics={};
 for(const [name,r] of Object.entries(regions)){
  let absolute=0,squared=0,count=0;
  for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)for(let c=0;c<3;c++){
   const at=(y*width+x)*3+c,difference=bytes[at]-bytes[size+at];absolute+=Math.abs(difference);squared+=difference*difference;count++;
  }
  metrics[name]={region:r,meanAbsoluteByteDifference:absolute/count,rootMeanSquareByteDifference:Math.sqrt(squared/count)};
 }
 return {runId:run.id,video:asset.path,boundaryFrame:boundary,metrics};
}
async function main(){
 fs.mkdirSync(directory,{recursive:true});
 const before=await inspect(path.resolve('evidence/validation/h3-long-generation'),'before'),after=await inspect(path.resolve('evidence/validation/h3-continuity'),'after');
 const result={at:new Date().toISOString(),before,after,meaning:'只反映接缝相邻两帧的RGB变化，不是自然度或同步质量评分',qualityAccepted:false,seamQualityAccepted:false};
 fs.writeFileSync(path.join(directory,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
