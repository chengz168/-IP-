const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),crypto=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {ComfyProgress,observeComfy}=require('../server/comfy-progress.cjs');
const {Runtime}=require('../server/runtime.cjs');
const graph={'6':{class_type:'MiniMaxH3ImageToVideo'},'12':{class_type:'SamplerCustomAdvanced'},'13':{class_type:'VAEDecode'}};
function frame(message){const bytes=Buffer.from(JSON.stringify(message));if(bytes.length>=126)throw Error('夹具消息过长');return Buffer.concat([Buffer.from([0x81,bytes.length]),bytes]);}
async function fixture(t){
 const connections=[],requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.method+' '+req.url);res.end('{}');});
 server.on('upgrade',(req,socket)=>{
  requests.push(req.method+' '+req.url);
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.on('error',()=>{});socket.on('data',bytes=>{if((bytes[0]&15)===8)socket.end(Buffer.from([0x88,0]));});connections.push(socket);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 return {baseUrl:'http://127.0.0.1:'+server.address().port,connections,requests};
}
async function waitUntil(fn){for(let i=0;i<100;i++){if(fn())return;await sleep(10);}assert.fail('未收到预期进度');}
test('真实WS早到进度在ID绑定后过滤，原任务与节点核对，不发任何POST',async t=>{
 const f=await fixture(t),events=[],controller=new AbortController();
 const observer=await observeComfy({...f,clientId:'own-client',graph,signal:controller.signal,onActivity:a=>events.push(a)});t.after(()=>observer.close());
 for(const message of [
  {type:'progress',data:{prompt_id:'other',node:'12',value:1,max:8}},
  {type:'executing',data:{prompt_id:'own',node:'12'}},
  {type:'progress',data:{prompt_id:'own',node:'12',value:3,max:8}}
 ])f.connections[0].write(frame(message));
 await sleep(25);assert.equal(events.length,0);observer.bind('own');
 assert.deepEqual(events.map(a=>a.phase),['waiting','executing','sampling']);assert.equal(events.at(-1).value,3);
 assert(events.every(a=>a.promptId==='own'));assert.equal(f.requests.length,1);assert(f.requests[0].includes('clientId=own-client'));
 assert.throws(()=>observer.bind('other'),/不能切换/);controller.abort();assert(observer.closed);observer.bind('other');assert.equal(observer.promptId,'own');
});
test('忽略缺ID、错误节点、非法步数、重复及旧节点事件；完成事件仅记录阶段',()=>{
 const events=[],observer=new ComfyProgress({baseUrl:'http://127.0.0.1:8188',clientId:'x',graph,onActivity:a=>events.push(a)});observer.bind('p');
 const send=(type,data)=>observer.receive(JSON.stringify({type,data}));
 for(const data of [{node:'12',value:1,max:8},{prompt_id:'q',node:'12',value:1,max:8},{prompt_id:'p',node:'99',value:1,max:8},...[[-1,8],[9,8],[1,0],[1.5,8],['1',8],[1,Infinity]].map(([value,max])=>({prompt_id:'p',node:'12',value,max}))])send('progress',data);
 assert.equal(events.length,1);
 send('executing',{prompt_id:'p',node:'12'});send('progress',{prompt_id:'p',node:'12',value:3,max:8});
 for(const value of [3,2])send('progress',{prompt_id:'p',node:'12',value,max:8});
 send('progress',{prompt_id:'p',node:'12',value:4,max:7});assert.equal(events.length,3);
 send('executing',{prompt_id:'p',node:'13'});send('progress',{prompt_id:'p',node:'12',value:4,max:8});send('executing',{prompt_id:'p',node:'12'});
 assert.equal(events.at(-1).node,'13');assert.equal(events.length,4);
 send('execution_success',{prompt_id:'p'});send('progress',{prompt_id:'p',node:'13',value:1,max:2});assert.equal(events.at(-1).phase,'collecting');assert.equal(events.length,5);
 assert.equal(events.at(-1).status,undefined);observer.close();
});
test('真实连接断开后仅显示观察中断，取消清理且不会自动重新提交',async t=>{
 const f=await fixture(t),events=[];const observer=await observeComfy({...f,clientId:'c',graph,onActivity:a=>events.push(a)});t.after(()=>observer.close());observer.bind('p');
 f.connections[0].destroy();await waitUntil(()=>events.at(-1)?.phase==='disconnected');assert.equal(f.requests.length,1);observer.check();observer.close();
});
test('观察连接失败不抛模型失败，持久化失败则留给调用方停止等待',async t=>{
 const f=await fixture(t);
 const unavailable=await observeComfy({baseUrl:'http://127.0.0.1:1',clientId:'x',graph});t.after(()=>unavailable.close());unavailable.bind('p');unavailable.check();assert(['unavailable','disconnected'].includes(unavailable.state));
 const observer=new ComfyProgress({baseUrl:f.baseUrl,clientId:'x',graph,onActivity:()=>{throw Error('磁盘已满');}});assert.throws(()=>observer.bind('p'),/磁盘已满/);assert.throws(()=>observer.check(),/磁盘已满/);observer.close();
});
test('运行时持久保存真实采样，但progress事件不将执行标为成功',async()=>{
 const snapshots=[],store={data:{runs:[]},draft:()=>({id:'d'}),save(){snapshots.push(structuredClone(this.data));}},runtime=new Runtime(store);
 let release;const gate=new Promise(resolve=>release=resolve);
 const execution=runtime.run('avatar','d',{},async ctx=>{ctx.activity({kind:'comfy-h3-activity-v1',promptId:'p',phase:'sampling',node:'12',value:8,max:8});await gate;return {id:'asset'};});
 assert.equal(store.data.runs[0].status,'running');assert.equal(store.data.runs[0].progress,0);assert.equal(snapshots.at(-1).runs[0].activity.value,8);release();await execution;assert.equal(store.data.runs[0].status,'succeeded');
});
test('阶段文案显示真实步数与段序，不伪造整片百分比',async()=>{
 const {h3ActivityText}=await import('../server/h3-activity.mjs');
 assert.equal(h3ActivityText({kind:'comfy-h3-activity-v1',phase:'sampling',value:3,max:8,segmentIndex:1,segmentCount:4}),'第 2/4 段 · 采样 3/8');
 assert.equal(h3ActivityText({kind:'comfy-h3-activity-v1',phase:'unavailable'}),'进度连接不可用，正在查询原任务');
 assert.equal(h3ActivityText(null),'');
});
