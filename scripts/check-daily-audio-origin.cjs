// 解码成相同采样规格后核对音轨来源，不用波形相关性评价真人感。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const root=path.resolve(__dirname,'../evidence/validation/daily-local-workspace-20261116');
async function main(){
 const generated=JSON.parse(fs.readFileSync(path.join(root,'generated.json'),'utf8'));
 const data=JSON.parse(fs.readFileSync(path.resolve(root,'../../../workspaces/local-studio/studio.json'),'utf8'));
 const {ffmpeg}=new Media({data}).binaries(),signals={};
 for(const kind of ['speech','render']){
  const file=path.join(root,kind+'-origin.pcm');
  await runProcess(ffmpeg,['-v','error','-n','-i',generated.outputs[kind].path,'-map','0:a:0','-ac','1','-ar','16000','-f','s16le',file]);
  signals[kind]=fs.readFileSync(file);
 }
 const samples=Math.min(signals.speech.length,signals.render.length)/2;let x=0,y=0,xx=0,yy=0,xy=0;
 for(let i=0;i<samples;i++){const a=signals.speech.readInt16LE(i*2),b=signals.render.readInt16LE(i*2);x+=a;y+=b;xx+=a*a;yy+=b*b;xy+=a*b}
 const correlation=(xy-x*y/samples)/Math.sqrt((xx-x*x/samples)*(yy-y*y/samples));
 const result={at:new Date().toISOString(),sourceSpeechId:generated.outputs.speech.id,renderId:generated.outputs.render.id,sampleRate:16000,samples,correlation,sourcePreserved:correlation>.99,humanNaturalnessAccepted:false};
 fs.writeFileSync(path.join(root,'audio-origin.json'),JSON.stringify(result,null,2),{flag:'wx'});assert(result.sourcePreserved,'音轨相关性不足，保留证据并调查，不冒认来源通过');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error);process.exitCode=1});
