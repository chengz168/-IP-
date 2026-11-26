const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../server/store.cjs');
const {summarizeTasks}=require('../server/task-state.cjs');

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new Store(root);}
function asset(store,name,type){const file=path.join(store.root,name);fs.writeFileSync(file,'文件引用契约数据，不是生成媒体');return store.addAsset(file,{type});}
function state(store){return {...store.state(),taskSummaries:summarizeTasks(store.data)};}

test('底栏仅精确完成和跳过状态显示就绪，配置变化与未知状态不误绿',async()=>{
 const {isWorkflowStatusReady}=await import('../src/workflow-output-status.mjs');
 for(const status of ['原文案 已填写','最终文案 已确认','改写文案 已填写','当前音频 已跳过','当前音频 已就绪','当前视频 已就绪','剪辑结果 已生成','标题封面 已生成','平台 草稿已保存','平台 已发布','发布包 已导出'])assert.equal(isWorkflowStatusReady(status),true,status);
 for(const name of ['当前音频','当前视频','剪辑结果','标题封面'])for(const suffix of ['未生成','待检查','配置已变化','不可用'])assert.equal(isWorkflowStatusReady(name+' '+suffix),false,name+' '+suffix);
 for(const status of ['原文案 未填写','改写文案 未填写','平台 正在处理','平台 结果待确认','发布信息 待发布','平台 已取消','平台 已中断','平台 已导出，待发布','未知状态 已完成','当前视频 已就绪但已失效','',undefined,null])assert.equal(isWorkflowStatusReady(status),false,String(status));
});

test('底栏按真实磁盘文件判音频视频剪辑封面，缺失/空文件不可就绪，恢复后就绪',async t=>{
 const {workflowOutputStatus,isWorkflowStatusReady}=await import('../src/workflow-output-status.mjs'),store=fixture(t),draft=store.draft();
 const files=[asset(store,'audio.wav','audio'),asset(store,'video.mp4','video'),asset(store,'edit.mp4','video'),asset(store,'cover.png','image')];
 draft.voice.audioId=files[0].id;draft.video.assetId=files[1].id;draft.edit.resultId=files[2].id;draft.cover.assetId=files[3].id;
 for(const [i,file] of files.entries()){
  assert.match(workflowOutputStatus(state(store),draft,i+2),/已就绪|已生成/);
  fs.renameSync(file.path,file.path+'.held');assert.match(workflowOutputStatus(state(store),draft,i+2),/不可用/);assert.equal(isWorkflowStatusReady(workflowOutputStatus(state(store),draft,i+2)),false);
  fs.writeFileSync(file.path,'');assert.match(workflowOutputStatus(state(store),draft,i+2),/不可用/);
  fs.rmSync(file.path);fs.renameSync(file.path+'.held',file.path);assert.match(workflowOutputStatus(state(store),draft,i+2),/已就绪|已生成/);
 }
});

test('本地未保存生产输入不借用后端旧就绪，换引用等待检查，失效版本不可用',async t=>{
 const {workflowOutputStatus}=await import('../src/workflow-output-status.mjs'),store=fixture(t),draft=store.draft(),audio=asset(store,'audio.wav','audio'),video=asset(store,'video.mp4','video'),cover=asset(store,'cover.png','image');
 draft.voice.audioId=audio.id;draft.video.assetId=video.id;draft.edit.resultId=video.id;draft.cover.assetId=cover.id;
 const snapshot=state(store),next=structuredClone(draft);next.voice.speed=1.2;
 for(const step of [2,3,4])assert.match(workflowOutputStatus(snapshot,next,step),/配置已变化/);
 next.cover.title='新标题';assert.match(workflowOutputStatus(snapshot,next,5),/配置已变化/);
 next.voice.audioId='other';assert.match(workflowOutputStatus(snapshot,next,2),/待检查/);
 draft.edit.titleEnabled=true;draft.edit.title='旧标题';draft.edit.titleDesign=(await import('../server/title-model.mjs')).titleDesign({});video.renderedTitle={version:1};
 assert.match(workflowOutputStatus(state(store),draft,4),/不可用/);
});

test('当前剪辑源可独立就绪，无旁白明确跳过，缺摘要不得凭ID就绪',async t=>{
 const {workflowOutputStatus}=await import('../src/workflow-output-status.mjs'),store=fixture(t),draft=store.draft(),video=asset(store,'video.mp4','video');
 draft.edit.sourceId=video.id;const snapshot=state(store),next=structuredClone(draft);next.voice.speed=1.2;
 assert.equal(workflowOutputStatus(snapshot,next,3),'当前视频 已就绪');
 draft.video.mode='story';draft.story={narrationMode:'none'};assert.equal(workflowOutputStatus(state(store),draft,2),'当前音频 已跳过');
 assert.equal(workflowOutputStatus({...state(store),taskSummaries:[]},draft,3),'当前视频 待检查');
});

test('生成首帧视频只更新结果引用，不误报封面设计变化；改画幅仍立即提示过期',async t=>{
 const {workflowOutputStatus}=await import('../src/workflow-output-status.mjs'),store=fixture(t),draft=store.draft(),cover=asset(store,'cover.png','image');draft.cover.assetId=cover.id;
 const snapshot=state(store),next=structuredClone(draft);next.cover.videoId='new-covered-video';next.publish.videoId=next.cover.videoId;
 assert.equal(workflowOutputStatus(snapshot,next,5),'标题封面 已生成');
 next.cover.scene={version:1,width:1920,height:1080,layers:[]};assert.equal(workflowOutputStatus(snapshot,next,5),'标题封面 配置已变化');
});
