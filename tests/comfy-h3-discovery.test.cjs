const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ComfyH3,graphSignature}=require('../server/comfy-h3.cjs');
const {createService}=require('../server/service.cjs');
const {Store}=require('../server/store.cjs');
const graph={'6':{class_type:'Example',inputs:{b:2,a:1}}};

async function endpoint(t){
 let queue={queue_running:[],queue_pending:[]},history={};const calls=[];
 const server=http.createServer((req,res)=>{calls.push([req.method,req.url]);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/queue'?queue:history));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 return {baseUrl:'http://127.0.0.1:'+server.address().port,calls,set:(q,h)=>{queue=q;history=h;}};
}
const remote=baseUrl=>({kind:'comfy-h3-v1',baseUrl,statusUrl:baseUrl+'/history',clientId:'own-client',graph,graphSha256:graphSignature(graph),submissionState:'submitting',image:{name:'face.png'},audio:{name:'driver.wav'},duration:5,seed:42});
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'h3-discover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('本地任务查找同时验证唯一clientId与图内容，只读队列和历史，字段顺序不影响匹配',async t=>{
 const e=await endpoint(t),h3=new ComfyH3({},{}),r=remote(e.baseUrl);
 const row=[0,'own-prompt',{'6':{inputs:{a:1,b:2},class_type:'Example'}},{client_id:'own-client'}];
 e.set({queue_running:[row],queue_pending:[]},{'own-prompt':{prompt:row}});
 assert.equal(await h3.discover(r),'own-prompt');
 assert(e.calls.every(([method])=>method==='GET'));assert.deepEqual(e.calls.map(c=>c[1]),['/queue','/history?max_items=1000']);
});

test('查找无匹配、多项匹配、不同图或已变更的本地凭据均不得猜测或重交',async t=>{
 const e=await endpoint(t),h3=new ComfyH3({},{}),r=remote(e.baseUrl);
 await assert.rejects(h3.discover(r),/未找到/);
 e.set({queue_running:[[0,'one',graph,{client_id:'own-client'}]],queue_pending:[[1,'two',graph,{client_id:'own-client'}]]},{});
 await assert.rejects(h3.discover(r),/多个/);
 e.set({queue_running:[],queue_pending:[]},{wrong:{prompt:[0,'wrong',{different:1},{client_id:'own-client'}]}});
 await assert.rejects(h3.discover(r),/生成图.*不一致/);
 const before=e.calls.length;await assert.rejects(h3.discover({...r,graphSha256:'tampered'}),/指纹不一致/);assert.equal(e.calls.length,before);
 assert(e.calls.every(([method])=>method==='GET'));
});

test('程序退出时已保存提交凭据但没有ID，重开保持unknown并保留完整凭据',async t=>{
 const root=workspace(t),service=createService(root),draft=service.store.draft();
 await service.runtime.run('avatar',draft.id,{},async ctx=>{ctx.remote('',remote('http://127.0.0.1:8188'));return {};});
 const run=service.store.data.runs[0];run.status='running';service.store.save();
 const reopened=new Store(root),recovered=reopened.data.runs[0];
 assert.equal(recovered.remoteId,'');assert.equal(recovered.status,'unknown');assert.equal(recovered.remote.clientId,'own-client');assert.equal(recovered.remote.graphSha256,graphSignature(graph));
 assert.equal(recovered.remote.submissionState,'submitting');
});

test('同一ID的队列与历史出现不同生成图，不得用后到记录覆盖冲突',async t=>{
 const e=await endpoint(t),h3=new ComfyH3({},{}),r=remote(e.baseUrl);
 const correct=[0,'same-id',graph,{client_id:'own-client'}],wrong=[0,'same-id',{changed:true},{client_id:'own-client'}];
 e.set({queue_running:[wrong],queue_pending:[]},{'same-id':{prompt:correct}});
 await assert.rejects(h3.discover(r),/生成图.*不一致/);
 e.set({queue_running:[correct],queue_pending:[]},{'same-id':{prompt:wrong}});
 await assert.rejects(h3.discover(r),/生成图.*不一致/);
 assert(e.calls.every(([method])=>method==='GET'));
});

test('已保存无ID提交的普通取消和失联仍未知，明确拒绝可确认失败',async t=>{
 const service=createService(workspace(t)),draft=service.store.draft();
 for(const mode of ['cancel','disconnect','reject']){
  await assert.rejects(service.runtime.run('avatar',draft.id,{},async ctx=>{
   ctx.remote('',remote('http://127.0.0.1:8188'));
   if(mode==='cancel')service.runtime.cancel(service.store.data.runs[0].id);
   throw Object.assign(Error('提交阶段测试夹具'),mode==='reject'?{remoteConfirmed:true}:{});
  }));
  const run=service.store.data.runs[0];assert.equal(run.status,mode==='reject'?'failed':'unknown');
  if(mode==='cancel')assert.match(run.error,/不能直接重交/);
 }
});

test('没有ID时通过同一恢复接口先保存查回ID再查询，查询失败仍保留查回信息',async t=>{
 const root=workspace(t),service=createService(root),id=service.store.draft().id;
 await assert.rejects(service.runtime.run('avatar',id,{},async ctx=>{ctx.remote('',remote('http://127.0.0.1:8188'));throw Object.assign(Error('回包丢失'),{unknown:true});}),/回包/);
 const run=service.store.data.runs[0];let count=0;
 service.providers.comfyH3=()=>({discover:async()=>{count++;return 'found-id';},query:async found=>{assert.equal(found,'found-id');const saved=JSON.parse(fs.readFileSync(service.store.file,'utf8'));assert.equal(saved.runs[0].remoteId,'found-id');throw Error('查询临时失联');}});
 await assert.rejects(service.avatarRecovery.query({runId:run.id}),/临时失联/);
 assert.equal(count,1);assert.equal(run.status,'unknown');assert.equal(run.remoteId,'found-id');assert.equal(run.remoteChecks[0].status,'located');assert.equal(run.remoteChecks[1].status,'unknown');
 service.providers.comfyH3=()=>({query:async()=>({status:'running',jobId:'found-id'})});
 assert.equal((await service.avatarRecovery.query({runId:run.id})).status,'pending');assert.equal(count,1);
});

test('保存查回ID失败时回滚，不继续查询或下载，原待确认记录可再次处理',async t=>{
 const service=createService(workspace(t)),id=service.store.draft().id;
 await assert.rejects(service.runtime.run('avatar',id,{},async ctx=>{ctx.remote('',remote('http://127.0.0.1:8188'));throw Object.assign(Error('回包丢失'),{unknown:true});}));
 const run=service.store.data.runs[0];let queried=false;
 service.providers.comfyH3=()=>({discover:async()=> 'found-id',query:async()=>{queried=true;}});
 service.store.save=()=>{throw Error('保存失败测试夹具');};
 await assert.rejects(service.avatarRecovery.query({runId:run.id}),/保存失败/);
 assert.equal(run.remoteId,'');assert.equal(run.remote.submissionState,'submitting');assert.equal(queried,false);assert.equal(run.remoteChecks,undefined);
});
