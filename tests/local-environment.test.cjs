const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {LocalEnvironment,validateEnvironmentSettings,endpoint}=require('../server/local-environment.cjs');

// 仅验证服务管理控制流：安装目录、网络响应和子进程均为隔离夹具，不调用本机模型。
function fixture(t,provider={},settings={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-environment-'));
 const comfyRoot=path.join(root,'ComfyUI'),comfyPython=path.join(comfyRoot,'.venv','Scripts','python.exe');
 fs.mkdirSync(path.dirname(comfyPython),{recursive:true});
 fs.writeFileSync(path.join(comfyRoot,'main.py'),'# 测试夹具，不可执行\n');
 fs.writeFileSync(comfyPython,'测试夹具，不可执行');
 const ollamaExecutable=path.join(root,'ollama.exe');fs.writeFileSync(ollamaExecutable,'测试夹具，不可执行');
 const store={root,data:{settings:{provider:{...provider},localEnvironment:{autoStart:true,comfyRoot,comfyPython,ollamaExecutable,...settings}},drafts:[{id:'protected',script:'原文'}],assets:[{id:'asset'}],runs:[]}};
 const managers=[];
 t.after(()=>{for(const manager of managers)manager.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,store,comfyRoot,comfyPython,ollamaExecutable,manager(options={}){const manager=new LocalEnvironment(store,{home:root,platform:'win32',env:{},startupTimeoutMs:3000,probeTimeoutMs:1000,sleep:()=>new Promise(resolve=>setTimeout(resolve,1)),...options});managers.push(manager);return manager;}};
}
function processMock(){const child=new EventEmitter();child.pid=process.pid;child.unref=()=>{};child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{throw Error('不能终止已有或共享服务');};return child;}
const comfyResponse=()=>new Response(JSON.stringify({system:{os:'win32'},devices:[]}),{status:200,headers:{'content-type':'application/json'}});
const ollamaResponse=()=>new Response(JSON.stringify({models:[]}),{status:200,headers:{'content-type':'application/json'}});
const offline=()=>Promise.reject(Object.assign(Error('连接未建立'),{cause:{code:'ECONNREFUSED'}}));

test('未选择本地协议时不探测、不启动、不修改业务数据',async t=>{
 const f=fixture(t,{textProtocol:'compatible',storyImageProtocol:'compatible',storyVideoProtocol:'compatible',avatarProtocol:'compatible'}),before=structuredClone(f.store.data);
 let calls=0;const manager=f.manager({fetch:async()=>{calls++;throw Error('不应探测');},spawn:()=>{throw Error('不应启动');}});
 const result=await manager.start();assert.equal(result.status,'idle');assert.equal(result.checking,false);assert.deepEqual(result.services,[]);assert.equal(calls,0);assert.deepEqual(f.store.data,before);
});

test('图视频形象及文本视觉同址服务去重，健康服务直接复用且state深拷贝',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy',storyVideoProtocol:'comfy-h3',avatarProtocol:'comfy-h3',textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434/v1',visionProtocol:'ollama',visionBaseUrl:'http://127.0.0.1:11434/api'}),before=structuredClone(f.store.data),calls=[];
 const manager=f.manager({fetch:async url=>{calls.push(url);return url.endsWith('/system_stats')?comfyResponse():ollamaResponse();},spawn:()=>{throw Error('已有服务不可再启动');}});
 const result=await manager.start();assert.equal(result.status,'ready');assert.equal(result.services.length,2);assert.deepEqual(calls.sort(),['http://127.0.0.1:11434/api/tags','http://127.0.0.1:8188/system_stats']);
 assert(result.services.every(row=>row.status==='ready'&&row.inferenceVerified===false));result.services[0].status='伪造';assert.equal(manager.state().services[0].status,'ready');assert.deepEqual(f.store.data,before);
});

test('自动启动关闭时仅探测并反馈不可用，生成前失败标记停止批量',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'},{autoStart:false});let probes=0;
 const manager=f.manager({fetch:()=>{probes++;return offline();},spawn:()=>{throw Error('关闭自动启动后不可拉起');}});
 const result=await manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,/自动启动已关闭/);
 await assert.rejects(manager.ensureComfy('http://127.0.0.1:8188'),error=>error.stopBatch===true&&error.environmentFailure===true);assert.equal(probes,2);
});

test('远端地址失败只报告，不使用本机程序尝试启动',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy',storyImageBaseUrl:'https://models.example.test/comfy'});
 const manager=f.manager({fetch:offline,spawn:()=>{throw Error('远端不可启动本机进程');}}),result=await manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,/远端服务无法连接/);
});

test('一个服务启动失败不妨碍其他服务就绪，启动检测不整批reject',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy',textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434/v1'});fs.unlinkSync(f.comfyPython);
 const manager=f.manager({fetch:async url=>url.endsWith('/api/tags')?ollamaResponse():offline(),spawn:()=>{throw Error('缺失程序不可启动');}}),result=await manager.start();
 assert.equal(result.status,'degraded');assert.equal(result.services.length,2);assert.equal(result.services.find(row=>row.id.startsWith('ollama:')).status,'ready');assert.equal(result.services.find(row=>row.id.startsWith('comfy:')).status,'failed');
});

test('HTTP错误、错误服务及非法JSON视为端口已有响应，不重复启动',async t=>{
 for(const response of [()=>new Response('unauthorized',{status:401}),()=>new Response(JSON.stringify({hello:'world'})),()=>new Response('invalid-json')]){
  const f=fixture(t,{storyImageProtocol:'comfy'});let launches=0;
  const manager=f.manager({fetch:async()=>response(),spawn:()=>{launches++;return processMock();}}),result=await manager.start();assert.equal(result.status,'degraded');assert.equal(launches,0);assert.match(result.services[0].message,/占用或响应超时/);
 }
});

test('拿到启动锁后端口才被其他程序占用，也必须停止而不能使用旧探测结果启动',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let probes=0,launches=0;
 const manager=f.manager({fetch:async()=>{probes++;return probes<3?offline():new Response('another server',{status:401});},spawn:()=>{launches++;return processMock();}});
 const result=await manager.start();assert.equal(result.status,'degraded');assert.equal(launches,0);assert.match(result.services[0].message,/未重复启动/);assert.match(result.services[0].message,/HTTP 401/);
});

test('现有Comfy安装只启动一次，并等待健康检查后才放行并发调用',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'}),calls=[];let ready=false,launches=0;
 const manager=f.manager({fetch:async()=>ready?comfyResponse():offline(),spawn:(file,args,options)=>{launches++;calls.push({file,args,options});return processMock();},sleep:async()=>{await new Promise(resolve=>setTimeout(resolve,1));ready=true;}});
 await Promise.all([manager.start(),manager.ensureComfy('http://127.0.0.1:8188'),manager.ensureComfy('http://127.0.0.1:8188')]);
 assert.equal(launches,1);assert.equal(manager.state().status,'ready');const launch=calls[0];assert.equal(launch.file,f.comfyPython);assert.equal(launch.options.cwd,f.comfyRoot);assert.equal(launch.options.windowsHide,true);assert.equal(launch.options.detached,false);assert.equal(launch.args[launch.args.indexOf('--port')+1],'8188');assert(launch.args.includes('--disable-auto-launch'));assert(launch.args.includes('--user-directory'));assert.equal(launch.options.env.PYTHONUTF8,'1');assert.equal(launch.options.env.USERNAME,os.userInfo().username);
});

test('两个工作台共享启动锁，不会为同一地址各起一个进程',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let ready=false,launches=0;const options={fetch:async()=>ready?comfyResponse():offline(),spawn:()=>{launches++;setTimeout(()=>{ready=true;},8);return processMock();}};
 const first=f.manager(options),second=f.manager(options);await Promise.all([first.start(),second.start()]);assert.equal(launches,1);assert.equal(first.state().status,'ready');assert.equal(second.state().status,'ready');assert(!fs.readdirSync(f.root,{recursive:true}).some(file=>String(file).endsWith('startup.lock')));
});

test('启动超时后重试等待原进程，不重复spawn且保留日志位置',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let launches=0;const manager=f.manager({fetch:offline,startupTimeoutMs:12,spawn:()=>{launches++;return processMock();}});
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(manager.ensureComfy('http://127.0.0.1:8188'),error=>error.stopBatch===true&&/等待超时/.test(error.message));
 assert.equal(launches,1);const row=manager.state().services[0];assert.equal(row.status,'failed');assert(fs.existsSync(row.logPath));assert(row.logPath.startsWith(f.root));
});

test('进程启动error和退出分别终结等待，启动批次返回degraded而不reject',async t=>{
 for(const event of ['error','exit']){
  const f=fixture(t,{storyImageProtocol:'comfy'});const manager=f.manager({fetch:offline,spawn:()=>{const child=processMock();queueMicrotask(()=>child.emit(event,event==='error'?Error('替身启动失败'):9));return child;}});
  const result=await manager.start();assert.equal(result.status,'degraded');assert.match(result.services[0].message,event==='error'?/替身启动失败/:/进程退出/);
 }
});

test('缺失安装入口或解释器提前失败，不启动或下载模型',async t=>{
 for(const name of ['main.py','python']){
  const f=fixture(t,{storyImageProtocol:'comfy'});fs.unlinkSync(name==='python'?f.comfyPython:path.join(f.comfyRoot,'main.py'));let launches=0;
  const manager=f.manager({fetch:offline,spawn:()=>{launches++;return processMock();}});await assert.rejects(manager.ensureComfy('http://127.0.0.1:8188'),/未找到可用的 ComfyUI/);assert.equal(launches,0);
 }
});

test('取消单个任务只取消它的等待，其他调用仍共用启动并成功',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let ready=false,launches=0;const controller=new AbortController();
 const manager=f.manager({fetch:async()=>ready?comfyResponse():offline(),spawn:()=>{launches++;return processMock();},sleep:async()=>{controller.abort(Error('任务主动停止'));await new Promise(resolve=>setTimeout(resolve,1));ready=true;}});
 const stopped=assert.rejects(manager.ensureComfy('http://127.0.0.1:8188',{signal:controller.signal}),/任务主动停止/),shared=manager.ensureComfy('http://127.0.0.1:8188');await Promise.all([stopped,shared]);assert.equal(launches,1);assert.equal(manager.state().status,'ready');assert.equal(manager.controller.signal.aborted,false);
});

test('关闭管理器停止等待但不kill进程，后续管理器复用原启动记录',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let launches=0,ready=false,first;
 first=f.manager({fetch:offline,spawn:()=>{launches++;return processMock();},sleep:async()=>{first.close();}});
 await assert.rejects(first.ensureComfy('http://127.0.0.1:8188'),/工作台已关闭/);
 const second=f.manager({fetch:async()=>ready?comfyResponse():offline(),spawn:()=>{launches++;return processMock();},sleep:async()=>{ready=true;}});await second.ensureComfy('http://127.0.0.1:8188');assert.equal(launches,1);
});

test('Ollama使用现有可执行文件serve且将配置地址写入子进程环境',async t=>{
 const f=fixture(t,{textProtocol:'ollama',baseUrl:'http://127.0.0.1:11434/v1'});let ready=false,launch;
 const manager=f.manager({fetch:async url=>{assert.equal(url,'http://127.0.0.1:11434/api/tags');return ready?ollamaResponse():offline();},spawn:(file,args,options)=>{launch={file,args,options};return processMock();},sleep:async()=>{ready=true;}});await manager.start();assert.equal(manager.state().status,'ready');assert.equal(launch.file,f.ollamaExecutable);assert.deepEqual(launch.args,['serve']);assert.equal(launch.options.env.OLLAMA_HOST,'http://127.0.0.1:11434');
});

test('本地按需语音环境只预检文件，不提前加载模型或启动常驻服务',async t=>{
 const f=fixture(t,{asrProtocol:'local-whisper'});f.store.data.settings.provider.asrPythonPath=f.comfyPython;f.store.data.settings.provider.asrModelPath=f.comfyRoot;
 const manager=f.manager({fetch:()=>{throw Error('按需服务不应探测HTTP');},spawn:()=>{throw Error('按需服务不应提前启动');}}),result=await manager.start();assert.equal(result.status,'ready');assert.equal(result.services[0].status,'on-demand');assert.equal(result.services[0].inferenceVerified,false);
 fs.unlinkSync(f.comfyPython);assert.equal(manager.state().status,'degraded');assert.match(manager.state().services[0].message,/解释器或模型路径缺失/);
});

test('尚未启用管理器时不探测，预先取消的任务不触发共享启动',async t=>{
 const f=fixture(t,{storyImageProtocol:'comfy'});let probes=0;const manager=f.manager({enabled:false,fetch:async()=>{probes++;return comfyResponse();},spawn:()=>{throw Error('禁止启动');}});
 assert.equal((await manager.start()).enabled,false);assert.equal(probes,0);const controller=new AbortController();controller.abort(Error('预先取消'));
 await assert.rejects(manager.ensureComfy('http://127.0.0.1:8188',{signal:controller.signal}),/预先取消/);assert.equal(probes,0);
});

test('地址校验拒绝凭据与查询片段，Ollama仅移除约定API后缀',()=>{
 for(const url of ['file:///tmp/service','http://user:secret@127.0.0.1:8188','http://localhost:8188/?token=x','http://localhost:8188/#fragment'])assert.throws(()=>endpoint('comfy',url));
 assert.equal(endpoint('ollama','http://localhost:11434/v1/').baseUrl,'http://localhost:11434');assert.equal(endpoint('ollama','http://localhost:11434/prefix/v1').baseUrl,'http://localhost:11434/prefix');assert.equal(endpoint('comfy','http://127.0.0.1:8188').local,true);assert.equal(endpoint('comfy','https://localhost:8188').local,false);
});

test('设置白名单与绝对路径校验，规范化不改原对象',()=>{
 const absolute=path.join(os.tmpdir(),' existing runtime '),source={autoStart:false,comfyRoot:' '+absolute+' '},result=validateEnvironmentSettings(source);assert.equal(result.autoStart,false);assert.equal(result.comfyRoot,absolute.trim());assert.equal(source.comfyRoot,' '+absolute+' ');assert.equal(result.comfyPython,'');
 for(const value of [null,[],{autoStart:'true'},{comfyRoot:'relative/path'},{comfyPython:'bad\0path'},{ollamaExecutable:1},{downloadModels:true},{comfyRoot:'a'.repeat(2001)}])assert.throws(()=>validateEnvironmentSettings(value));
});
