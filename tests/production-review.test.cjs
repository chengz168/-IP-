const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../server/store.cjs'),{ProductionReview,reviewItems}=require('../server/production-review.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),d=store.draft();const file=path.join(root,'test-video.mp4');fs.writeFileSync(file,'same-length-content-A');const asset=store.addAsset(file,{type:'video'});d.video.assetId=asset.id;d.edit.subtitlesEnabled=false;store.save();let probes=0;const media={probe:async()=>{probes++;return {streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:'4'}};}};return {store,d,asset,media,review:new ProductionReview({store,media}),probes:()=>probes};}
const checked=()=>Object.fromEntries(reviewItems.map(item=>[item.id,true]));
async function saveReview(f,view,extra={}){return f.review.save({id:f.d.id,fingerprint:view.fingerprint,historyVersion:view.historyVersion,status:'approved',checked:checked(),notes:'实际人工核对记录',...extra});}

test('质量复核保存人工凭据并刷新恢复，普通草稿不能伪造或擦除',async t=>{
 const f=fixture(t),view=await f.review.get({id:f.d.id});assert.equal(view.status,'unchecked');assert.equal(view.technicalPassed,true);assert.match(view.media[0].sha256,/^[a-f0-9]{64}$/);
 const result=await saveReview(f,view);assert.equal(result.status,'approved');assert.equal(result.currentReview.method,'human-review');assert.equal((await f.review.get({id:f.d.id})).status,'approved');
 const prior=structuredClone(f.d.artifacts.productionReviews);f.store.updateDraft({...structuredClone(f.d),artifacts:{productionReviews:[{status:'approved',fingerprint:'forged'}]}});assert.deepEqual(f.store.draft(f.d.id).artifacts.productionReviews,prior);
 const reopened=new Store(f.store.root);assert.deepEqual(reopened.draft(f.d.id).artifacts.productionReviews,prior);
});

test('无历史时普通保存不可注入质量通过',t=>{const f=fixture(t);f.store.updateDraft({...structuredClone(f.d),artifacts:{productionReviews:[{status:'approved'}]}});assert.equal(f.store.draft(f.d.id).artifacts.productionReviews,undefined);});

test('同编号同长度媒体替换使历史失效，保存旧指纹拒绝且不覆盖',async t=>{
 const f=fixture(t),view=await f.review.get({id:f.d.id});await saveReview(f,view);const prior=structuredClone(f.d.artifacts.productionReviews);fs.writeFileSync(f.asset.path,'same-length-content-B');const changed=await f.review.get({id:f.d.id});assert.equal(changed.status,'stale');assert.notEqual(changed.fingerprint,view.fingerprint);assert.deepEqual(changed.history,prior);await assert.rejects(saveReview(f,view),/已变化/);assert.deepEqual(f.d.artifacts.productionReviews,prior);
});

test('文案字幕及设置变化撤销本版复核，未审看与空问题说明不允许通过',async t=>{
 const f=fixture(t);let view=await f.review.get({id:f.d.id});await assert.rejects(saveReview(f,view,{checked:{}}),/逐项/);await assert.rejects(saveReview(f,view,{status:'needs-changes',notes:' '}),/具体问题/);await saveReview(f,view,{status:'needs-changes',notes:'动作出现变形'});assert.equal((await f.review.get({id:f.d.id})).status,'needs-changes');
 for(const change of [()=>f.d.finalText='新文案',()=>f.d.edit.captions=[{start:0,end:1,text:'新字幕'}],()=>f.d.edit.speed=1.25]){view=await f.review.get({id:f.d.id});await saveReview(f,view);change();assert.equal((await f.review.get({id:f.d.id})).status,'stale');}
});

test('媒体缺失、无视频轨或错误字幕不会通过技术检查',async t=>{
 const f=fixture(t);f.media.probe=async()=>({streams:[{codec_type:'audio'}],format:{duration:'4'}});let view=await f.review.get({id:f.d.id});assert.equal(view.technicalPassed,false);await assert.rejects(saveReview(f,view),/技术检查/);
 f.media.probe=async()=>({streams:[{codec_type:'video'}],format:{duration:'4'}});f.d.edit.subtitlesEnabled=true;f.d.edit.captions=[{start:2,end:1,text:'倒序'}];view=await f.review.get({id:f.d.id});assert.equal(view.checks.find(r=>r.id==='captions').passed,false);
 f.d.edit.captions=[{start:3,end:5,text:'超出片尾'}];view=await f.review.get({id:f.d.id});assert.equal(view.checks.find(r=>r.id==='captions').passed,false);
 fs.unlinkSync(f.asset.path);view=await f.review.get({id:f.d.id});assert.equal(view.technicalPassed,false);assert(view.media[0].error);
});

test('探测期间文案或字节变化拒绝迟到检查，不留通过记录',async t=>{
 for(const change of [f=>{f.d.finalText='期间改稿';},f=>{fs.writeFileSync(f.asset.path,'same-length-content-B');}]){const f=fixture(t);f.media.probe=async()=>{change(f);return {streams:[{codec_type:'video'}],format:{duration:'4'}};};await assert.rejects(f.review.get({id:f.d.id}),/检查期间/);assert.equal(f.d.artifacts.productionReviews,undefined);}
});

test('复核保存失败回滚，重复旧历史版本不能覆盖新记录',async t=>{
 const f=fixture(t),view=await f.review.get({id:f.d.id}),before=structuredClone(f.d);const original=f.store.save;f.store.save=()=>{throw Error('磁盘不可写');};await assert.rejects(saveReview(f,view),/磁盘不可写/);assert.deepEqual(f.d,before);f.store.save=original;await saveReview(f,view);await assert.rejects(saveReview(f,view,{status:'needs-changes',notes:'旧窗口'}),/复核记录已变化/);assert.equal(f.d.artifacts.productionReviews.length,1);
});

test('活动任务及结果待确认禁止保存，探测过程中新增活动也禁止',async t=>{
 for(const status of ['queued','running','unknown']){const f=fixture(t),view=await f.review.get({id:f.d.id});f.store.data.runs.push({id:'active',draftId:f.d.id,status});await assert.rejects(saveReview(f,view),/仍在执行/);assert.equal(f.d.artifacts.productionReviews,undefined);}
 const f=fixture(t),view=await f.review.get({id:f.d.id});f.media.probe=async()=>{f.store.data.runs.push({draftId:f.d.id,status:'running'});return {streams:[{codec_type:'video'}],format:{duration:'4'}};};await assert.rejects(saveReview(f,view),/仍在执行/);
});

test('真实Service接口可检查且禁止普通草稿伪造，无媒体不能记录通过',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-review-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const service=require('../server/service.cjs').createService(root),d=service.store.draft();const view=await service.invoke('getProductionReview',{id:d.id});assert.equal(view.status,'unchecked');assert.equal(view.technicalPassed,false);await assert.rejects(service.invoke('saveProductionReview',{id:d.id,fingerprint:view.fingerprint,historyVersion:view.historyVersion,status:'approved',checked:checked(),notes:''}),/待交付视频/);
});
