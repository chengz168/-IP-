const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../server/store.cjs'),{createService}=require('./support/licensed-service.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-handoff-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function seed(store){const d=store.draft();d.video.assetId='avatar-old';d.edit.resultId='render-old';d.cover.assetId='cover-old';d.cover.videoId='covered-old';Object.assign(d.publish,{videoId:'render-old',coverId:'cover-old',recordId:'package-old'});store.data.publishRecords=[{id:'package-old',status:'exported'}];store.save();return structuredClone(d);}

test('同参数重剪后发布默认绑定跟随新剪辑，旧首帧视频及发布包失效',t=>{
 const store=new Store(fixture(t)),next=seed(store);next.edit.resultId='render-new';store.updateDraft(next);
 const saved=store.draft();assert.equal(saved.edit.resultId,'render-new');assert.equal(saved.publish.videoId,'');assert.equal(saved.cover.videoId,'');assert.equal(saved.publish.recordId,'');assert.equal(saved.cover.assetId,'cover-old');assert.equal(store.data.publishRecords[0].id,'package-old');
});
test('重剪后解除旧首帧封面视频的发布引用',t=>{
 const store=new Store(fixture(t)),next=seed(store);next.publish.videoId='covered-old';store.updateDraft(next);next.edit.resultId='render-new';store.updateDraft(next);
 assert.equal(store.draft().cover.videoId,'');assert.equal(store.draft().publish.videoId,'');
});
test('重新剪辑保留另外手选的视频和封面，撤销旧发布包引用',t=>{
 const store=new Store(fixture(t)),next=seed(store);next.publish.videoId='independent-video';next.publish.coverId='independent-cover';store.updateDraft(next);next.publish.recordId='manual-package';store.updateDraft(next);next.edit.resultId='render-new';store.updateDraft(next);
 assert.equal(store.draft().publish.videoId,'independent-video');assert.equal(store.draft().publish.coverId,'independent-cover');assert.equal(store.draft().publish.recordId,'');
});
test('同内容封面重新生成时默认发布图跟随新图，旧首帧封面视频失效',t=>{
 const store=new Store(fixture(t)),next=seed(store);next.publish.videoId='covered-old';store.updateDraft(next);next.cover.assetId='cover-new';store.updateDraft(next);
 assert.equal(store.draft().cover.assetId,'cover-new');assert.equal(store.draft().publish.coverId,'');assert.equal(store.draft().cover.videoId,'');assert.equal(store.draft().publish.videoId,'');assert.equal(store.draft().edit.resultId,'render-old');
});
test('同输入替换数字人产物会解除原视频默认发布引用',t=>{
 const store=new Store(fixture(t)),next=seed(store);next.publish.videoId='avatar-old';store.updateDraft(next);next.video.assetId='avatar-new';store.updateDraft(next);
 assert.equal(store.draft().video.assetId,'avatar-new');assert.equal(store.draft().edit.resultId,'');assert.equal(store.draft().publish.videoId,'');
});
test('产物交接写盘失败时完整回滚稿件及当前任务',t=>{
 const store=new Store(fixture(t)),next=seed(store),before=structuredClone(store.data),disk=fs.readFileSync(store.file);next.edit.resultId='render-new';const save=store.save;store.save=()=>{throw Error('磁盘故障');};assert.throws(()=>store.updateDraft(next),/磁盘故障/);store.save=save;
 assert.deepEqual(store.data,before);assert(disk.equals(fs.readFileSync(store.file)));
});
test('手动剪辑服务使用统一交接，不抢切当前任务',async t=>{
 const service=createService(fixture(t)),next=seed(service.store),other=await service.invoke('newDraft');service.pipMatching.render=async()=>({id:'render-new'});
 await service.invoke('render',{id:next.id});const saved=service.store.draft(next.id);assert.equal(saved.edit.resultId,'render-new');assert.equal(saved.cover.videoId,'');assert.equal(saved.publish.videoId,'');assert.equal(service.store.data.currentId,other.id);
});
test('剪辑期间输入改变时只保留返回素材，不覆盖当前发布选择',async t=>{
 const service=createService(fixture(t)),next=seed(service.store);service.pipMatching.render=async()=>{const changed=structuredClone(service.store.draft(next.id));changed.edit.volume=.6;changed.publish.videoId='independent-video';service.store.updateDraft(changed);return{id:'late-render'};};
 const output=await service.invoke('render',{id:next.id});assert.equal(output.stale,true);assert.equal(service.store.draft(next.id).edit.resultId,'');assert.equal(service.store.draft(next.id).publish.videoId,'independent-video');
});
test('同参数重新配音使用统一交接，保留历史文件但解除旧视频引用',async t=>{
 const service=createService(fixture(t)),next=seed(service.store);service.store.draft(next.id).voice.audioId='speech-old';service.store.save();service.providers.speech=async()=>({id:'speech-new'});
 await service.invoke('speech',{id:next.id});const saved=service.store.draft(next.id);assert.equal(saved.voice.audioId,'speech-new');assert.equal(saved.video.assetId,'');assert.equal(saved.edit.resultId,'');assert.equal(saved.publish.videoId,'');assert.equal(saved.cover.videoId,'');
});
