const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Store}=require('../server/store.cjs'),{Media}=require('../server/media.cjs'),{ComfyH3}=require('../server/comfy-h3.cjs');
const directory=path.resolve('evidence/validation/indextts-h3-chain'),workspace=path.join(directory,'workspace'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 if(fs.existsSync(path.join(directory,'tail-repair.json')))throw Error('已存在修复回执，停止重复封装');
 let active=false;try{const result=await fetch('http://127.0.0.1:9343/json/version',{signal:AbortSignal.timeout(1500)});active=result.ok;}catch{}
 if(active)throw Error('请先正常关闭本批独立源码窗口，禁止并发写入工作区');
 const store=new Store(workspace),media=new Media(store),h3=new ComfyH3(store,media),submission=JSON.parse(fs.readFileSync(path.join(directory,'submission.json'),'utf8')),run=store.data.runs.find(run=>run.id===submission.runId);
 assert.equal(run?.status,'succeeded');assert(!store.data.runs.some(item=>['running','queued','cancelling'].includes(item.status)));
 const before=structuredClone(store.data),prior=store.asset(run.output.id),calls=[];let created;
 // 维护操作只查询原任务和下载已有输出，不创建伪造中断状态，也不提交模型。
 h3.request=async(_base,route,options={})=>{if(options.method&&options.method!=='GET')throw Error('重封装维护仅允许GET');const call={at:new Date().toISOString(),method:'GET',url:route};calls.push(call);const response=await fetch('http://127.0.0.1:8188'+route);call.httpStatus=response.status;return response;};
 try{
  const result=await h3.query(run.remoteId,run.remote,{});assert.equal(result.status,'succeeded');
  created=await h3.collect(result,run.remote,run.parameters.input,{}, {persist:false});assert.equal(created.h3.generatedVideoSha256,prior.h3.generatedVideoSha256);
  const originalRunOutput=structuredClone(run.output),at=new Date().toISOString();
  run.outputHistory=[...(run.outputHistory||[]),{at,reason:'短片尾帧封装修正，保留原模型输出',output:originalRunOutput,sha256:hash(prior.path)}];run.output=created;
  const next=structuredClone(store.draft(run.draftId));next.video.assetId=created.id;store.updateDraft(next,{persist:false});store.save();
  const receipt={at,runId:run.id,promptId:run.remoteId,oldAsset:{id:prior.id,path:prior.path,sha256:hash(prior.path)},newAsset:{id:created.id,path:created.path,sha256:hash(created.path),frameCount:created.h3.frameCount,muxPolicy:created.h3.muxPolicy},sameGeneratedVideoSha256:created.h3.generatedVideoSha256,modelSubmissionsInRepair:0,maintenanceOnly:true,invokedProductCollectModule:true,submittedThroughButton:false,httpCalls:calls,qualityAccepted:false};
  fs.writeFileSync(path.join(directory,'tail-repair.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }catch(error){store.data=before;if(created)fs.rmSync(created.path,{force:true});throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
