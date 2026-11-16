const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Providers}=require('../server/providers.cjs');
const {textTimeoutSeconds,generationConfig}=require('../server/prompt-catalog.mjs');
const {createService}=require('../server/service.cjs');

function provider(config={}){return new Providers({data:{settings:{provider:{baseUrl:'http://127.0.0.1:1',model:'测试夹具',...config}}}},null,{get:async()=>''});}
async function localServer(t,handler){const timers=new Set(),sockets=new Set();const server=http.createServer((request,response)=>handler(request,response,(callback,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},ms);timers.add(timer);request.on('close',()=>{clearTimeout(timer);timers.delete(timer);});}));server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const timer of timers)clearTimeout(timer);for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});return 'http://127.0.0.1:'+server.address().port;}
const json={message:{content:'本地HTTP夹具返回，不是模型生成'},done_reason:'stop',choices:[{message:{content:'本地HTTP夹具返回，不是模型生成'},finish_reason:'stop'}]};

test('文本等待默认按来源选择，有效整数覆盖，非法配置拒绝',()=>{
 assert.equal(textTimeoutSeconds(),180);assert.equal(textTimeoutSeconds({textProtocol:'ollama'}),600);assert.equal(textTimeoutSeconds({textProtocol:'ollama',textTimeoutSeconds:' '}),600);
 for(const value of [30,'30',1800,'1800',' 900 '])assert.equal(textTimeoutSeconds({textTimeoutSeconds:value}),Number(value));
 for(const value of [0,29,1801,-1,30.5,'30.5','3e2',null,true,[],{},NaN,Infinity])assert.throws(()=>textTimeoutSeconds({textTimeoutSeconds:value}),/30至1800/);
});

test('文本配置快照保存有效等待值且后续配置改变能够区分',()=>{
 const data={settings:{provider:{textProtocol:'ollama'}}},first=generationConfig(data);assert.equal(first.textTimeoutSeconds,600);
 data.settings.provider.textTimeoutSeconds='900';assert.equal(first.textTimeoutSeconds,600);assert.equal(generationConfig(data).textTimeoutSeconds,900);
 data.settings.provider.textTimeoutSeconds='';data.settings.provider.textProtocol='compatible';assert.equal(generationConfig(data).textTimeoutSeconds,180);
});

test('设置保存允许秒数和清空，非法值不写盘也不写密钥',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'text-timeout-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let keyWrites=0;const service=createService(directory,{get:async()=>'',set:async()=>{keyWrites++;}});
 for(const value of [30,'1800','']){await service.invoke('saveSettings',{outputDir:'',provider:{textTimeoutSeconds:value}});assert.equal(service.store.data.settings.provider.textTimeoutSeconds,String(value));assert.equal(JSON.parse(fs.readFileSync(service.store.file,'utf8')).settings.provider.textTimeoutSeconds,String(value));}
 for(const value of [29,1801,30.5,'oops',null,true]){const before=fs.readFileSync(service.store.file),beforeMemory=JSON.stringify(service.store.data.settings);await assert.rejects(service.invoke('saveSettings',{key:'不能写入的夹具密钥',outputDir:'被拒绝的变化',provider:{textTimeoutSeconds:value}}),/30至1800/);assert.deepEqual(fs.readFileSync(service.store.file),before);assert.equal(JSON.stringify(service.store.data.settings),beforeMemory);}
 assert.equal(keyWrites,0);
});

test('真实本地HTTP文本请求使用对应等待值并保留证据，其他能力仍180秒',async t=>{
 const base=await localServer(t,(_,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(json));}),deadlines=[],original=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return original.call(AbortSignal,ms);});
 for(const [protocol,configured,expected] of [['ollama',undefined,600000],['compatible',undefined,180000],['ollama','30',30000],['compatible','900',900000]]){
  const p=provider({baseUrl:base,textProtocol:protocol,...(configured===undefined?{}:{textTimeoutSeconds:configured})}),result=await p.text('系统夹具','正文夹具',{});assert.equal(result.request.transportTimeoutMs,expected);assert.equal(deadlines.at(-1),expected);assert.equal(result.text,json.message.content);
 }
 const p=provider({baseUrl:base,textProtocol:'ollama',textTimeoutSeconds:'1800',visionProtocol:'compatible',visionModel:'本地HTTP视觉夹具'});await p.vision('夹具','夹具',['aW1hZ2U='],{});assert.equal(deadlines.at(-1),180000);await p.bridge(base,{},{});assert.equal(deadlines.at(-1),180000);
});

test('request第四参真实短期限中断延迟HTTP，不放宽用户文本秒数下限',async t=>{
 const base=await localServer(t,(_,response,later)=>later(()=>response.end('{}'),800));const p=provider(),started=Date.now();await assert.rejects(p.request(base,{}, {},50),/模型服务请求超时/);assert(Date.now()-started<1500);assert.throws(()=>textTimeoutSeconds({textTimeoutSeconds:.05}),/30至1800/);
});

test('真实HTTP自定义Error和字符串停止原因均立即识别为停止',async t=>{
 for(const reason of [new Error('用户自定义取消'), '用户自定义字符串取消']){
  let reached;const ready=new Promise(resolve=>reached=resolve),base=await localServer(t,(_,response,later)=>{reached();later(()=>response.end('{}'),1500);}),controller=new AbortController(),pending=provider().request(base,{}, {signal:controller.signal},5000);await ready;const stopped=Date.now();controller.abort(reason);await assert.rejects(pending,/请求已停止/);assert(Date.now()-stopped<1000);
 }
 const controller=new AbortController();controller.abort(new Error('请求前停止'));await assert.rejects(provider().request('http://127.0.0.1:1',{}, {signal:controller.signal},5000),/请求已停止/);
});

test('文本HTTP已返回头但正文未结束时仍能停止，自定义reason不误报网络错误',async t=>{
 let reached;const ready=new Promise(resolve=>reached=resolve),base=await localServer(t,(_,response,later)=>{response.setHeader('Content-Type','application/json');response.write('{"message":');reached();later(()=>response.end('{"content":"迟到正文"}}'),1500);}),controller=new AbortController(),p=provider({baseUrl:base,textProtocol:'ollama',textTimeoutSeconds:'30'}),pending=p.text('夹具','夹具',{signal:controller.signal});await ready;controller.abort(new Error('正文读取期间停止'));await assert.rejects(pending,/请求已停止/);
});
