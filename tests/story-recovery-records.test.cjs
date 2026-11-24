const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../server/store.cjs');

function recover(runs){const store={data:{runs,workflowJobs:[]}};Store.prototype.recover.call(store);return store;}
const source=(overrides={})=>({id:'source',draftId:'draft',type:'story-video',status:'failed',terminalConfirmed:true,remoteId:'original-remote',...overrides});
const query=(overrides={})=>({id:'query',draftId:'draft',type:'story-recover',status:'unknown',parameters:{runId:'source'},remoteId:'original-remote',error:'查询中断',endedAt:'2026-11-23T00:00:00.000Z',...overrides});

test('原生成明确失败或取消后结束遗留恢复查询，保留原记录与查询凭据',()=>{
 for(const status of ['failed','cancelled'])for(const reverse of [false,true]){
  const original=source({status}),before=structuredClone(original),pending=query(),queryBefore=structuredClone(pending);
  recover(reverse?[original,pending]:[pending,original]);
  assert.deepEqual(original,before);assert.equal(pending.status,'failed');assert.equal(pending.terminalConfirmed,true);
  assert.equal(pending.remoteId,queryBefore.remoteId);assert.deepEqual(pending.parameters,queryBefore.parameters);
  assert.deepEqual(pending.unresolvedHistory,{error:queryBefore.error,endedAt:queryBefore.endedAt});assert(pending.recoveredAt);
  const settled=structuredClone(pending);recover([pending,original]);assert.deepEqual(pending,settled);
 }
});

test('退出时仍在查询的记录先恢复为unknown，再依据原任务确认终态结束',()=>{
 const pending=query({status:'running'});recover([pending,source()]);assert.equal(pending.status,'failed');assert.equal(pending.terminalConfirmed,true);
});

test('原生成未知、未确认、不同草稿、非生成任务或丢失时，不擅自解除待查状态',()=>{
 for(const original of [source({status:'unknown'}),source({terminalConfirmed:false}),source({terminalConfirmed:'true'}),source({draftId:'other'}),source({type:'speech'}),source({status:'succeeded'}),null]){
  const pending=query(),before=structuredClone(pending);recover(original?[pending,original]:[pending]);assert.deepEqual(pending,before);
 }
});
