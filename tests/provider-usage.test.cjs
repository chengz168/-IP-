const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Providers}=require('../server/providers.cjs');
async function fixture(t,reply,config={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sip-provider-usage-'));let calls=0;const server=http.createServer((_req,res)=>{calls++;const result=reply(calls);res.writeHead(result.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const store={root,data:{settings:{provider:{baseUrl:'http://127.0.0.1:'+server.address().port,model:'HTTP夹具',visionModel:'HTTP视觉夹具',textProtocol:'compatible',visionProtocol:'compatible',...config},usageLimits:{dailyTextRequests:10,dailyTokens:200000}}}};
 return {root,store,provider:new Providers(store,null,{get:async()=>''}),calls:()=>calls};
}
const completion=(text='夹具正文',reason='stop',usage={total_tokens:12})=>({choices:[{message:{content:text},finish_reason:reason}],usage});
test('真实HTTP协议入口共享文本视觉请求池，超限不发请求',async t=>{
 const f=await fixture(t,()=>({body:completion()}));f.store.data.settings.usageLimits.dailyTextRequests=2;
 const text=await f.provider.text('系统','用户',{}),vision=await f.provider.vision('系统','用户',['aW1hZ2U='],{});assert.equal(text.usageRecord.tokens,12);assert.equal(vision.usageRecord.tokens,12);assert.equal(f.provider.usageGuard.info().tokens,24);await assert.rejects(f.provider.text('系统','用户',{}),/次数/);assert.equal(f.calls(),2);
});
test('视觉空回包或截断实际usage仍入账，连续失败熔断只影响该能力',async t=>{
 const f=await fixture(t,i=>({body:completion(i===1?'':'片段','length',{prompt_tokens:9,completion_tokens:4})}));
 for(let i=0;i<3;i++)await assert.rejects(f.provider.vision('系统','用户',['aW1hZ2U='],{}),/没有返回描述|不完整/);
 const info=f.provider.usageGuard.info();assert.equal(info.tokens,39);assert.equal(info.estimatedTokens,0);assert.equal(info.circuitOpen.vision,true);assert.equal(info.circuitOpen.text,false);await assert.rejects(f.provider.vision('系统','用户',['aW1hZ2U='],{}),/暂停|熔断/);assert.equal(f.calls(),3);
});
test('本地Ollama文案与视觉生成不落云用量账本',async t=>{
 const f=await fixture(t,()=>({body:{message:{content:'本地HTTP夹具'},done_reason:'stop',prompt_eval_count:20,eval_count:10}}),{textProtocol:'ollama',visionProtocol:'ollama'});await f.provider.text('系统','用户',{});await f.provider.vision('系统','用户',['aW1hZ2U='],{});assert.equal(fs.existsSync(path.join(f.root,'usage.json')),false);assert.equal(f.calls(),2);
});
test('文本真实用量超出预留照实入账，下一请求阻断而非伪造成本硬上限',async t=>{
 const f=await fixture(t,()=>({body:completion('完整正文','stop',{total_tokens:9000})}));f.store.data.settings.usageLimits.dailyTokens=3000;const result=await f.provider.text('系统','用户',{});assert.equal(result.usageRecord.exceeded,true);assert.equal(f.provider.usageGuard.info().tokens,9000);await assert.rejects(f.provider.text('系统','用户',{}),/token|Token/);assert.equal(f.calls(),1);
});
test('云端输出上限留空仍实际发送2048，额度预留与请求限制一致',async t=>{
 const f=await fixture(t,()=>({body:completion()}),{textMaxTokens:''});let sent;f.provider.request=async(_url,request)=>{sent=JSON.parse(request.body);return {json:async()=>completion()};};const result=await f.provider.text('系统','用户',{});assert.equal(sent.max_tokens,2048);assert.equal(result.request.parameters.max_tokens,2048);assert.equal(f.provider.usageGuard.info().requests,1);
});
test('远程Ollama使用原协议但不能伪装成本地免费文案或视觉',async t=>{
 const f=await fixture(t,()=>({body:{}}),{baseUrl:'https://remote-ollama.example/v1',textProtocol:'ollama',visionProtocol:'ollama'});const urls=[];f.provider.request=async(url)=>{urls.push(url);return {json:async()=>({message:{content:'截获协议夹具'},done_reason:'stop',prompt_eval_count:20,eval_count:20})};};await f.provider.text('系统','用户',{});await f.provider.vision('系统','用户',['aW1hZ2U='],{});const info=f.provider.usageGuard.info();assert.equal(info.requests,2);assert.equal(info.tokens,80);assert(urls.every(url=>url==='https://remote-ollama.example/api/chat'));
});
