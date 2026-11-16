const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ComfyH3,buildGraph,localBase}=require('../server/comfy-h3.cjs');
const {createService}=require('../server/service.cjs');

test('H3 图同时使用形象首帧和驱动音轨，时长覆盖原音频且不接入参考成片输出',()=>{
 const graph=buildGraph({image:'own/face.png',audio:'own/driver.wav',duration:5.167,portrait:true,seed:42,prefix:'own/output'});
 assert.equal(graph['6'].inputs.length%17,5);assert(graph['6'].inputs.length/24>=5.167);
 assert.deepEqual(graph['6'].inputs.first_frame,['17',0]);assert.deepEqual(graph['19'].inputs.audio,['18',0]);
 assert.deepEqual(graph['11'].inputs.conditioning,['19',0]);assert.equal(graph['18'].inputs.audio,'own/driver.wav');
 assert.equal(graph['6'].inputs.width,608);assert.equal(graph['6'].inputs.height,1056);
 assert.equal(graph['16'].class_type,'SaveVideo');assert.equal(graph['16'].inputs.filename_prefix,'own/output');
 for(const url of ['https://example.com','http://192.168.1.2:8188'])assert.throws(()=>localBase(url),/本机/);
 assert.equal(localBase('http://127.0.0.1:8188/'),'http://127.0.0.1:8188');
});

test('短片实际生成图采用首帧和三字段提示词，不编造驱动对白或固定人物外观',()=>{
 for(const duration of [1,5.167,12,15]){
  const graph=buildGraph({image:'own/face.png',audio:'own/driver.wav',duration,portrait:true,seed:42,prefix:'own/output'}),prompt=graph['6'].inputs.prompt;
  assert(prompt.startsWith('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n'));
  const fields=['integrated_multimodal_description:','overall_soundscape:','non_diegetic_music:'];let last=-1;
  for(const field of fields){const index=prompt.indexOf(field);assert(index>last);assert.equal(prompt.split(field).length,2);last=index;}
  assert(prompt.includes(duration.toFixed(2)+' seconds'));assert(prompt.includes('supplied driving audio'));
  assert(!/<d>|white shirt|woman|<Audio 1>|medium close-up/.test(prompt));
  assert.deepEqual(graph['19'].inputs.audio,['18',0]);assert.equal(graph['18'].inputs.audio,'own/driver.wav');
 }
 for(const duration of [NaN,Infinity,0,-1,15.01])assert.throws(()=>buildGraph({duration}),/时长无效/);
});

test('查询 H3 原任务不重交，明确区分队列、完成、失败与未知',async t=>{
 let mode='running';const calls=[];
 const server=http.createServer((req,res)=>{calls.push([req.method,req.url]);res.setHeader('Content-Type','application/json');
  if(req.url==='/queue')return res.end(JSON.stringify({queue_running:mode==='running'?[[0,'id',{},{}]]:[],queue_pending:[]}));
  const state=mode==='success'?{status:{status_str:'success'},outputs:{'16':{images:[{filename:'new.mp4',subfolder:'own',type:'output'}]}}}:mode==='failed'?{status:{status_str:'error',messages:[['execution_error',{exception_message:'真实错误测试夹具'}]]}}:null;
  res.end(JSON.stringify(state?{id:state}:{}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const remote={baseUrl:'http://127.0.0.1:'+server.address().port},h3=new ComfyH3({},{});
 assert.equal((await h3.query('id',remote)).status,'running');mode='success';assert.equal((await h3.query('id',remote)).video.filename,'new.mp4');
 mode='failed';assert.equal((await h3.query('id',remote)).status,'failed');mode='missing';await assert.rejects(h3.query('id',remote),/最终状态/);
 assert(calls.every(row=>row[0]==='GET'));assert(calls.every(row=>!row[1].startsWith('/prompt')));
});

test('H3 任务断开后保存输入与图，可沿原任务查询而不调用云端认证或重交',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-h3-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=createService(root),id=service.store.draft().id;
 await assert.rejects(service.runtime.run('avatar',id,{},async ctx=>{
  ctx.remote('own-prompt',{kind:'comfy-h3-v1',baseUrl:'http://127.0.0.1:8188',statusUrl:'http://127.0.0.1:8188/history/own-prompt',image:{name:'face.png',sha256:'a'},audio:{name:'driver.wav',sha256:'b'},duration:5,seed:42,graph:{own:'graph'}});
  throw Object.assign(Error('模拟查询断开'),{unknown:true});
 }),/查询断开/);
 const run=service.store.data.runs[0];assert.equal(run.status,'unknown');assert.equal(run.remote.audio.name,'driver.wav');assert.deepEqual(run.remote.graph,{own:'graph'});
 let queryCount=0;service.providers.comfyH3=()=>({query:async(remoteId,remote)=>{queryCount++;assert.equal(remoteId,'own-prompt');assert.equal(remote.audio.sha256,'b');return {jobId:remoteId,status:'queued'};}});
 service.providers.headers=async()=>{throw Error('本地查询不应读取云端密钥');};
 assert.equal((await service.avatarRecovery.query({runId:run.id})).status,'pending');assert.equal(queryCount,1);assert.equal(run.status,'unknown');
});

test('H3 提交回包缺少ID或中途断开均保留未知，不把已接收请求标成可重试失败',async t=>{
 let mode='missing',count=0;
 const server=http.createServer((req,res)=>{count++;req.resume();if(mode==='disconnect'){req.socket.destroy();return;}res.setHeader('Content-Type','application/json');if(mode==='reject'){res.statusCode=400;res.end(JSON.stringify({error:'模型缺失测试夹具'}));return;}res.end(JSON.stringify(mode==='success'?{prompt_id:'only-once'}:{}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port,h3=new ComfyH3({},{}),graph={owned:'graph'};
 await assert.rejects(h3.submit(base,graph,'own-client',{}),error=>error.unknown===true&&error.evidence.clientId==='own-client');assert.equal(count,1);
 mode='disconnect';await assert.rejects(h3.submit(base,graph,'own-client',{}),error=>error.unknown===true);assert.equal(count,2);
 mode='reject';await assert.rejects(h3.submit(base,graph,'own-client',{}),error=>error.remoteConfirmed===true&&!error.unknown);assert.equal(count,3);
 mode='success';assert.equal(await h3.submit(base,graph,'own-client',{}),'only-once');assert.equal(count,4);
});

test('回收H3结果时原驱动音频被替换须拒绝封装，清理临时文件且不新增资产',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-h3-audio-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>res.end('已替换的输入字节测试夹具'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 let created=false;const store={outputDir:()=>root,addAsset:()=>{created=true;throw Error('不应创建资产');}};
 const media={binaries:()=>{throw Error('校验失败前不应启动封装');}},h3=new ComfyH3(store,media);
 await assert.rejects(h3.collect({jobId:'id',video:{filename:'own.mp4',type:'output'}},{baseUrl:'http://127.0.0.1:'+server.address().port,audio:{name:'driver.wav',type:'input',sha256:'wrong'}},{},{}),/驱动音频已变化/);
 assert.equal(created,false);assert.deepEqual(fs.readdirSync(root),[]);
});

test('提交期间取消且未取得ID时仍保留未知和提交凭据，阻止误重交',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'superip-h3-submit-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=createService(root),draft=service.store.draft();
 await assert.rejects(service.runtime.run('avatar',draft.id,{},async()=>{
  service.runtime.cancel(service.store.data.runs[0].id);
  throw Object.assign(Error('提交回包未确认'),{unknown:true,evidence:{clientId:'own-client',graphSha256:'own-sha'}});
 }),/未确认/);
 const run=service.store.data.runs[0];assert.equal(run.status,'unknown');assert.equal(run.remoteId,'');assert.equal(run.failureOutput.clientId,'own-client');assert.match(run.error,/不能直接重交/);
 await assert.rejects(service.invoke('avatar',{id:draft.id}),/待确认/);
});
