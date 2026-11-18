const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ComfyH3}=require('../server/comfy-h3.cjs');
const {StoryGenerator,DEFAULT_CHECKPOINT}=require('../server/story-generator.cjs');
const {Runtime}=require('../server/runtime.cjs');

async function serverAt(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return {server,base:'http://127.0.0.1:'+server.address().port};}
function fixture(t,provider){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'story-connection-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store={data:{runs:[],assets:[],settings:{provider}},draft:()=>({id:'draft'}),save(){},outputDir:()=>directory,asset:()=>({id:'ref',type:'image',path:path.join(directory,'ref.png')})};fs.writeFileSync(path.join(directory,'ref.png'),'参考图片夹具');return {store,generator:new StoryGenerator(store,{},{}),runtime:new Runtime(store)};}
function info(){return {CheckpointLoaderSimple:{input:{required:{ckpt_name:[[DEFAULT_CHECKPOINT]]}}},...Object.fromEntries(['KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage'].map(name=>[name,{}]))};}
const input={prompt:'只用于本机HTTP协议测试，不调用模型',aspect:'9:16'};

test('连接拒绝显示本机服务地址并保留底层原因，停止和超时不伪装成连接失败',async t=>{
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;await new Promise(resolve=>server.close(resolve));
 const comfy=new ComfyH3({},{});
 await assert.rejects(comfy.json(base,'/object_info'),error=>error.message.includes(base)&&/请先启动/.test(error.message)&&error.cause?.cause?.code==='ECONNREFUSED');
 const controller=new AbortController();controller.abort();await assert.rejects(comfy.request(base,'/object_info',{}, {signal:controller.signal}),error=>/已停止/.test(error.message)&&error.message.includes(base));
 // 只替换fetch制造超时错误，不等待20秒，也不发网络请求。
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new DOMException('超时夹具','TimeoutError');};try{await assert.rejects(comfy.request(base,'/object_info'),error=>/请求超时/.test(error.message)&&error.message.includes(base)&&error.cause?.name==='TimeoutError');}finally{globalThis.fetch=original;}
});

test('SDXL和Z图服务未开都在只读预检失败，不登记remote或未知任务',async t=>{
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;await new Promise(resolve=>server.close(resolve));
 for(const architecture of ['sdxl','z-image-turbo']){
  const {store,generator,runtime}=fixture(t,{storyImageProtocol:'comfy',storyImageArchitecture:architecture,storyImageBaseUrl:base});let posts=0;generator.comfy.upload=async()=>{posts++;throw Error('不应上传');};generator.comfy.submit=async()=>{posts++;throw Error('不应提交');};
  await assert.rejects(runtime.run('story-image','draft',{},ctx=>generator.image(input,ctx)),/请先启动/);
  assert.equal(posts,0);assert.equal(store.data.runs[0].status,'failed');assert.equal(store.data.runs[0].remote,undefined);assert.equal(store.data.runs[0].remoteId,'');assert.equal(store.data.assets.length,0);
 }
});

test('SDXL缺权重或节点只发送object_info GET，主参考未上传、生成未提交',async t=>{
 let mode='model';const calls=[];const {base}=await serverAt(t,(req,res)=>{calls.push([req.method,req.url]);const data=info();if(mode==='model')data.CheckpointLoaderSimple.input.required.ckpt_name=[[]];else delete data.SaveImage;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));});
 const {generator,store,runtime}=fixture(t,{storyImageProtocol:'comfy',storyImageArchitecture:'sdxl',storyImageBaseUrl:base});
 for(mode of ['model','node'])await assert.rejects(runtime.run('story-image','draft',{},ctx=>generator.image({...input,references:[{assetId:'ref'}]},ctx)),/本地工作流不可用/);
 assert.deepEqual(calls,[['GET','/object_info'],['GET','/object_info']]);assert(store.data.runs.every(run=>run.status==='failed'&&!run.remote));assert.equal(store.data.assets.length,0);
});

test('预检通过后只提交一次，服务收到prompt但断开回包仍保留完整凭据和unknown',async t=>{
 const calls=[];const {base}=await serverAt(t,(req,res)=>{calls.push([req.method,req.url]);if(req.url==='/object_info'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(info()));}if(req.url==='/prompt'){req.resume();req.on('end',()=>req.socket.destroy());return;}res.statusCode=404;res.end();});
 const {generator,store,runtime}=fixture(t,{storyImageProtocol:'comfy',storyImageArchitecture:'sdxl',storyImageBaseUrl:base});generator.comfy.observe=async()=>({bind(){},close(){}});
 await assert.rejects(runtime.run('story-image','draft',{},ctx=>generator.image(input,ctx)),error=>error.unknown===true&&error.message.includes(base));
 assert.deepEqual(calls,[['GET','/object_info'],['POST','/prompt']]);const run=store.data.runs[0];assert.equal(run.status,'unknown');assert.equal(run.remote.submissionState,'submitting');assert(run.remote.clientId&&run.remote.graph&&run.remote.graphSha256);assert.equal(run.remoteId,'');assert.equal(store.data.assets.length,0);
});

test('HTTP400非JSON回包保留明确拒绝，成功HTTP非JSON仍为未知，不重交',async t=>{
 let status=400;const calls=[];const {base}=await serverAt(t,(req,res)=>{calls.push([req.method,req.url]);req.resume();res.statusCode=status;res.setHeader('Content-Type','text/plain');res.end('非JSON夹具');});
 const comfy=new ComfyH3({},{}),graph={owned:'graph'};
 await assert.rejects(comfy.submit(base,graph,'client',{}),error=>error.httpStatus===400&&error.remoteConfirmed===true&&!error.unknown&&error.message.includes(base));
 status=200;await assert.rejects(comfy.submit(base,graph,'client2',{}),error=>error.unknown===true&&!error.remoteConfirmed&&error.message.includes(base));assert.equal(calls.length,2);assert(calls.every(row=>row[0]==='POST'&&row[1]==='/prompt'));
});

test('读取响应体超时或取消保留实际语义和地址，不提示JSON格式错误',async()=>{
 const comfy=new ComfyH3({},{}),base='http://127.0.0.1:18188';
 comfy.request=async()=>({ok:true,json:async()=>{throw new DOMException('响应体超时夹具','TimeoutError');}});
 await assert.rejects(comfy.json(base,'/object_info'),error=>/读取超时/.test(error.message)&&error.message.includes(base)&&error.cause?.name==='TimeoutError');
 const controller=new AbortController();controller.abort();await assert.rejects(comfy.json(base,'/object_info',{}, {signal:controller.signal}),error=>/已停止/.test(error.message)&&error.message.includes(base));
});

test('提交前观察器失败或观察器打开期间取消不保存提交凭据、不发送prompt',async t=>{
 for(const mode of ['observer-failure','cancel']){
  const {store,generator,runtime}=fixture(t,{});let submissions=0;
  generator.comfy.submit=async()=>{submissions++;throw Error('不应提交');};
  generator.comfy.observe=async(_remote,ctx)=>{if(mode==='observer-failure')throw Error('观察器夹具失败');runtime.cancel(store.data.runs[0].id);assert(ctx.signal.aborted);return {close(){}};};
  await assert.rejects(runtime.run('story-image','draft',{},ctx=>generator.executeComfy({kind:'story-comfy-image-v1',baseUrl:'http://127.0.0.1:8188',clientId:'client',graph:{},submissionState:'submitting'},ctx)));
  assert.equal(submissions,0);assert.equal(store.data.runs[0].remote,undefined);assert.equal(store.data.runs[0].status,mode==='cancel'?'cancelled':'failed');
 }
});
