const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const {Store,createDraft}=require('../server/store.cjs');
// 从当前界面源码提取实际函数，在受控保存失败/任务切换环境执行；不改用户工作区。
(async()=>{
 const root=path.resolve('evidence/validation/copy-confirmation');fs.mkdirSync(root,{recursive:true});const file=path.join(root,'before-report.json');assert(!fs.existsSync(file));const cases=[];
 for(const [name,source,fn]of [['new','src/views/Workflow.vue','confirmCopy'],['old','src/views/LegacyWorkflow.vue','useCopy']]){
  const line=fs.readFileSync(source,'utf8').split(/\r?\n/u).find(line=>line.startsWith('async function '+fn+'()'));assert(line);const body=line.slice(line.indexOf('{')+1,line.lastIndexOf('}')),execute=new (Object.getPrototypeOf(async function(){}).constructor)('d','save','startWorkflow','notify',body);
  const d={value:Object.assign(createDraft(),{sourceText:'旧原稿',rewrite:'核对过的稿件',finalText:'',confirmed:false,mode:'auto'})};let error='';try{await execute(d,async()=>{throw Error('受控写盘失败');},async()=>{},()=>{});}catch(e){error=e.message;}
  assert.equal(error,'受控写盘失败');assert.equal(d.value.confirmed,true);cases.push({view:name,case:'保存失败',error,confirmedAfterFailure:d.value.confirmed,finalTextAfterFailure:d.value.finalText});
  const first=Object.assign(createDraft(),{sourceText:'第一个任务',mode:'auto'}),second=Object.assign(createDraft(),{sourceText:'第二个任务',mode:'background'}),ref={value:first},started=[];
  await execute(ref,async()=>{ref.value=second;},async mode=>started.push({id:ref.value.id,mode}),()=>{});assert.equal(started[0].id,second.id);cases.push({view:name,case:'保存期间切换任务',originalTask:first.id,switchedTask:second.id,started});
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'copy-confirm-gap-'));try{const store=new Store(temp),d=store.draft();Object.assign(d,{sourceText:'原稿',rewrite:'已核对稿',finalText:'已核对稿',confirmed:true});store.save();const next=structuredClone(d);next.rewrite='尚未核对的新稿';store.updateDraft(next);assert.equal(store.draft().confirmed,true);cases.push({case:'服务端改写稿变化',confirmedAfterEdit:store.draft().confirmed,finalTextAfterEdit:store.draft().finalText});}finally{fs.rmSync(temp,{recursive:true,force:true});}
 fs.writeFileSync(file,JSON.stringify({checkedAt:new Date().toISOString(),scope:'当前生产函数与Store的隔离受控复现',cases,realModelRequests:0,userWorkspaceChanged:false},null,2));console.log(JSON.stringify({file,cases:cases.length,realModelRequests:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
