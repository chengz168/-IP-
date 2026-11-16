const fs=require('node:fs'),path=require('node:path');
const {Media}=require('../server/media.cjs');
const {H3Sequence}=require('../server/h3-sequence.cjs');
const root=path.resolve('evidence/validation/h3-long-generation');

// 仅使用已成功片段重现封装；保存失败输出供检查，不提交模型、不保存产品数据。
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1');
 const directory=fs.mkdtempSync(path.join(root,'assembly-diagnostic-')),records=[];
 const media=new Media({data}),probe=media.probe.bind(media);
 media.probe=async file=>{const info=await probe(file);records.push({file,info});if(path.basename(file)==='final.mp4')fs.copyFileSync(file,path.join(directory,'actual-final.mp4'));return info;};
 const store={addAsset(){throw Error('诊断模式禁止写入产品资产');},data};
 let error;try{await new H3Sequence(store,media,{}).collect(run.remote,run.parameters.input);}catch(cause){error=cause.message;}
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({at:new Date().toISOString(),runId:run.id,error,plan:run.remote.plan,records},null,2));
 console.log(JSON.stringify({directory,error,plannedFrames:run.remote.plan.totalFrames,plannedDuration:run.remote.plan.duration,records:records.map(item=>({name:path.basename(item.file),duration:item.info.format.duration,streams:item.info.streams.map(s=>({type:s.codec_type,frames:s.nb_frames,start:s.start_time,duration:s.duration,timeBase:s.time_base}))}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
