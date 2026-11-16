const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const logic=import('../server/video-shots.mjs');

test('镜头均分保留十分之一秒余数且拒绝过短或无效音频',async()=>{
 const {distributeShotDurations:split}=await logic;assert.deepEqual(split(19.157,3),[6.4,6.4,6.4]);assert.deepEqual(split(10,3),[3.4,3.3,3.3]);assert.equal(split(10,3).reduce((a,b)=>Math.round((a+b)*10)/10,0),10);for(const [duration,count] of [[NaN,2],[Infinity,2],[0,2],[.1,2],[1,0],[1,1.5]])assert.throws(()=>split(duration,count));
});
test('镜头排序不改原副本且边界位置不移动',async()=>{
 const {moveShot}=await logic;const rows=[{key:'a'},{key:'b'},{key:'c'}];assert.deepEqual(moveShot(rows,0,2).map(s=>s.key),['b','c','a']);assert.deepEqual(rows.map(s=>s.key),['a','b','c']);assert.deepEqual(moveShot(rows,0,-1),rows);
});
test('镜头引用及时间严校验，界面临时标识不进入保存值',async()=>{
 const {validateShots}=await logic;const avatars=[{id:'a'}];assert.deepEqual(validateShots([{key:'临时',avatarId:'a',duration:2.5}],avatars),[{avatarId:'a',duration:2.5}]);for(const rows of [[],[{avatarId:'missing',duration:1}],[{avatarId:'a',duration:0}],[{avatarId:'a',duration:-1}],[{avatarId:'a',duration:Infinity}],[{avatarId:'a',duration:'2'}]])assert.throws(()=>validateShots(rows,avatars));
});
test('保存镜头拒绝过期、失效资源和远程未知，成功时使旧下游产物失效',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shot-')),service=createService(root);const {shotInputSignature}=await logic;
 try{const d=service.store.draft(),assetPath=path.join(root,'fixture.mp4');fs.writeFileSync(assetPath,'此处仅验证资源存在性，不冒充实际媒体');const asset=service.store.addAsset(assetPath,{type:'video'});service.store.data.avatars.push({id:'a',name:'验收形象',assetId:asset.id});d.video.avatarId='a';d.video.mode='multi';d.video.shots=[{avatarId:'a',duration:10}];d.video.assetId='old-video';d.edit.resultId='old-edit';d.cover.assetId='old-cover';d.publish.recordId='old-publish';service.store.save();const signature=shotInputSignature(d);
 await assert.rejects(service.handlers.saveVideoShots({id:d.id,shots:[{avatarId:'a',duration:2}],signature:'过期'}),/已变化/);assert.equal(d.video.assetId,'old-video');
 await assert.rejects(service.handlers.saveVideoShots({id:d.id,shots:[{avatarId:'missing',duration:2}],signature}),/不存在/);
 const saved=await service.handlers.saveVideoShots({id:d.id,shots:[{avatarId:'a',duration:2.5}],signature});assert.equal(saved.video.assetId,'');assert.equal(saved.edit.resultId,'');assert.equal(saved.cover.assetId,'old-cover');assert.equal(saved.cover.videoId,'');assert.equal(saved.publish.recordId,'');assert.deepEqual(saved.video.shots,[{avatarId:'a',duration:2.5}]);
 const currentSignature=shotInputSignature(saved);service.store.data.runs.push({draftId:d.id,type:'avatar',status:'unknown'});await assert.rejects(service.handlers.saveVideoShots({id:d.id,shots:[{avatarId:'a',duration:5}],signature:currentSignature}),/远程结果待确认/);service.store.data.runs=[];fs.rmSync(asset.path);await assert.rejects(service.handlers.saveVideoShots({id:d.id,shots:[{avatarId:'a',duration:5}],signature:currentSignature}),/不存在|找不到|缺失/);assert.equal(service.store.draft().video.shots[0].duration,2.5);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
