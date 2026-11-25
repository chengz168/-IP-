const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');

test('新任务在唯一有效本地音色时默认选用，不改变旧任务或系统云端配置',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-draft-default-')),service=createService(root);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const old=service.store.draft(),prior=structuredClone(old),file=path.join(root,'reference.wav');
 fs.writeFileSync(file,Buffer.from('RIFF参考音色文件可用性测试'));
 const sample=service.store.addAsset(file,{type:'audio'});
 service.store.data.voices=[{id:'voice-C',name:'C参考女声',sampleId:sample.id}];service.store.data.settings.provider.ttsProtocol='indextts-local';
 const draft=await service.invoke('newDraft');assert.equal(draft.voice.profile,'voice-C');assert.equal(draft.voice.audioId,'');assert.deepEqual(service.store.draft(old.id),prior);
 assert.equal(JSON.parse(fs.readFileSync(service.store.file)).drafts[0].voice.profile,'voice-C');
 for(const protocol of ['windows','compatible']){service.store.data.settings.provider.ttsProtocol=protocol;assert.equal((await service.invoke('newDraft')).voice.profile,'');}
 service.store.data.settings.provider.ttsProtocol='indextts-local';service.store.data.voices.push({id:'voice-other',sampleId:sample.id});assert.equal((await service.invoke('newDraft')).voice.profile,'');
 service.store.data.voices.pop();fs.rmSync(sample.path);assert.equal((await service.invoke('newDraft')).voice.profile,'');
});
