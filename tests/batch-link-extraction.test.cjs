const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm');
const {Store}=require('../server/store.cjs'),{Runtime}=require('../server/runtime.cjs'),{BatchLinkExtraction,linkItems,draftSnapshot}=require('../server/batch-link-extraction.cjs');
const {setImmediate:tick}=require('node:timers/promises');
function fixture(t,extract){const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-links-')),store=new Store(root),runtime=new Runtime(store),service={store,runtime,providers:{config:()=>({extractProtocol:'local'})},extractReferenceSource:extract||(async({sourceUrl})=>({text:'执行边界夹具的转写：'+sourceUrl}))};const batches=new BatchLinkExtraction(service);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store,runtime,service,batches,id:store.draft().id};}
async function ended(f,batchId){const deadline=Date.now()+5000;while(f.batches.active.has(batchId)){if(Date.now()>deadline)throw Error('批次未在定向测试时限结束');await tick();}return f.batches.status({id:f.id,batchId});}

test('分享文本解析：单条、多行、同URL去hash去重，错误行保留，最多50条',()=>{
 const rows=linkItems('第一条 https://v.douyin.com/abc/。\nhttps://v.douyin.com/abc/#other\nhttps://example.com/video1 https://example.com/video2\n无效文本');
 assert.equal(rows.length,5);assert.equal(rows[1].status,'duplicate');assert.equal(rows[1].duplicateOf,rows[0].id);assert.equal(rows[4].status,'failed');assert.equal(rows[0].url,'https://v.douyin.com/abc/');
 assert.throws(()=>linkItems(Array.from({length:51},(_,i)=>'https://example.com/'+i)),/50/);assert.throws(()=>linkItems([{}]),/分享文本/);assert.throws(()=>linkItems(' \n '),/至少/);
});

test('真实Store/Runtime串行调度，立即返回queued、逐条进度，普通失败继续，原稿和旧快照保存不丢结果',async t=>{
 let active=0,max=0;const calls=[];let f;f=fixture(t,async({sourceUrl},ctx)=>{active++;max=Math.max(max,active);calls.push(sourceUrl);ctx.progress(37,'实际边界进度');await tick();active--;if(sourceUrl.includes('/bad'))throw Error('页面不可访问');return {text:'本条正文 '+sourceUrl,evidence:{kind:'test-boundary'}};});
 const draft=f.store.draft(),before=structuredClone(draft);draft.sourceText='用户原稿';const stale=structuredClone(draft);
 const batch=f.batches.start({id:f.id,links:['https://example.com/one','https://example.com/bad','https://example.com/two','https://example.com/one']});assert.equal(batch.status,'queued');assert.throws(()=>f.batches.start({id:f.id,links:'https://example.com/new'}),/批量提取/);
 const result=await ended(f,batch.id);assert.equal(max,1);assert.equal(calls.length,3);assert.equal(result.status,'partial');assert.equal(result.counts.succeeded,2);assert.equal(result.counts.failed,1);assert.equal(result.counts.duplicate,1);assert.equal(result.progress,100);assert.equal(draft.sourceText,'用户原稿');
 assert(f.store.data.runs.filter(row=>row.parameters?.batchId===batch.id).every(row=>row.logs.some(log=>log.message==='实际边界进度')));
 f.store.updateDraft(stale);assert.equal(f.batches.status({id:f.id,batchId:batch.id}).items[0].text,result.items[0].text);assert.equal(f.store.draft().voice.audioId,before.voice.audioId);
 assert.equal(JSON.parse(fs.readFileSync(f.store.file,'utf8')).extractionBatches[0].status,'partial');
});

test('取消当前项真实abort，立即stopping；排队项不会开始，旧成功项保留',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve),calls=[];const f=fixture(t,async({sourceUrl},ctx)=>{calls.push(sourceUrl);if(sourceUrl.endsWith('/first'))return {text:'第一条已完成'};entered();await new Promise((resolve,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('停止测试边界')),{once:true}));});
 const batch=f.batches.start({id:f.id,links:['https://example.com/first','https://example.com/second','https://example.com/third']});await started;
 const stopped=f.batches.cancel({id:f.id,batchId:batch.id});assert.equal(stopped.status,'stopping');assert.equal(stopped.items[2].status,'cancelled');const result=await ended(f,batch.id);assert.equal(result.status,'cancelled');assert.equal(result.items[0].status,'succeeded');assert.equal(result.items[1].status,'cancelled');assert.equal(calls.length,2);
});

test('任务中心取消单项也停止后续批次队列',async t=>{
 let entered;const started=new Promise(resolve=>entered=resolve);const f=fixture(t,async(_,ctx)=>{entered();await new Promise((resolve,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('停止')),{once:true}));});const batch=f.batches.start({id:f.id,links:'https://example.com/one\nhttps://example.com/two'});await started;f.runtime.cancel(f.batches.batch(f.id,batch.id).items[0].runId);const result=await ended(f,batch.id);assert.equal(result.status,'cancelled');assert.equal(result.counts.cancelled,2);
});

test('远程unknown保留任务凭据，停止后续提交并阻止重交；停止等待不能宣称取消远程',async t=>{
 const f=fixture(t,async(_,ctx)=>{ctx.remote('remote-original',{kind:'reference-extract-v1'});const error=Error('结果待确认');error.unknown=true;throw error;});
 const batch=f.batches.start({id:f.id,links:'https://example.com/one\nhttps://example.com/two'}),result=await ended(f,batch.id);assert.equal(result.status,'unknown');assert.equal(result.items[0].remoteId,'remote-original');assert.equal(result.counts.unknown,1);assert.equal(result.counts.cancelled,1);assert.throws(()=>f.batches.start({id:f.id,links:'https://example.com/one'}),/待确认/);assert.equal(f.batches.cancel({id:f.id,batchId:batch.id}).status,'unknown');
});

test('桥接网络不确定失败保留unknown，本地普通网络失败允许下一项',async t=>{
 const f=fixture(t,async()=>{throw Error('模型服务请求超时');});f.service.providers.config=()=>({extractProtocol:'bridge'});const batch=f.batches.start({id:f.id,links:'https://example.com/one\nhttps://example.com/two'});const result=await ended(f,batch.id);assert.equal(result.status,'unknown');assert.equal(f.store.data.runs.length,1);
});

test('跨草稿同URL未知任务防重，不同来源可独立提取',async t=>{
 const f=fixture(t,async()=>({text:'不同来源正文'}));f.store.data.runs.push({id:'remote-on-other-draft',draftId:'other',type:'extract',status:'unknown',parameters:{sourceUrl:'https://example.com/one'},remoteId:'old-job'});
 assert.throws(()=>f.batches.start({id:f.id,links:'https://example.com/one#again'}),/相同来源链接/);
 const batch=f.batches.start({id:f.id,links:'https://example.com/two'}),result=await ended(f,batch.id);assert.equal(result.status,'succeeded');assert.equal(f.store.data.runs.find(row=>row.id==='remote-on-other-draft').status,'unknown');
});

test('全无效输入终止为failed且不提交提取进程',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return {text:'不会调用'};});const batch=f.batches.start({id:f.id,links:['无链接','ftp://example.com/file']}),result=await ended(f,batch.id);assert.equal(result.status,'failed');assert.equal(result.counts.failed,2);assert.equal(calls,0);assert.equal(f.store.data.runs.length,0);
});

test('同URL跨草稿在queued、running、stopping均拒绝重复提交',async t=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);let calls=0;const f=fixture(t,async()=>{calls++;entered();await waiting;return {text:'执行完成'};});const other=require('../server/store.cjs').createDraft();f.store.data.drafts.push(other);
 const batch=f.batches.start({id:f.id,links:'https://example.com/one'});
 assert.throws(()=>f.batches.start({id:other.id,links:'https://example.com/one'}),/相同来源链接/);await started;
 assert.throws(()=>f.batches.start({id:other.id,links:'https://example.com/one'}),/相同来源链接/);
 f.batches.cancel({id:f.id,batchId:batch.id});assert.equal(f.batches.batch(f.id,batch.id).status,'stopping');assert.throws(()=>f.batches.start({id:other.id,links:'https://example.com/one'}),/相同来源链接/);release();await ended(f,batch.id);assert.equal(calls,1);
});

test('选用CAS逐字段校验，原文未变但其他来源正文改变也拒绝清空',async t=>{
 const f=fixture(t),batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id);
 for(const [field,value] of Object.entries({sourceUrl:'https://example.com/new',rewrite:'新改写',finalText:'新确认稿',confirmed:true})){
  const draft=f.store.draft(),old=draft[field],expectedDraft=draftSnapshot(draft);draft[field]=value;
  assert.throws(()=>f.batches.use({id:f.id,batchId:batch.id,itemId:result.items[0].id,expectedDraft}),/已变化/);assert.equal(draft[field],value);draft[field]=old;
 }
 assert.throws(()=>f.batches.use({id:f.id,batchId:batch.id,itemId:result.items[0].id,expectedSourceText:''}),/已变化/);
});

test('提取返回stale拒绝成功，旧记录后来被标stale也不可选用',async t=>{
 const f=fixture(t,async()=>({text:'过期正文',stale:true}));const batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id);assert.equal(result.items[0].status,'failed');assert.match(result.items[0].error,/过期/);assert.equal(f.store.data.runs[0].status,'failed');
 f.service.extractReferenceSource=async()=>({text:'原有效正文'});const next=f.batches.start({id:f.id,links:'https://example.com/two'}),done=await ended(f,next.id);f.batches.batch(f.id,next.id).items[0].output.stale=true;
 assert.throws(()=>f.batches.use({id:f.id,batchId:next.id,itemId:done.items[0].id,expectedDraft:draftSnapshot(f.store.draft())}),/过期/);assert.equal(f.store.draft().sourceText,'');
 f.batches.batch(f.id,next.id).items[0].output.stale=false;f.store.data.runs.find(run=>run.id===done.items[0].runId).output.stale=true;assert.throws(()=>f.batches.use({id:f.id,batchId:next.id,itemId:done.items[0].id,expectedDraft:draftSnapshot(f.store.draft())}),/过期/);
});

test('未知批次按原run终态对账，仍unknown绝不假查询或自动重交',async t=>{
 const f=fixture(t,async(_,ctx)=>{ctx.remote('original-job',{kind:'reference-extract-v1'});const error=Error('待确认');error.unknown=true;throw error;});const batch=f.batches.start({id:f.id,links:'https://example.com/one'});await ended(f,batch.id);
 assert.equal(f.batches.status({id:f.id,batchId:batch.id}).status,'unknown');const run=f.store.data.runs[0];run.status='succeeded';run.output={text:'权威运行回包'};run.endedAt=new Date().toISOString();
 const checked=f.batches.status({id:f.id,batchId:batch.id});assert.equal(checked.status,'succeeded');assert.equal(checked.items[0].text,'权威运行回包');assert.equal(checked.items[0].reconciliation.basis,'authoritative-local-run');assert.equal(f.store.data.runs.length,1);
});

test('人工终止必须明确核对说明及匹配原任务凭据，保留回执并允许后续重试',async t=>{
 const f=fixture(t,async(_,ctx)=>{ctx.remote('original-job',{kind:'reference-extract-v1'});const error=Error('待确认');error.unknown=true;throw error;});const batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id),item=result.items[0],params={id:f.id,batchId:batch.id,itemId:item.id,expectedRunId:item.runId,expectedRemoteId:'original-job',confirmed:true,note:'已进入服务后台确认该任务已经终止'};
 assert.throws(()=>f.batches.confirmTerminated({...params,confirmed:false}),/明确确认/);assert.throws(()=>f.batches.confirmTerminated({...params,note:'好了'}),/核对说明/);assert.throws(()=>f.batches.confirmTerminated({...params,expectedRemoteId:'wrong'}),/凭据已变化/);assert.equal(f.store.data.runs[0].status,'unknown');
 f.store.data.runs[0].unresolvedHistory=[{status:'unknown',error:'更早历史'}];const originalError=f.store.data.runs[0].error,originalEnded=f.store.data.runs[0].endedAt;
 const done=f.batches.confirmTerminated(params);assert.equal(done.status,'cancelled');assert.equal(done.items[0].terminationReceipt.basis,'user-confirmed-remote-termination');assert.equal(done.items[0].error,undefined);assert.equal(done.items[0].unresolvedHistory[0].status,'unknown');assert.equal(f.store.data.runs[0].status,'cancelled');assert.equal(f.store.data.runs[0].remoteId,'original-job');assert.equal(f.store.data.runs[0].unresolvedHistory.length,2);assert.equal(f.store.data.runs[0].unresolvedHistory[0].error,'更早历史');assert.equal(f.store.data.runs[0].unresolvedHistory[1].error,originalError);assert.equal(f.store.data.runs[0].unresolvedHistory[1].endedAt,originalEnded);f.service.extractReferenceSource=async()=>({text:'核对后新任务结果'});const retry=f.batches.start({id:f.id,links:'https://example.com/one'});assert.equal((await ended(f,retry.id)).status,'succeeded');
});

test('服务queued窗口参考操作互斥，删终态草稿清批次但保留素材，解除删除引用',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-service-guards-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const service=require('./support/licensed-service.cjs').createService(root),id=service.store.draft().id;service.store.data.settings.provider.extractProtocol='local';service.store.draft().sourceUrl='https://example.com/one';let calls=0;service.extractReferenceSource=async()=>{calls++;return {text:'正文'};};
 const batch=await service.invoke('startExtractBatch',{id,links:'https://example.com/one'});
 for(const action of ['analyzeReferenceVideo','createReferenceScript','useReferenceScript'])await assert.rejects(service.invoke(action,{id}),/批量提取/);
 await ended({batches:service.batchExtraction,id},batch.id);assert.equal(calls,1);const file=path.join(root,'reference.txt');fs.writeFileSync(file,'source');const asset=service.store.addAsset(file);service.batchExtraction.batch(id,batch.id).items[0].sourceAssetId=asset.id;
 await assert.rejects(service.invoke('deleteAsset',{id:asset.id}),/引用/);await service.invoke('deleteDraft',{id});assert.equal(service.store.data.extractionBatches.length,0);assert(fs.existsSync(asset.path));await service.invoke('deleteAsset',{id:asset.id});assert.equal(service.store.data.assets.length,0);
});

test('显式选用归档旧稿，进入第二步，原素材保留，快照冲突拒绝且不改稿',async t=>{
 const f=fixture(t);const draft=f.store.draft();Object.assign(draft,{sourceText:'原文',sourceUrl:'旧链接',rewrite:'旧改写',finalText:'旧确认稿',confirmed:true});
 const batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id);assert.throws(()=>f.batches.use({id:f.id,batchId:batch.id,itemId:result.items[0].id,expectedDraft:{...draftSnapshot(f.store.draft()),sourceText:'过期内容'}}),/原稿.*已变化/);assert.equal(draft.finalText,'旧确认稿');
 const updated=f.batches.use({id:f.id,batchId:batch.id,itemId:result.items[0].id,expectedDraft:draftSnapshot(f.store.draft())});assert.equal(updated.sourceText,result.items[0].text);assert.equal(updated.step,1);assert.equal(updated.rewrite,'');assert.equal(updated.finalText,'');assert.equal(updated.confirmed,false);assert.equal(f.batches.batch(f.id,batch.id).applications[0].previous.finalText,'旧确认稿');assert.equal(f.batches.batch(f.id,batch.id).items[0].text,result.items[0].text);
});

test('有哈希来源素材变化后拒绝选用，原稿与素材留存',async t=>{
 let f;f=fixture(t,async()=>{const file=path.join(f.root,'source.mp4');fs.writeFileSync(file,'测试媒体边界');const asset=f.store.addAsset(file,{type:'video'}),sha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');return {text:'边界正文',sourceAssetId:asset.id,linkSource:{assetId:asset.id,sha256}};});const batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id),item=result.items[0];fs.appendFileSync(f.store.asset(item.sourceAssetId).path,'变化');assert.throws(()=>f.batches.use({id:f.id,batchId:batch.id,itemId:item.id,expectedDraft:draftSnapshot(f.store.draft())}),/来源素材已变化/);assert.equal(f.store.draft().sourceText,'');assert.equal(f.store.data.assets.length,1);assert(f.batches.assetInUse(item.sourceAssetId));
});

test('应用重启依据真实运行记录恢复，成功回执可收取，unknown不重交',t=>{
 const f=fixture(t),base={id:'batch-restart',draftId:f.id,status:'running',items:[{id:'a',status:'running',runId:'run-a'},{id:'b',status:'running',runId:'run-b'},{id:'c',status:'queued'}]};f.store.data.extractionBatches=[base];f.store.data.runs.push({id:'run-a',status:'succeeded',output:{text:'已保存正文'}},{id:'run-b',status:'unknown',remoteId:'original'});f.store.save();const restored=new Store(f.root),batches=new BatchLinkExtraction({...f.service,store:restored});const result=batches.status({id:f.id,batchId:base.id});assert.equal(result.status,'unknown');assert.equal(result.items[0].status,'succeeded');assert.equal(result.items[1].status,'unknown');assert.equal(result.items[2].status,'interrupted');assert.equal(batches.active.size,0);assert.throws(()=>batches.start({id:f.id,links:'https://example.com/one'}),/待确认/);
});

test('首次写盘失败不留伪队列、不提交；选用写盘失败原稿及归档回滚',async t=>{
 const f=fixture(t),save=f.store.save.bind(f.store);f.store.save=()=>{throw Error('测试磁盘故障');};assert.throws(()=>f.batches.start({id:f.id,links:'https://example.com/one'}),/磁盘故障/);assert.equal(f.batches.active.size,0);assert.equal(f.store.data.extractionBatches,undefined);f.store.save=save;
 const batch=f.batches.start({id:f.id,links:'https://example.com/one'}),result=await ended(f,batch.id),before=structuredClone(f.store.draft());f.store.save=()=>{throw Error('测试磁盘故障');};assert.throws(()=>f.batches.use({id:f.id,batchId:batch.id,itemId:result.items[0].id,expectedDraft:draftSnapshot(f.store.draft())}),/磁盘故障/);assert.deepEqual(f.store.draft(),before);assert.equal(f.batches.batch(f.id,batch.id).applications.length,0);
});

test('真实服务动作通过本机HTTP桥逐条提交各自URL，单链接兼容，白名单与状态查询可用',async t=>{
 const bodies=[];const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{const value=JSON.parse(body);bodies.push(value);response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({text:'服务契约边界正文 '+value.url}));});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const {createService}=require('./support/licensed-service.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const service=createService(root),id=service.store.draft().id;service.store.data.settings.provider={extractProtocol:'bridge',extractUrl:'http://127.0.0.1:'+server.address().port};service.store.draft().sourceUrl='https://example.com/original';
 const batch=await service.invoke('startExtractBatch',{id,links:'https://example.com/one\nhttps://example.com/two'});await assert.rejects(service.invoke('extract',{id}),/批量提取/);const f={batches:service.batchExtraction,id};await ended(f,batch.id);assert.deepEqual(bodies.map(row=>row.url),['https://example.com/one','https://example.com/two']);assert.equal(service.store.draft().sourceUrl,'https://example.com/original');const single=await service.invoke('extract',{id});assert(single.text.includes('/original'));assert.equal((await service.invoke('extractBatchStatus',{id})).batches.length,1);
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>calls.push(args)}})});for(const action of ['startExtractBatch','extractBatchStatus','cancelExtractBatch','useExtractBatchItem'])await bridge.invoke(action,{id});assert.equal(calls.length,4);
});
