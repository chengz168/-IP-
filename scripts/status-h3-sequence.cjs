const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]||'evidence/validation/h3-long-generation');
async function main(){
 const data=JSON.parse(fs.readFileSync(path.join(root,'workspace/studio.json'),'utf8')),run=data.runs.find(item=>item.remote?.kind==='comfy-h3-sequence-v1');
 if(!run)throw Error('未找到原长片任务，不创建替代任务');
 const base=run.remote.baseUrl;
 const read=async route=>{const response=await fetch(base+route,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('本机查询HTTP '+response.status);return response.json();};
 const queue=await read('/queue'),segments=[];
 for(const segment of run.remote.segments){
  let liveStatus=segment.status;
  if(segment.remoteId){const history=await read('/history/'+encodeURIComponent(segment.remoteId));liveStatus=history[segment.remoteId]?.status?.status_str||(queue.queue_running.some(row=>row[1]===segment.remoteId)?'running':queue.queue_pending.some(row=>row[1]===segment.remoteId)?'queued':'unconfirmed');}
  segments.push({index:segment.index,savedStatus:segment.status,modelId:segment.remoteId||'',liveStatus});
 }
 const calls=JSON.parse(fs.readFileSync(path.join(root,'http-calls.json'),'utf8'));
 const report={at:new Date().toISOString(),runId:run.id,planId:run.remote.plan.id,productStatus:run.status,duration:run.remote.plan.duration,segments,submitCount:calls.filter(call=>call.method==='POST'&&call.url==='/prompt').length,longVideoVerified:run.status==='succeeded'&&!!run.output?.id,qualityAccepted:false,completeReplica:false};
 fs.writeFileSync(path.join(root,'live-status.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
