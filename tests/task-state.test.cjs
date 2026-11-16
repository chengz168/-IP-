const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Store}=require('../server/store.cjs');
const {summarizeTasks}=require('../server/task-state.cjs');
const {createService}=require('../server/service.cjs');

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-task-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function run(draft,type,status,createdAt,extra={}){return {id:type+'-'+createdAt,draftId:draft.id,type,status,createdAt,progress:status==='succeeded'?100:0,...extra};}
function fileAsset(store,name,type){const file=path.join(store.root,name);fs.writeFileSync(file,'仅用于文件引用契约，不是媒体验收');return store.addAsset(file,{type});}

test('旧自定义标题成片不计为就绪但保留文件，版本3恢复就绪',async t=>{
 const store=new Store(fixture(t)),d=store.draft(),video=fileAsset(store,'title-old.mp4','video');d.edit.sourceId=video.id;d.edit.resultId=video.id;d.edit.titleEnabled=true;d.edit.title='旧标题';d.edit.titleDesign=(await import('../server/title-model.mjs')).titleDesign({});video.renderedTitle={version:1};const before=JSON.stringify(d);
 assert.equal(summarizeTasks(store.data)[0].stages[4].available,false);assert.match(summarizeTasks(store.data)[0].stages[4].message,/标题排版版本/);assert.equal(JSON.stringify(d),before);assert.ok(fs.existsSync(video.path));video.renderedTitle.version=3;assert.equal(summarizeTasks(store.data)[0].stages[4].available,true);
});
test('空任务待处理，点击第七页不制造业务进度或完成状态',t=>{
  const store=new Store(fixture(t));const draft=store.draft();draft.step=6;
  const item=summarizeTasks(store.data)[0];
  assert.equal(item.status,'pending');assert.equal(item.progress,0);assert.equal(item.currentStep,0);assert.equal(item.viewedStep,6);assert.equal(item.mode,'manual');
});
test('历史改写成功和已导出发布包不等于已确认文案或真实发布',t=>{
  const store=new Store(fixture(t));const draft=store.draft();draft.sourceText='原文';draft.rewrite='历史返回';draft.finalText='未确认';
  store.data.runs.push(run(draft,'rewrite','succeeded','2026-11-14T00:00:00Z'));
  draft.publish.recordId='exported';store.data.publishRecords.push({id:'exported',draftId:draft.id,status:'exported'});
  const item=summarizeTasks(store.data)[0];
  assert.equal(item.progress,14);assert.equal(item.stages[1].available,false);assert.equal(item.stages[1].latest.status,'succeeded');
  assert.equal(item.stages[6].available,false);assert.equal(item.stages[6].label,'已导出，待发布');assert.notEqual(item.status,'succeeded');
});
test('当前素材必须引用正确类型、普通文件且非空；删除文件降低进度并保留历史',t=>{
  const store=new Store(fixture(t));const draft=store.draft();const video=fileAsset(store,'input.mp4','video');
  draft.edit.sourceId=video.id;draft.edit.resultId=video.id;
  store.data.runs.push(run(draft,'render','succeeded','2026-11-14T00:00:00Z'));
  let item=summarizeTasks(store.data)[0];assert.equal(item.progress,29);assert.match(item.stages[3].message,/手动导入/);
  draft.voice.audioId=video.id;assert.equal(summarizeTasks(store.data)[0].stages[2].available,false);
  fs.rmSync(video.path);item=summarizeTasks(store.data)[0];assert.equal(item.progress,0);assert.equal(item.stages[4].latest.status,'succeeded');assert.match(item.stages[4].message,/历史成功/);
  fs.writeFileSync(video.path,'');assert.equal(summarizeTasks(store.data)[0].stages[4].available,false);
});
test('当前六阶段全部就绪仍未发布；上游失效降低进度，不篡改历史成功',t=>{
  const store=new Store(fixture(t));const draft=store.draft();
  const audio=fileAsset(store,'voice.wav','audio'),video=fileAsset(store,'result.mp4','video'),cover=fileAsset(store,'cover.png','image');
  Object.assign(draft,{sourceText:'原稿',rewrite:'改写',finalText:'已确认',confirmed:true});draft.voice.audioId=audio.id;draft.video.assetId=video.id;draft.edit.resultId=video.id;draft.cover.assetId=cover.id;
  store.data.runs.push(run(draft,'render','succeeded','2026-11-14T00:00:00Z'));
  const before=summarizeTasks(store.data)[0];assert.equal(before.progress,86);assert.equal(before.status,'running');assert.equal(before.currentStep,6);
  const next=structuredClone(draft);next.finalText='更新文案';store.updateDraft(next);
  const after=summarizeTasks(store.data)[0];assert.equal(after.progress,43);assert.equal(after.stages[4].available,false);assert.equal(after.stages[4].latest.status,'succeeded');
});
test('失败可由新的成功恢复当前状态，但旧远程待确认不能被后一次成功隐藏',t=>{
  const store=new Store(fixture(t));const draft=store.draft();
  store.data.runs.push(run(draft,'rewrite','failed','2026-11-14T00:00:00Z',{error:'真实失败'}));
  assert.equal(summarizeTasks(store.data)[0].status,'failed');
  draft.sourceText='原文';draft.finalText='已确认';draft.confirmed=true;
  store.data.runs.push(run(draft,'rewrite','succeeded','2026-11-14T00:01:00Z'));
  assert.equal(summarizeTasks(store.data)[0].status,'running');
  store.data.runs.push(run(draft,'avatar','unknown','2026-11-14T00:02:00Z',{remoteId:'remote-actual-id'}));
  store.data.runs.push(run(draft,'avatar','succeeded','2026-11-14T00:03:00Z'));
  const item=summarizeTasks(store.data)[0];assert.equal(item.status,'unknown');assert.equal(item.deletable,false);assert.equal(item.unknownRuns[0].remoteId,'remote-actual-id');assert.equal(item.stages[3].status,'unknown');
});
test('服务状态只返回派生摘要，运行/排队/未知任务删除被拒绝，正常删除保持素材',async t=>{
  const service=createService(fixture(t));const draft=service.store.draft();const json=fs.readFileSync(service.store.file,'utf8');
  const result=await service.invoke('state');assert.equal(result.taskSummaries.length,1);assert.equal(fs.readFileSync(service.store.file,'utf8'),json);
  for(const status of ['running','queued','unknown']){
    service.store.data.runs=[run(draft,'avatar',status,'2026-11-14T00:00:00Z',{remoteId:status==='unknown'?'remote-id':''})];
    await assert.rejects(service.invoke('deleteDraft',{id:draft.id}),status==='unknown'?/尚未确认/:/运行或排队/);
    assert.equal(service.store.data.runs.length,1);assert.equal(service.store.draft().id,draft.id);
  }
  service.store.data.runs[0].status='failed';const asset=fileAsset(service.store,'kept.mp4','video');
  await service.invoke('deleteDraft',{id:draft.id});assert.equal(service.store.data.runs.length,0);assert.notEqual(service.store.draft().id,draft.id);assert(fs.existsSync(asset.path));
});
