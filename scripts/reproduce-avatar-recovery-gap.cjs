const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
// 受控返回既有协议字段，只复现地址持久化缺失；不发网络请求、不调用模型。
(async()=>{
 const root=path.resolve('evidence/validation/avatar-recovery');fs.mkdirSync(root,{recursive:true});const work=path.join(root,'before-workspace');assert(!fs.existsSync(work));const s=createService(work),d=s.store.draft();
 const video=s.store.addAsset(path.resolve('evidence/validation/caption-entry/五张原图与既有音轨_无旧字幕源.mp4')),audio=s.store.addAsset(path.resolve('evidence/validation/legacy-voice/系统朗读验收样本.wav'));
 s.store.data.avatars=[{id:'fixture-shape',name:'既有视频协议夹具',assetId:video.id}];s.store.data.settings.provider.avatarUrl='http://127.0.0.1:1/avatar';Object.assign(d.video,{avatarId:'fixture-shape',audioId:audio.id});s.store.save();
 let posts=0;s.providers.request=async()=>{posts++;return {json:async()=>({jobId:'controlled-recovery-before',status:'running',statusUrl:'http://127.0.0.1:1/status'})};};
 const pending=s.handlers.avatar({id:d.id});await new Promise(resolve=>setImmediate(resolve));const run=s.store.data.runs[0];assert.equal(run.remoteId,'controlled-recovery-before');s.runtime.cancel(run.id);await assert.rejects(pending);
 const saved=JSON.parse(fs.readFileSync(s.store.file,'utf8')).runs[0],result={checkedAt:new Date().toISOString(),controlledProtocolFixture:true,newModelRequests:0,networkRequests:0,simulatedSubmissions:posts,remoteId:saved.remoteId,status:saved.status,queryAddressPersisted:!!saved.remote?.statusUrl,queryActionExists:typeof s.handlers.queryAvatarResult==='function',queryFields:JSON.stringify(saved).includes('http://127.0.0.1:1/status')};assert.equal(result.status,'unknown');assert.equal(result.queryAddressPersisted,false);assert.equal(result.queryActionExists,false);assert.equal(result.queryFields,false);
 fs.writeFileSync(path.join(root,'before-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
