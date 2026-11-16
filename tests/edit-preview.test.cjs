const test=require('node:test'),assert=require('node:assert/strict');
const {editPreviewResult,editPreviewSignature}=require('../src/edit-preview-model.mjs');
const {createDraft}=require('../server/store.cjs');
function fixture(){const draft=createDraft();draft.edit.sourceId='source';draft.edit.resultId='result';const asset={id:'result',type:'video',size:1000,name:'成片.mp4'},run={id:'run',draftId:draft.id,type:'render',status:'succeeded',snapshot:structuredClone(draft),output:{id:asset.id},endedAt:'2026-11-14T00:00:00Z'};return {draft,asset,run,state:{drafts:[structuredClone(draft)],assets:[asset],runs:[run]}};}
test('当前成片与渲染快照一致，切页、标题名和字段顺序不使其过期',()=>{
 const {draft,state}=fixture();draft.step=4;draft.title='任务名称';draft.edit=Object.fromEntries(Object.entries(draft.edit).reverse());assert.equal(editPreviewResult(state,draft).dirty,false);assert.equal(editPreviewResult(state,draft).asset.id,'result');
});
test('未保存剪辑参数立即标旧成片，保存清空当前结果后仍可历史对照且不修改草稿',()=>{
 const {draft,state}=fixture();draft.edit.speed=1.25;assert.equal(editPreviewResult(state,draft).dirty,true);draft.edit.resultId='';const before=JSON.stringify({draft,state}),r=editPreviewResult(state,draft);assert.equal(r.asset.id,'result');assert.equal(r.dirty,true);assert.equal(JSON.stringify({draft,state}),before);
});
test('改配置后又改回但当前结果已失效，不能仅凭历史快照恢复就绪',()=>{
 const {draft,state}=fixture();draft.edit.resultId='';assert.equal(editPreviewSignature(draft),editPreviewSignature(state.runs[0].snapshot));assert.equal(editPreviewResult(state,draft).dirty,true);assert.equal(draft.edit.resultId,'');
});
test('切换视频源和任务后不泄漏旧预览，即使界面仍短暂带旧结果ID',()=>{
 const {draft,state}=fixture();draft.edit.sourceId='other-source';assert.equal(editPreviewResult(state,draft).asset,null);draft.edit.resultId='';draft.id='other-task';draft.edit.sourceId='source';assert.equal(editPreviewResult(state,draft).asset,null);
});
test('只从成功且存在的同源输出中选择最新一条，失败和其他任务不参与',()=>{
 const {draft,state,run}=fixture();draft.edit.resultId='';state.assets.push({id:'new',type:'video',size:20},{id:'other',type:'video',size:20});state.runs.push({...run,id:'newrun',endedAt:'2026-11-14T01:00:00Z',output:{id:'new'}},{...run,id:'bad',status:'failed',endedAt:'2026-11-14T02:00:00Z',output:{id:'other'}},{...run,draftId:'other-task',id:'wrongtask',endedAt:'2026-11-14T03:00:00Z',output:{id:'other'}});assert.equal(editPreviewResult(state,draft).asset.id,'new');state.assets=state.assets.filter(a=>a.id!=='new');assert.equal(editPreviewResult(state,draft).asset.id,'result');
});
test('没有执行快照的旧任务使用已保存草稿对照，空文件和非视频不提供预览',()=>{
 const {draft,state}=fixture();state.runs=[];assert.equal(editPreviewResult(state,draft).dirty,false);draft.edit.volume=2;assert.equal(editPreviewResult(state,draft).dirty,true);state.assets[0].size=0;assert.equal(editPreviewResult(state,draft).asset,null);state.assets[0].size=1;state.assets[0].type='image';assert.equal(editPreviewResult(state,draft).asset,null);
});

test('旧自定义标题成片标为未更新，版本3及无标题成片不误报',()=>{
 const {draft,state,asset}=fixture();draft.edit.titleEnabled=true;draft.edit.title='旧标题';draft.edit.titleDesign={mode:'custom'};state.runs[0].snapshot=structuredClone(draft);state.drafts[0]=structuredClone(draft);
 asset.renderedTitle={version:1};assert.equal(editPreviewResult(state,draft).dirty,true);asset.renderedTitle.version=3;assert.equal(editPreviewResult(state,draft).dirty,false);
 draft.edit.titleEnabled=false;state.runs[0].snapshot=structuredClone(draft);asset.renderedTitle.version=1;assert.equal(editPreviewResult(state,draft).dirty,false);
});

test('字幕模板规则升级后预览保留历史文件并标旧，当前版本恢复一致',()=>{
 const {draft,state,asset}=fixture();Object.assign(draft.edit,{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:'simple_yellow_white'});state.runs[0].snapshot=structuredClone(draft);
 assert.equal(editPreviewResult(state,draft).dirty,true);assert.equal(editPreviewResult(state,draft).asset.id,asset.id);asset.renderedSubtitleTemplate={templateId:'simple_yellow_white',engineVersion:2};assert.equal(editPreviewResult(state,draft).dirty,false);
});
