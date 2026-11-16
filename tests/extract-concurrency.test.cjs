const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createService}=require('../server/service.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-extract-concurrency-')),before=new Set(process.listeners('exit')),service=createService(root);
 const listener=process.listeners('exit').find(fn=>!before.has(fn));t.after(()=>{if(listener)process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 return service;
}
function controlled(service){
 const calls=[];
 service.providers.transcribe=(assetId,ctx)=>new Promise((resolve,reject)=>{
  calls.push({assetId,resolve,reject});ctx.signal.addEventListener('abort',()=>reject(Error('夹具提取已取消')),{once:true});
 });return calls;
}

test('同草稿双提交只有1个run和provider调用，保留提取前稿件',async t=>{
 const service=fixture(t),draft=service.store.draft(),calls=controlled(service),before=structuredClone(draft);
 const pending=service.invoke('extract',{id:draft.id,assetId:'仅provider夹具'});
 assert.equal(calls.length,1);assert.equal(service.store.data.runs.length,1);
 await assert.rejects(service.invoke('extract',{id:draft.id,assetId:'第二次夹具'}),/已有文案提取/);
 assert.equal(calls.length,1);assert.equal(service.store.data.runs.length,1);
 calls[0].resolve({text:'契约结果'});assert.equal((await pending).text,'契约结果');assert.deepEqual(service.store.draft(),before);
});

test('提取失败后可重试，历史失败记录保留',async t=>{
 const service=fixture(t),id=service.store.draft().id,calls=controlled(service);
 const first=service.invoke('extract',{id,assetId:'夹具'}),failed=assert.rejects(first,/受控失败/);calls[0].reject(Error('受控失败'));await failed;
 assert.equal(service.store.data.runs[0].status,'failed');
 const next=service.invoke('extract',{id,assetId:'夹具'});assert.equal(calls.length,2);calls[1].resolve({text:'重试返回'});await next;
 assert.equal(service.store.data.runs.length,2);assert.equal(service.store.data.runs[0].status,'succeeded');assert.equal(service.store.data.runs[1].status,'failed');
});

test('提取取消完成后可重试，不抢先创建第二次运行',async t=>{
 const service=fixture(t),id=service.store.draft().id,calls=controlled(service),pending=service.invoke('extract',{id,assetId:'夹具'});
 const cancelled=assert.rejects(pending,/已取消/);await service.invoke('cancelRun',{id:service.store.data.runs[0].id});await cancelled;
 assert.equal(service.store.data.runs[0].status,'cancelled');
 const retried=service.invoke('extract',{id,assetId:'夹具'});assert.equal(calls.length,2);calls[1].resolve({text:'取消后重试'});await retried;
});

for(const status of ['queued','unknown'])test(status+'提取拒绝同草稿重交，不调用provider',async t=>{
 const service=fixture(t),id=service.store.draft().id,calls=controlled(service);
 service.store.data.runs.unshift({id:'夹具已有运行',draftId:id,type:'extract',status});service.store.save();
 await assert.rejects(service.invoke('extract',{id,assetId:'夹具'}),/远程结果待确认/);assert.equal(calls.length,0);assert.equal(service.store.data.runs.length,1);
});

test('不同草稿提取互不误拦，同草稿其他type也不被视为extract重复',async t=>{
 const service=fixture(t),first=service.store.draft(),second=await service.invoke('newDraft'),calls=controlled(service);
 service.store.data.runs.unshift({id:'其他类型',draftId:first.id,type:'transcribe',status:'running'});
 const a=service.invoke('extract',{id:first.id,assetId:'甲夹具'}),b=service.invoke('extract',{id:second.id,assetId:'乙夹具'});
 assert.equal(calls.length,2);assert.equal(service.store.data.runs.filter(r=>r.type==='extract').length,2);
 calls[0].resolve({text:'甲'});calls[1].resolve({text:'乙'});assert.deepEqual((await Promise.all([a,b])).map(value=>value.text),['甲','乙']);
});
