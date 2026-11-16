// 使用实际模型输出隔离比较编码和单位变速，保留首次失败现场。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
const {digest}=require('../integrations/musetalk-local/input.cjs');
const root=path.resolve('evidence/validation/local-full-workflow-20261115/audio-diagnosis');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function correlation(a,b){let xx=0,yy=0,xy=0;const n=Math.min(a.length,b.length)/2;for(let i=0;i<n;i++){const x=a.readInt16LE(i*2),y=b.readInt16LE(i*2);xx+=x*x;yy+=y*y;xy+=x*y;}return xy/Math.sqrt(xx*yy);}
async function main(){
 fs.mkdirSync(root,{recursive:true});assert(!fs.existsSync(path.join(root,'report.json')),'已有诊断收据，不重复执行');
 const generated=read('evidence/validation/local-full-workflow-20261115/generated.json'),data=read('evidence/validation/musetalk-integration-20261115/workspace/studio.json');
 const {ffmpeg}=new Media({data}).binaries(),source=generated.outputs.avatar;
 assert.equal(digest(source.path),source.sha256);
 const sourcePcm=path.join(root,'source.pcm');await runProcess(ffmpeg,['-v','error','-n','-i',source.path,'-map','0:a:0','-ac','1','-ar','16000','-f','s16le',sourcePcm]);
 const original=fs.readFileSync(sourcePcm),results=[];
 for(const [id,filter] of [['encode','anull'],['unity-tempo','asetpts=PTS-STARTPTS,atempo=1,volume=1'],['without-tempo','asetpts=PTS-STARTPTS,volume=1']]){
  const file=path.join(root,id+'.m4a'),pcm=path.join(root,id+'.pcm');
  await runProcess(ffmpeg,['-v','error','-n','-i',source.path,'-map','0:a:0','-af',filter,'-c:a','aac','-b:a','192k',file]);
  await runProcess(ffmpeg,['-v','error','-n','-i',file,'-ac','1','-ar','16000','-f','s16le',pcm]);
  results.push({id,filter,file,sha256:digest(file),correlation:correlation(original,fs.readFileSync(pcm))});
 }
 const report={at:new Date().toISOString(),source:source.path,sourceSha256:source.sha256,results,firstInspectionFailed:true,humanAudibilityNotEstablished:true};
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
