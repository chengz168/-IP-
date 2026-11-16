const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createService}=require('../server/service.cjs');
// 本脚本仅复现服务边界，受控回包不是真实口型生成结果。
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-before-')),report={checkedAt:new Date().toISOString(),controlledProtocolFixture:true,realAvatarModelRequests:0};
 try{
  const service=createService(root),d=service.store.draft();service.store.data.settings.provider.avatarUrl='http://127.0.0.1:1/original';d.video.assetId='prior-video';service.store.save();
  let finish;service.providers.avatar=async()=>new Promise(r=>finish=r);
  const pending=service.handlers.avatar({id:d.id});service.store.data.settings.provider.avatarUrl='http://127.0.0.1:2/changed';finish({id:'old-service-output'});const result=await pending;
  report.changedService={stale:!!result.stale,boundVideoId:service.store.draft(d.id).video.assetId,inputRecorded:!!service.store.data.runs[0].parameters.input};
  assert.equal(report.changedService.stale,false);assert.equal(report.changedService.boundVideoId,'old-service-output');assert.equal(report.changedService.inputRecorded,false);
  const finishers=[];service.providers.avatar=async()=>new Promise(r=>finishers.push(r));const first=service.handlers.avatar({id:d.id}),second=service.handlers.avatar({id:d.id});report.duplicateSubmissions={providerCalls:finishers.length,concurrentAvatarRuns:service.store.data.runs.filter(r=>r.type==='avatar'&&r.status==='running').length};assert.equal(finishers.length,2);finishers[0]({id:'first-output'});finishers[1]({id:'second-output'});await Promise.all([first,second]);
  report.defectsReproduced=true;
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 const out=path.resolve('evidence/validation/avatar-boundaries');fs.mkdirSync(out,{recursive:true});const target=path.join(out,'before-report.json');assert(!fs.existsSync(target),'不覆盖既有复现证据');fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
