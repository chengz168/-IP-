const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-appearance-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return createService(root);}

test('人物画面处理路径可保存且未知认证字段不能进入设置',async t=>{
 const service=fixture(t);
 await service.invoke('saveSettings',{outputDir:'',provider:{portraitPython:' D:/runtime/python.exe ',portraitModel:' D:/models/rvm.onnx ',portraitToken:'不保存'}});
 const saved=JSON.parse(fs.readFileSync(service.store.file,'utf8')).settings.provider;
 assert.equal(saved.portraitPython,'D:/runtime/python.exe');assert.equal(saved.portraitModel,'D:/models/rvm.onnx');assert.equal(Object.hasOwn(saved,'portraitToken'),false);
});

test('形象优化在已有生成任务时不新建任务或更改形象',async t=>{
 const service=fixture(t),id=service.store.data.currentId;
 service.store.data.runs.push({id:'existing',type:'avatar',draftId:id,status:'running'});
 await assert.rejects(service.invoke('avatarOptimize',{id,avatarId:'missing',look:'natural',background:'original'}),/尚未结束/);
 assert.equal(service.store.data.runs.length,1);assert.equal(service.store.data.avatars.length,0);
});

test('无效任务归属在运行记录建立前拒绝',async t=>{
 const service=fixture(t);
 await assert.rejects(service.invoke('avatarOptimize',{id:'missing',avatarId:'missing',look:'natural',background:'original'}),/任务不存在/);
 assert.equal(service.store.data.runs.length,0);
});

test('优化期间禁止修改环境与启动其他视频任务，状态与停止仍可用',async t=>{
 const service=fixture(t),id=service.store.data.currentId;
 const controller=new AbortController();service.runtime.controllers.set('optimizing',controller);
 service.store.data.runs.unshift({id:'optimizing',type:'avatar-optimize',draftId:id,status:'running'});
 for(const action of ['avatar','avatarOptimize','startWorkflow','saveSettings','backup','restoreBackup'])await assert.rejects(service.invoke(action,{id}),/形象优化正在执行/);
 assert.equal((await service.invoke('state')).runs[0].status,'running');
 await service.invoke('cancelRun',{id:'optimizing'});assert.equal(controller.signal.aborted,true);
});

test('省略任务id也不能绕过当前任务的自动工作流锁',async t=>{
 const service=fixture(t),id=service.store.data.currentId;
 service.store.data.workflowJobs=[{id:'job',draftId:id,status:'running'}];
 await assert.rejects(service.invoke('avatarOptimize',{avatarId:'missing',look:'natural',background:'original'}),/自动流程正在执行/);
 assert.equal(service.store.data.runs.length,0);
});

test('其他草稿的声音和画面任务也阻止启动人物优化',async t=>{
 const service=fixture(t),id=service.store.data.currentId;
 for(const type of ['speech','speech-test','story-image','story-video','story-recover']){
  service.store.data.runs=[{id:'other',draftId:'other-draft',type,status:'running'}];
  await assert.rejects(service.invoke('avatarOptimize',{id,avatarId:'missing'}),/任务尚未结束/);
  assert.equal(service.store.data.runs.length,1);
 }
});
