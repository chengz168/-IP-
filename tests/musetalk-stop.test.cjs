const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {runWorker}=require('../server/local-musetalk.cjs');
const {Runtime}=require('../server/runtime.cjs');

const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};

test('默认停止不等协作检查点，Windows 同时终止真实子孙进程且保留退出回执',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'musetalk-stop-')),script=path.join(root,'worker.cjs'),pidFile=path.join(root,'pids.json');let pids=[];
 t.after(()=>{for(const pid of pids)if(alive(pid)){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});else process.kill(pid,'SIGKILL');}fs.rmSync(root,{recursive:true,force:true});});
 // 真实 Node 工作器故意不读取消标记，模拟模型加载中无法到达协作检查点。
 fs.writeFileSync(script,`const fs=require('node:fs'),{spawn}=require('node:child_process');
const pids=[process.pid];
if(process.platform==='win32'){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});pids.push(child.pid);}
fs.writeFileSync(process.argv[2],JSON.stringify(pids));
console.log(JSON.stringify({stage:'ready'}));setInterval(()=>{},1000);`);
 const controller=new AbortController();let ready;
 const started=new Promise(resolve=>{ready=resolve;}),pending=runWorker({python:process.execPath,args:[script,pidFile],directory:root,signal:controller.signal,onEvent:event=>{if(event.stage==='ready')ready();}});
 const rejected=assert.rejects(pending,/已取消/);
 await started;pids=JSON.parse(fs.readFileSync(pidFile,'utf8'));assert(pids.every(alive));
 const at=performance.now();controller.abort();await rejected;const elapsed=performance.now()-at;
 assert(elapsed<5000,`取消耗时 ${elapsed}ms，不应等待原20秒宽限期`);
 assert(pids.every(pid=>!alive(pid)),'退出确认后不能残留本次子进程');
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'stop-receipt.json'),'utf8'));
 assert.equal(receipt.pid,pids[0]);assert.equal(receipt.workerExited,true);assert.equal(receipt.videoRegistered,false);assert.ok(receipt.requestedAt);assert.ok(receipt.closedAt);
 if(process.platform==='win32')assert.equal(receipt.terminationMethod,'taskkill-tree');
 t.diagnostic(JSON.stringify({elapsedMs:elapsed,processCount:pids.length,method:receipt.terminationMethod}));
});

test('工作器正常结束不产生取消回执；预先取消不启动工作器',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'musetalk-finish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 await runWorker({python:process.execPath,args:['-e','process.exit(0)'],directory:root});assert(!fs.existsSync(path.join(root,'stop-receipt.json')));
 const controller=new AbortController();controller.abort();assert.throws(()=>runWorker({python:process.execPath,args:[],directory:root,signal:controller.signal}),/abort/i);
});

test('取消请求可持久化且重复停止幂等，迟到进度和结果不能覆盖停止状态',async()=>{
 const store={data:{runs:[]},draft:()=>({}),save(){}},runtime=new Runtime(store);let context,finish;
 const pending=runtime.run('avatar','draft',{},ctx=>{context=ctx;ctx.progress(8,'加载中');return new Promise(resolve=>{finish=resolve;});});
 const run=store.data.runs[0],rejected=assert.rejects(pending,/取消/);runtime.cancel(run.id);const requestedAt=run.cancelRequestedAt;assert.ok(requestedAt);assert.equal(run.status,'running');
 runtime.cancel(run.id);assert.equal(run.cancelRequestedAt,requestedAt);context.progress(90,'迟到进度');context.activity({stage:'inferred'});assert.equal(run.progress,8);assert.equal(run.activity,null);
 finish({id:'迟到结果'});await rejected;assert.equal(run.status,'cancelled');assert.equal(run.output,undefined);assert.equal(runtime.controllers.size,0);
});

test('写入停止请求失败也必须发出取消信号',async()=>{
 let fails=false,context,finish;const store={data:{runs:[]},draft:()=>({}),save(){if(fails)throw Error('写盘失败');}},runtime=new Runtime(store);
 const pending=runtime.run('avatar','draft',{},ctx=>{context=ctx;return new Promise(resolve=>{finish=resolve;});}),run=store.data.runs[0],rejected=assert.rejects(pending,/取消/);
 fails=true;assert.throws(()=>runtime.cancel(run.id),/写盘失败/);assert.equal(context.signal.aborted,true);fails=false;finish();await rejected;assert.equal(run.status,'cancelled');
});
