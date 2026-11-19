const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {LocalEnvironment}=require('../server/local-environment.cjs');
const baseUrl='http://127.0.0.1:8188';
const good=()=>new Response(JSON.stringify({system:{os:'win32'},devices:[]}));
const offline=async()=>{throw Error('隔离测试：连接未建立');};
const identity={pid:424242,executable:'D:/isolated/python.exe',createdAt:'2026-11-19T01:00:00.0000000Z'};
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-environment-recovery-')),comfyRoot=path.join(root,'comfy'),comfyPython=path.join(root,'python.exe');
 fs.mkdirSync(comfyRoot);fs.writeFileSync(path.join(comfyRoot,'main.py'),'# 隔离夹具');fs.writeFileSync(comfyPython,'隔离夹具');
 const directory=path.join(root,crypto.createHash('sha256').update('comfy:'+baseUrl).digest('hex').slice(0,24));fs.mkdirSync(directory);
 const lock=path.join(directory,'startup.lock'),record=path.join(directory,'process.json');
 let ready=false,launches=0;
 // 成功路径给文件系统与并发测试调度留出预算；预期超时的分支单独使用可控时间。
 const manager=new LocalEnvironment({data:{settings:{provider:{storyImageProtocol:'comfy'},localEnvironment:{autoStart:true,comfyRoot,comfyPython}}}},{home:root,startupTimeoutMs:5000,probeTimeoutMs:1000,lockStaleMs:0,lockRecoveryCheckMs:0,fetch:async()=>ready?good():offline(),inspectProcess:async pid=>pid===identity.pid?{...identity}:null,sleep:()=>new Promise(resolve=>setTimeout(resolve,1)),spawn:()=>{launches++;const child=new EventEmitter();child.pid=identity.pid;child.unref=()=>{};ready=true;return child;},...options});
 t.after(()=>{manager.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,lock,record,manager,get launches(){return launches;},setReady(){ready=true;}};
}

test('旧空锁及截断 JSON 在静置且文件身份未变时可恢复，不启动真实进程',async t=>{
 for(const text of ['', '{"pid":']){
  const f=fixture(t);fs.writeFileSync(f.lock,text);fs.utimesSync(f.lock,new Date(0),new Date(0));
  const result=await f.manager.start();assert.equal(result.status,'ready',result.services.map(row=>row.message).join('；'));assert.equal(f.launches,1);assert.equal(fs.existsSync(f.lock),false);
 }
});

test('仍在静置期的损坏锁保持不动，避免删除正在写入的新锁',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const f=fixture(t,{lockStaleMs:60000,startupTimeoutMs:12,sleep:async()=>{now+=20;}});fs.writeFileSync(f.lock,'');
 assert.equal((await f.manager.start()).status,'degraded');assert.equal(f.launches,0);assert.equal(fs.readFileSync(f.lock,'utf8'),'');
});

test('恢复检查期间锁被替换时保留新 token，不误删新的锁',async t=>{
 let f,replaced=false,now=Date.now();t.mock.method(Date,'now',()=>now);
 const replacement={pid:identity.pid,token:'new-owner',identity};
 f=fixture(t,{startupTimeoutMs:15,sleep:async()=>{if(!replaced){replaced=true;fs.writeFileSync(f.lock,JSON.stringify(replacement));}now+=20;}});
 fs.writeFileSync(f.lock,'');fs.utimesSync(f.lock,new Date(0),new Date(0));
 assert.equal((await f.manager.start()).status,'degraded');assert.equal(f.launches,0);assert.deepEqual(JSON.parse(fs.readFileSync(f.lock,'utf8')),replacement);
});

test('候选锁写入失败后清理部分文件，重试仍可正常启动',async t=>{
 const f=fixture(t),original=fs.writeFileSync;let rejected=false;
 t.mock.method(fs,'writeFileSync',function(file,...args){if(!rejected&&String(file).startsWith(f.lock+'.')){rejected=true;original.call(fs,file,'部分内容');throw Object.assign(Error('隔离写入失败'),{code:'ENOSPC'});}return original.call(fs,file,...args);});
 assert.equal((await f.manager.start()).status,'degraded');assert.equal(f.launches,0);assert.equal(fs.existsSync(f.lock),false);assert.equal(fs.readdirSync(path.dirname(f.lock)).some(name=>name.endsWith('.tmp')),false);
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,1);
});

test('新锁携带唯一 token 与身份，释放时不删除被替换的锁',async t=>{
 let f,captured;
 const replacement={pid:identity.pid,token:'replacement',identity};
 f=fixture(t,{spawn:()=>{captured=JSON.parse(fs.readFileSync(f.lock,'utf8'));fs.writeFileSync(f.lock,JSON.stringify(replacement));f.setReady();const child=new EventEmitter();child.pid=identity.pid;child.unref=()=>{};return child;}});
 assert.equal((await f.manager.start()).status,'ready');assert.match(captured.token,/^[0-9a-f-]{36}$/);assert.equal(captured.identity.pid,process.pid);assert(captured.identity.createdAt);assert(captured.identity.executable);
 assert.deepEqual(JSON.parse(fs.readFileSync(f.lock,'utf8')),replacement);
});

test('旧启动锁 PID 已被复用时回收旧锁，不等待无关进程',async t=>{
 const f=fixture(t);fs.writeFileSync(f.lock,JSON.stringify({pid:identity.pid,token:'old',identity:{...identity,createdAt:'old-process'}}));
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,1);
});

test('服务记录 PID 被复用时核对创建时间并启动一次，保留无关进程',async t=>{
 const f=fixture(t);fs.writeFileSync(f.record,JSON.stringify({pid:identity.pid,executable:identity.executable,identity:{...identity,createdAt:'old-process'}}));
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,1);assert.deepEqual(JSON.parse(fs.readFileSync(f.record,'utf8')).identity,identity);
});

test('服务记录 executable 不一致时不会把同 PID 认作同一服务',async t=>{
 const f=fixture(t);fs.writeFileSync(f.record,JSON.stringify({pid:identity.pid,identity:{...identity,executable:'D:/different/worker.exe'}}));
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,1);
});

test('合法存活的原服务继续等待就绪，不重复启动',async t=>{
 let f;f=fixture(t,{sleep:async()=>{f.setReady();}});fs.writeFileSync(f.record,JSON.stringify({pid:identity.pid,executable:identity.executable,identity}));
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,0);
});

test('活进程身份无法查询时明确失败并可重试，不猜测、不启动第二个服务',async t=>{
 let fail=true;const f=fixture(t,{inspectProcess:async pid=>{if(fail)throw Error('无法读取本地进程身份：隔离权限错误');return pid===identity.pid?identity:null;}});
 fs.writeFileSync(f.record,JSON.stringify({pid:identity.pid,executable:identity.executable,identity}));
 const result=await f.manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,/无法读取本地进程身份/);assert.equal(f.launches,0);assert.equal(fs.existsSync(f.lock),false);
 fail=false;f.setReady();assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,0);
});

test('旧记录缺少出生身份且 PID 存活时明确指出恢复条件',async t=>{
 const f=fixture(t);fs.writeFileSync(f.record,JSON.stringify({pid:identity.pid,executable:identity.executable}));
 const result=await f.manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,/缺少可验证的进程身份/);assert.equal(f.launches,0);
});

test('损坏或缺失 PID 的进程记录明确拒绝重复启动，保留原记录供恢复',async t=>{
 for(const text of ['','{"pid":','null','{}']){
  const f=fixture(t);fs.writeFileSync(f.record,text);
  const result=await f.manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,/此前启动记录损坏/);assert.equal(f.launches,0);assert.equal(fs.readFileSync(f.record,'utf8'),text);
 }
});

test('进程记录两次更新均通过完整候选文件原子替换',async t=>{
 const f=fixture(t),originalWrite=fs.writeFileSync,originalRename=fs.renameSync,snapshots=[];
 t.mock.method(fs,'writeFileSync',function(file,...args){assert.notEqual(file,f.record,'不直接截断最终进程记录');return originalWrite.call(fs,file,...args);});
 t.mock.method(fs,'renameSync',function(from,to){if(to===f.record)snapshots.push(JSON.parse(fs.readFileSync(from,'utf8')));return originalRename.call(fs,from,to);});
 assert.equal((await f.manager.start()).status,'ready');assert.equal(snapshots.length,2);assert.equal(snapshots[0].identity,null);assert.deepEqual(snapshots[1].identity,identity);assert.equal(fs.readdirSync(path.dirname(f.record)).some(name=>name.endsWith('.tmp')),false);
});

test('身份记录更新写失败后保留第一份完整记录，不留下截断结果',async t=>{
 const f=fixture(t),original=fs.writeFileSync;let writes=0;
 t.mock.method(fs,'writeFileSync',function(file,...args){if(String(file).startsWith(f.record+'.')&&++writes===2){original.call(fs,file,'部分内容');throw Object.assign(Error('隔离进程记录写入失败'),{code:'ENOSPC'});}return original.call(fs,file,...args);});
 assert.equal((await f.manager.start()).status,'degraded');assert.equal(f.launches,1);const record=JSON.parse(fs.readFileSync(f.record,'utf8'));assert.equal(record.pid,identity.pid);assert.equal(record.identity,null);assert.equal(fs.readdirSync(path.dirname(f.record)).some(name=>name.endsWith('.tmp')),false);
 assert.equal((await f.manager.start()).status,'ready');assert.equal(f.launches,1);
});
