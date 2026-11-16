const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Providers}=require('../server/providers.cjs');
const {toAss}=require('../server/media.cjs');

test('Ollama文本明确关闭思考，达到长度上限时拒绝不完整文案',async()=>{
  const store={data:{settings:{provider:{baseUrl:'http://127.0.0.1:11434/v1',model:'installed',textProtocol:'ollama',textMaxTokens:'64'}}}};
  const provider=new Providers(store,null,{get:async()=>''});let request;
  provider.request=async(url,options)=>{request={url,body:JSON.parse(options.body)};return {json:async()=>({message:{content:'没有写完'},done_reason:'length'})};};
  await assert.rejects(provider.text('保持事实','改写',{}),/不完整/);assert.equal(request.url,'http://127.0.0.1:11434/api/chat');assert.equal(request.body.think,false);assert.equal(request.body.options.num_predict,64);
});
test('本地上下文显式传递，长文超出保守预算时在请求前拒绝',async()=>{
  const config={baseUrl:'http://127.0.0.1:11434/v1',model:'installed',textProtocol:'ollama',textMaxTokens:'64',textContextTokens:'8192'};
  const provider=new Providers({data:{settings:{provider:config}}},null,{get:async()=>''});let calls=0,options;
  provider.request=async(url,request)=>{calls++;options=JSON.parse(request.body).options;return {json:async()=>({message:{content:'实际接口格式'},done_reason:'stop'})};};
  await provider.text('保留事实','短文',{});assert.equal(options.num_ctx,8192);
  await assert.rejects(provider.text('保留事实','中文'.repeat(2000),{}),/保守预算/);assert.equal(calls,1);
  config.textContextTokens='511';await assert.rejects(provider.text('短','文',{}),/至少512/);assert.equal(calls,1);
  config.textContextTokens='';await provider.text('短','文',{});assert.equal(Object.hasOwn(options,'num_ctx'),false);
});
test('系统朗读选择克隆音色时明确拒绝，不静默替代',async()=>{
  const provider=new Providers({data:{settings:{provider:{ttsProtocol:'windows'}}}},null,{get:async()=>''});
  await assert.rejects(provider.speech({voice:{profile:'clone-id'}},{}),process.platform==='win32'?/清空克隆音色/:/仅支持Windows/);
});
test('ASS字幕保留画布尺寸、按速度缩放时间，并转义样式注入',()=>{
  const result=toAss([{start:1,end:3,text:'{\\pos(0,0)}正文\n下一行'}],1080,1920,{speed:2,marginV:500});
  assert.match(result,/PlayResX: 1080/);assert.match(result,/PlayResY: 1920/);assert.match(result,/00:00:00.50,00:00:01.50/);assert.ok(!result.includes('{\\pos'));assert.match(result,/正文\\N下一行/);
});
