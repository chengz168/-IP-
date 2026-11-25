const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');

test('设置保存接受桌面数字输入框的数值，并持久化为协议需要的字符串',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-settings-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const service=createService(root);
  await service.invoke('saveSettings',{outputDir:'',provider:{textMaxTokens:1024,textContextTokens:8192,model:123,apiKey:'不能保存'}});
  const provider=(await service.invoke('state')).settings.provider;
  assert.equal(provider.textMaxTokens,'1024');assert.equal(provider.textContextTokens,'8192');
  assert.equal(provider.model,'');assert.equal(Object.hasOwn(provider,'apiKey'),false);
  const saved=JSON.parse(fs.readFileSync(service.store.file,'utf8'));
  assert.equal(saved.settings.provider.textContextTokens,'8192');
});
