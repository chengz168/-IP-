const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Media,runProcess}=require('../server/media.cjs');
async function main(){
  const root=path.resolve('evidence/validation/functional-desktop-workspace');
  const data=JSON.parse(fs.readFileSync(path.join(root,'studio.json'),'utf8'));
  const media=new Media({data});const {ffmpeg,ffprobe}=media.binaries();
  const asset=id=>{const a=data.assets.find(a=>a.id===id);assert.ok(a,'未找到素材'+id);return a;};
  const readReport=(name,destination)=>{
    const a=data.assets.find(a=>a.name===name);assert.ok(a,'缺少桌面报告'+name);
    const report=JSON.parse(fs.readFileSync(a.path,'utf8'));
    fs.writeFileSync(path.resolve('evidence/validation',destination),JSON.stringify(report,null,2));return report;
  };
  const forms=readReport('营销桌面表单验证.json','functional-desktop-forms.json');
  const cover=readReport('首帧桌面验证.json','functional-desktop-cover.json');
  const silence=readReport('剪气口桌面验证.json','functional-desktop-silence.json');
  const source=asset(cover.sourceId),output=asset(cover.resultId),image=asset(cover.coverId);
  const pixels=async(file,label,count)=>{
    const out=path.join(root,'verify-'+label+'.rgb');
    await runProcess(ffmpeg,['-v','error','-y','-i',file,'-vf','scale=96:170,format=rgb24','-frames:v',String(count),'-fps_mode','passthrough','-f','rawvideo',out]);
    return fs.readFileSync(out);
  };
  const [a,b,c]=await Promise.all([pixels(source.path,'source',3),pixels(output.path,'output',3),pixels(image.path,'cover',1)]);
  const length=96*170*3,mae=(x,y)=>{assert.equal(x.length,y.length);let total=0;for(let i=0;i<x.length;i++)total+=Math.abs(x[i]-y[i]);return total/x.length;};
  const errors={cover:mae(b.subarray(0,length),c),body:[1,2].map(i=>mae(a.subarray(i*length,(i+1)*length),b.subarray(i*length,(i+1)*length)))};
  assert.ok(errors.cover<5&&errors.body.every(e=>e<5));
  const times=async file=>JSON.parse(await runProcess(ffprobe,['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',file])).frames.map(f=>Number(f.best_effort_timestamp_time));
  const [before,after]=await Promise.all([times(source.path),times(output.path)]);assert.equal(before.length,after.length);
  const maxTimestampDifference=Math.max(...before.map((t,i)=>Math.abs(t-after[i])));assert.ok(maxTimestampDifference<.001);
  const audioHash=async file=>(await runProcess(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'])).trim();
  const [sourceAudioHash,outputAudioHash]=await Promise.all([audioHash(source.path),audioHash(output.path)]);assert.equal(sourceAudioHash,outputAudioHash);
  const silenceProbe=await media.probe(asset(silence.resultId).path);
  const videoDuration=Number(silenceProbe.streams.find(s=>s.codec_type==='video').duration),audioDuration=Number(silenceProbe.streams.find(s=>s.codec_type==='audio').duration);
  assert.ok(Math.abs(videoDuration-audioDuration)<.1);
  await runProcess(ffmpeg,['-v','error','-y','-i',output.path,'-vf','select=lte(n\\,1),scale=270:480,tile=2x1','-frames:v','1',path.resolve('evidence/validation/functional-desktop-cover-frames.png')]);
  const report={checkedAt:new Date().toISOString(),status:'passed',scope:'隔离源码桌面操作与其实际媒体产物；不代表完整产品验收',forms,cover:{...cover,source:source.path,result:output.path,errors,frames:after.length,maxTimestampDifference,sourceAudioHash,outputAudioHash,runId:data.runs.find(r=>r.type==='cover-video'&&r.output?.id===output.id)?.id},silence:{...silence,result:asset(silence.resultId).path,videoDuration,audioDuration}};
  fs.writeFileSync('evidence/validation/functional-desktop-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,frames:after.length,errors,maxTimestampDifference,audioIdentical:true,silence:{videoDuration,audioDuration},file:'evidence/validation/functional-desktop-report.json'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
