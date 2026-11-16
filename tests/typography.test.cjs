const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../server/service.cjs');
const {Store}=require('../server/store.cjs');

test('旧字号配置重启可用，损坏字号修复为舒适且保留任务与其更新时间',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-appearance-load-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let store=new Store(root);const tasks=structuredClone(store.data.drafts);
  for(const [input,expected]of [['comfortable','comfortable'],['large','large'],['unknown','comfortable'],[null,'comfortable']]){
    store.data.settings.fontSize=input;store.save();store=new Store(root);assert.equal(store.data.settings.fontSize,expected);assert.deepEqual(store.data.drafts,tasks);assert.equal(JSON.parse(fs.readFileSync(store.file,'utf8')).settings.fontSize,expected);
  }
});

test('四档字体与独立原软件证据一致，旧配置及非法配置有明确回退',async()=>{
  const {fontPresets,normalizeFontSize,applyTypography}=await import('../src/typography.mjs');
  const evidence=JSON.parse(fs.readFileSync(path.resolve('evidence/reference/font-presets-evidence.json'),'utf8'));
  assert.deepEqual(fontPresets,evidence.presets);
  assert.equal(normalizeFontSize('comfortable'),'comfortable');assert.equal(normalizeFontSize('large'),'large');assert.equal(normalizeFontSize('unknown'),'comfortable');
  const properties={},root={style:{setProperty:(key,value)=>properties[key]=value},dataset:{}};
  applyTypography('large',root);assert.equal(properties['--app-font-size-body'],'18px');assert.equal(properties['--app-font-size-page-title'],'32px');assert.equal(root.dataset.fontSize,'large');
  applyTypography(undefined,root);assert.equal(properties['--app-font-size-body'],'16px');assert.equal(root.dataset.fontSize,'comfortable');
});

test('字号保存只改外观，不动任务时间、产物、模型设置或密钥；拒绝非法值',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-appearance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let keyWrites=0;const service=createService(root,{get:async()=>'',set:async()=>keyWrites++});
  const before=structuredClone(service.store.data);
  await service.invoke('saveAppearance',{fontSize:'compact',provider:{model:'不应保存'},key:'不应保存',outputDir:'不应保存'});
  const expected=structuredClone(before);expected.settings.fontSize='compact';assert.deepEqual(service.store.data,expected);assert.deepEqual(JSON.parse(fs.readFileSync(service.store.file,'utf8')),expected);assert.equal(keyWrites,0);
  for(const fontSize of ['unknown','18px',null,123]){
    await assert.rejects(service.invoke('saveAppearance',{fontSize}),/界面字号无效/);
    await assert.rejects(service.invoke('saveSettings',{outputDir:'不能写',provider:{model:'不能写'},fontSize,key:'不能写'}),/界面字号无效/);
  }
  assert.deepEqual(service.store.data,expected);assert.deepEqual(JSON.parse(fs.readFileSync(service.store.file,'utf8')),expected);assert.equal(keyWrites,0);
});

test('字号写盘失败时恢复内存和旧文件',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-appearance-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const service=createService(root),before=structuredClone(service.store.data),saved=fs.readFileSync(service.store.file,'utf8');
  service.store.save=()=>{throw new Error('模拟磁盘写入失败');};
  await assert.rejects(service.invoke('saveAppearance',{fontSize:'large'}),/模拟磁盘写入失败/);
  assert.deepEqual(service.store.data,before);assert.equal(fs.readFileSync(service.store.file,'utf8'),saved);
});
