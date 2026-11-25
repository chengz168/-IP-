const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createService}=require('./support/licensed-service.cjs');
function serviceFixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-discovery-')),listeners=new Set(process.listeners('exit'));let secret='saved-test-credential',reads=0,writes=0;const service=createService(root,{get:async()=>{reads++;return secret;},set:async value=>{writes++;secret=value;}});t.after(()=>{for(const listener of process.listeners('exit'))if(!listeners.has(listener))process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});return {service,root,counts:()=>({reads,writes})};}
async function fixtureServer(t,handler){const requests=[],server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requests.push({method:req.method,url:req.url,hasAuthorization:!!req.headers.authorization});try{await handler(req,res,body);}catch{res.writeHead(500);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});return {base:'http://127.0.0.1:'+server.address().port,requests};}
const json=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const request=(capability,provider,extra={})=>({requestId:'discovery-'+Math.random().toString(36).slice(2),capability,provider,...extra});

test('云端草稿只读发现支持未知能力、自定义当前值、去重和独立端点，不保存不新增run',async t=>{
 const {service,counts}=serviceFixture(t),server=await fixtureServer(t,(req,res)=>json(res,{data:[{id:'cloud-custom'},{id:'cloud-custom'},{id:'named-vision-but-no-evidence'},{id:'declared',capabilities:{vision:true,text:false}}]}));
 const before=structuredClone(service.store.data),disk=fs.readFileSync(service.store.file),draft={...service.providers.config(),baseUrl:'http://127.0.0.1:1/v1',ttsBaseUrl:server.base+'/v1',ttsModel:'manual-not-listed'};
 const result=await service.invoke('discoverModels',request('tts',draft));assert.equal(result.status,'ready');assert.equal(result.models.length,3);assert.equal(result.models[0].capabilities.tts,'unknown');assert.equal(result.models[1].capabilities.vision,'unknown');assert.equal(result.models[2].capabilities.vision,'supported');assert.equal(result.models[2].capabilities.text,'unsupported');assert.equal(result.generationVerified,false);assert.equal(result.models[0].generationVerified,false);assert.deepEqual(server.requests,[{method:'GET',url:'/v1/models',hasAuthorization:true}]);assert.equal(draft.ttsModel,'manual-not-listed');assert.deepEqual(service.store.data,before);assert.deepEqual(fs.readFileSync(service.store.file),disk);assert.equal(counts().writes,0);assert.equal(JSON.stringify(result).includes('saved-test-credential'),false);
});

test('Ollama仅tags和show查声明，不读或发送云密钥，不按名字猜视觉能力',async t=>{
 const {service,counts}=serviceFixture(t),server=await fixtureServer(t,(req,res,body)=>{if(req.url==='/api/tags')return json(res,{models:[{name:'text-model'},{name:'vision-looking-name'},{name:'actual-multimodal'},{name:'no-details'}]});assert.equal(req.method,'POST');assert.equal(req.url,'/api/show');const id=JSON.parse(body).model;if(id==='no-details'){res.writeHead(404);return res.end();}return json(res,{capabilities:id==='actual-multimodal'?['completion','vision']:['completion']});});
 const result=await service.invoke('discoverModels',request('vision',{visionProtocol:'ollama',visionBaseUrl:server.base+'/v1'},{changeKey:true,key:'temporary-test-credential'}));assert.equal(result.status,'ready');assert.equal(result.models.find(m=>m.id==='vision-looking-name').capabilities.vision,'unsupported');assert.equal(result.models.find(m=>m.id==='actual-multimodal').capabilities.vision,'supported');assert.equal(result.models.find(m=>m.id==='no-details').capabilities.vision,'unknown');assert(server.requests.every(r=>!r.hasAuthorization));assert.deepEqual(counts(),{reads:0,writes:0});assert.equal(server.requests.length,5);assert(server.requests.every(r=>r.url==='/api/tags'||r.url==='/api/show'));
});

test('临时密钥仅勾选更新时用于本次查询，空值清除本次鉴权但不清除安全存储',async t=>{
 const {service,counts}=serviceFixture(t);const server=await fixtureServer(t,(req,res)=>{const value=req.headers.authorization;const id=value==='Bearer one-time-test'?'temporary':value==='Bearer saved-test-credential'?'saved':'none';json(res,{data:[{id}]});});
 const provider={baseUrl:server.base,textProtocol:'compatible'};
 assert.equal((await service.invoke('discoverModels',request('text',provider,{key:'ignored',changeKey:false}))).models[0].id,'saved');
 assert.equal((await service.invoke('discoverModels',request('text',provider,{key:'one-time-test',changeKey:true}))).models[0].id,'temporary');
 assert.equal((await service.invoke('discoverModels',request('text',provider,{key:'',changeKey:true}))).models[0].id,'none');assert.deepEqual(counts(),{reads:1,writes:0});
});

test('空列表是空态，HTTP错误、非JSON和错误结构有稳定中文错误',async t=>{
 const {service}=serviceFixture(t),server=await fixtureServer(t,(req,res)=>{if(req.url==='/empty/models')return json(res,{data:[]});if(req.url==='/bad-json/models')return res.end('<html>bad</html>');if(req.url==='/bad-schema/models')return json(res,{models:[]});if(req.url==='/bad-id/models')return json(res,{data:[{id:''}]});const status=Number(req.url.split('/')[1]);res.writeHead(status);res.end('不返回到UI的服务正文');});
 const invoke=route=>service.invoke('discoverModels',request('text',{baseUrl:server.base+'/'+route,textProtocol:'compatible'}));const empty=await invoke('empty');assert.equal(empty.status,'empty');assert.equal(empty.error,null);
 for(const status of [401,403,404,429,500]){const result=await invoke(String(status));assert.equal(result.error.code,'DISCOVERY_HTTP_ERROR');assert.equal(result.error.httpStatus,status);assert.deepEqual(result.models,[]);}
 assert.equal((await invoke('bad-json')).error.code,'DISCOVERY_INVALID_JSON');assert.equal((await invoke('bad-schema')).error.code,'DISCOVERY_INVALID_RESPONSE');assert.equal((await invoke('bad-id')).error.code,'DISCOVERY_INVALID_RESPONSE');
});

test('双提交同ID拒绝，取消只终止本次发现，超时可重试且无持久化副作用',async t=>{
 const {service}=serviceFixture(t);let started;const ready=new Promise(resolve=>started=resolve),server=await fixtureServer(t,(req,res)=>{if(req.url==='/fast/models')return json(res,{data:[]});started();});const before=structuredClone(service.store.data),input=request('text',{baseUrl:server.base+'/slow',textProtocol:'compatible'});
 const pending=service.invoke('discoverModels',input);await ready;assert.equal((await service.invoke('discoverModels',input)).error.code,'DISCOVERY_BUSY');assert.deepEqual(await service.invoke('cancelModelDiscovery',{requestId:'other'}),{cancelled:false});assert.deepEqual(await service.invoke('cancelModelDiscovery',{requestId:input.requestId}),{cancelled:true});const cancelled=await pending;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.error.code,'DISCOVERY_CANCELLED');assert.equal((await service.invoke('discoverModels',{...input,provider:{baseUrl:server.base+'/fast'},timeoutMs:1000})).status,'empty');
 const timeout=await service.invoke('discoverModels',{...input,timeoutMs:1000});assert.equal(timeout.error.code,'DISCOVERY_TIMEOUT');assert.deepEqual(service.store.data,before);
});

test('ASR已有目录仅做文件预检，缺文件和相对路径不冒充模型可用',async t=>{
 const {service,root}=serviceFixture(t),home=path.join(root,'whisper'),python=path.join(root,'python.exe');fs.mkdirSync(home);fs.writeFileSync(python,'解释器文件夹具，不执行');const provider={asrProtocol:'local-whisper',asrModelPath:home,asrPythonPath:python};
 let result=await service.invoke('discoverModels',request('asr',provider));assert.equal(result.status,'unavailable');assert.equal(result.environment.status,'path-only');assert.equal(result.models[0].availability,'path-only');
 for(const name of ['model.bin','config.json','tokenizer.json'])fs.writeFileSync(path.join(home,name),'文件齐备夹具，不是模型');result=await service.invoke('discoverModels',request('asr',provider));assert.equal(result.status,'ready');assert.equal(result.environment.status,'files-present');assert.equal(result.environment.runtimeStatus,'not-detected');assert.equal(result.models[0].generationVerified,false);
 assert.equal((await service.invoke('discoverModels',request('asr',{...provider,asrModelPath:'relative'}))).error.code,'DISCOVERY_INVALID_INPUT');assert.equal((await service.invoke('discoverModels',request('tts',{ttsProtocol:'indextts-local',indexttsHome:''}))).environment.status,'unconfigured');
});

test('未勾临时key时恶意服务回显安全凭据被隐藏，地址凭据/无效超时/未知协议拒绝',async t=>{
 const {service}=serviceFixture(t),server=await fixtureServer(t,(req,res)=>json(res,{data:[{id:req.headers.authorization}]}));const result=await service.invoke('discoverModels',request('text',{baseUrl:server.base}));assert(!JSON.stringify(result).includes('saved-test-credential'));
 for(const input of [request('text',{baseUrl:'https://user:pass@example.test/v1'}),request('text',{baseUrl:server.base},{timeoutMs:0}),request('tts',{ttsProtocol:'invented'}),request('unknown',{}),request('text',{baseUrl:server.base},{changeKey:true})])assert.equal((await service.invoke('discoverModels',input)).error.code,'DISCOVERY_INVALID_INPUT');
});

test('Electron桥仅新增明确发现动作，仍拒绝未知动作',async()=>{let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(path.resolve('electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return true;}}})});for(const action of ['discoverModels','cancelModelDiscovery']){const payload={requestId:'test'};assert.equal(await bridge.invoke(action,payload),true);assert.deepEqual(calls.at(-1),['studio:invoke',action,payload]);}await assert.rejects(bridge.invoke('pullModel',{}),/不支持/);});

test('引号与反斜杠密钥回显被递归脱敏且不破坏返回结构',async t=>{
 const {service}=serviceFixture(t),key='quoted-"-backslash-\\-credential',server=await fixtureServer(t,(req,res)=>json(res,{data:[{id:req.headers.authorization,name:'名称 '+key}]}));
 const result=await service.invoke('discoverModels',request('text',{baseUrl:server.base},{changeKey:true,key}));assert.equal(result.status,'ready');assert.equal(result.models[0].id,'Bearer [已隐藏]');assert.equal(result.models[0].name,'名称 [已隐藏]');assert.equal(result.models[0].generationVerified,false);
});

test('安全存储挂起也可取消并释放同一请求ID',async()=>{
 const {ModelDiscovery}=require('../server/model-discovery.cjs');const discovery=new ModelDiscovery({config:()=>({baseUrl:'http://127.0.0.1:1'}),secrets:{get:()=>new Promise(()=>{})}}),input=request('text',{}),pending=discovery.discover(input);
 assert.deepEqual(discovery.cancel(input.requestId),{cancelled:true});assert.equal((await pending).error.code,'DISCOVERY_CANCELLED');assert.equal(discovery.controllers.size,0);
});

test('连接拒绝与响应正文挂起返回稳定错误并清空模型',async t=>{
 const {service}=serviceFixture(t),server=await fixtureServer(t,(req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{"data":[');});
 const timed=await service.invoke('discoverModels',request('text',{baseUrl:server.base},{timeoutMs:1000}));assert.equal(timed.error.code,'DISCOVERY_TIMEOUT');assert.deepEqual(timed.models,[]);
 const closed=http.createServer();await new Promise(resolve=>closed.listen(0,'127.0.0.1',resolve));const port=closed.address().port;await new Promise(resolve=>closed.close(resolve));
 const failed=await service.invoke('discoverModels',request('text',{baseUrl:'http://127.0.0.1:'+port}));assert.equal(failed.error.code,'DISCOVERY_CONNECTION_FAILED');assert.deepEqual(failed.models,[]);
});
