const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../server/service.cjs');
const {digest}=require('../server/backup.cjs');
const fixture=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ip-backup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('备份包含真实素材，可恢复任务，并保留恢复前副本及当前服务连接',async t=>{
  const service=createService(fixture(t));const item=await service.invoke('importFile',{name:'原始资料.txt',base64:Buffer.from('真实文件内容').toString('base64')});
  const draft=service.store.draft();draft.title='备份前标题';draft.sourceText='来源';service.store.save();
  const backup=await service.invoke('backup');const manifest=JSON.parse(fs.readFileSync(path.join(backup.directory,'manifest.json')));assert.equal(manifest.files.length,1);
  const media=path.join(backup.directory,manifest.files[0].file);assert.equal(await digest(media),manifest.files[0].sha256);
  service.store.draft().title='备份后修改';service.store.data.settings.provider.baseUrl='http://current.local/v1';service.store.save();
  const result=await service.invoke('restoreBackup',{directory:backup.directory});
  assert.equal(service.store.draft().title,'备份前标题');assert.equal(fs.readFileSync(service.store.asset(item.id).path,'utf8'),'真实文件内容');
  assert.equal(service.store.data.settings.provider.baseUrl,'http://current.local/v1');
  const safety=JSON.parse(fs.readFileSync(path.join(result.safetyDirectory,'studio.json'),'utf8'));assert.equal(safety.drafts[0].title,'备份后修改');
});
test('损坏备份媒体时拒绝恢复，当前业务状态及磁盘数据保留',async t=>{
  const service=createService(fixture(t));await service.invoke('importFile',{name:'原文.txt',base64:Buffer.from('原文').toString('base64')});const backup=await service.invoke('backup');const manifest=JSON.parse(fs.readFileSync(path.join(backup.directory,'manifest.json'),'utf8'));
  fs.writeFileSync(path.join(backup.directory,manifest.files[0].file),'已损坏');service.store.draft().title='保留当前任务';service.store.save();const before=fs.readFileSync(service.store.file,'utf8');
  await assert.rejects(service.invoke('restoreBackup',{directory:backup.directory}),/校验失败/);assert.equal(fs.readFileSync(service.store.file,'utf8'),before);assert.equal(service.store.draft().title,'保留当前任务');
});
test('运行中的任务阻止恢复，备份中的目录穿越被拒绝',async t=>{
  const service=createService(fixture(t));await service.invoke('importFile',{name:'原文.txt',base64:Buffer.from('原文').toString('base64')});const backup=await service.invoke('backup');service.runtime.controllers.set('active',new AbortController());await assert.rejects(service.invoke('restoreBackup',{directory:backup.directory}),/正在执行/);service.runtime.controllers.clear();
  const file=path.join(backup.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.files[0].file='../studio.json';fs.writeFileSync(file,JSON.stringify(manifest));await assert.rejects(service.invoke('restoreBackup',{directory:backup.directory}),/超出/);
});
