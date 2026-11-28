const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('./support/licensed-service.cjs');
const {batches}=require('../server/brain-account-analysis.cjs');
const profileId='MS4w_All_Test',url='https://www.douyin.com/user/'+profileId;
const sample='先清点桌面上每天会用到的东西，再按使用频率分类。常用的放在手边，不常用的放进抽屉。先选一个小区域整理，观察拿取是否顺手，再调整分区。保持一个方便执行的习惯，比一次整理所有空间更容易坚持。';
const analysis={summary:'先说明整理顺序。',tone:['清楚'],structure:['清点再分类'],strengths:['操作明确'],avoid:['不要夸大'],topicAngles:['日常收纳'],evidence:[{quote:'先清点桌面上每天会用到的东西',point:'给出第一步'}]};
function fixture(t,count=28){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-all-')),previous=new Set(process.listeners('exit'));
 const profile={id:profileId,name:'全量测试账号',url,posts:Array.from({length:count},(_,i)=>({id:String(i+100),url:'https://www.douyin.com/video/'+(i+100),profileId,author:'全量测试账号',title:'作品'+(i+1),caption:sample})),discovery:{complete:true,reason:'已到末尾',discoveredCount:count,reportedCount:count,pages:3}};
 const browser={collectProfile:async(_url,options)=>{assert.equal(options.scope,'all');await options.onPage(profile);return profile;}};
 const s=createService(root,undefined,{videoParserBrowser:browser}),d=s.store.draft();d.brain={url,mode:'deep',profileSource:'caption',profileScope:'all'};d.sourceText='保留';s.store.save();
 const listener=process.listeners('exit').find(fn=>!previous.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 let calls=0;s.providers.text=async()=>{calls++;return {text:JSON.stringify(analysis)};};
 return {s,d,profile,browser,root,calls:()=>calls};
}
test('全量28条逐批分析，超过6条且每条都进分析证据',async t=>{
 const {s,d,calls}=fixture(t);const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.brain.sources.length,28);assert.equal(calls(),3);assert.equal(r.brain.collection.complete,true);assert.equal(r.brain.collection.analysisComplete,true);assert.equal(r.brain.collection.analysisBatchCount,3);assert.equal(r.brain.analysisBatches.length,3);assert.equal(new Set(r.brain.analysisBatches.flatMap(b=>b.segments.map(s=>s.sourceIndex))).size,28);assert.equal(s.store.draft(d.id).sourceText,'保留');
});
test('页面受限仍保存真实部分结果，不称整账号完成',async t=>{
 const {s,d,profile}=fixture(t,8);profile.discovery={complete:false,reason:'平台要求登录查看更多',reportedCount:48,discoveredCount:8,pages:2};const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.brain.sources.length,8);assert.equal(r.brain.collection.complete,false);assert.equal(r.brain.collection.analysisComplete,true);assert.equal(r.brain.collection.discovery.reportedCount,48);
});
test('全量包含短配文，空配文和截断项独立记失败且不冒充完整',async t=>{
 const {s,d,profile}=fixture(t,5);profile.posts[1].caption='小猫';profile.posts[2].caption='';profile.posts[3].captionTruncated=true;const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.brain.collection.attemptedCount,5);assert.equal(r.brain.sources.length,3);assert.equal(r.brain.collection.failed.length,2);assert.equal(r.brain.collection.complete,false);assert.equal(r.brain.sources[1].text,'小猫');
});
test('30000字以上通过分批覆盖所有文字，长单条及表情不截断',async t=>{
 const {s,d,profile}=fixture(t,5);profile.posts=profile.posts.map(p=>({...p,caption:sample.repeat(80)+'🐈结尾'}));const r=await s.invoke('brainStudy',{id:d.id});assert(r.brain.sampleText.length>30000);assert(r.brain.collection.complete);const chunks=batches(r.brain.sources);for(const [i,source] of r.brain.sources.entries()){const segments=chunks.flatMap(c=>c.segments.filter(s=>s.sourceIndex===i));assert.equal(segments.map(s=>source.text.slice(s.start,s.end)).join(''),source.text);}assert(chunks.every(c=>c.text.length<=10000));
});
test('第二批模型失败后断点重试只调用余下批次',async t=>{
 const {s,d}=fixture(t,28);let calls=0;s.providers.text=async()=>{calls++;if(calls===2)throw Error('模型暂时离线');return {text:JSON.stringify(analysis)};};await assert.rejects(s.invoke('brainStudy',{id:d.id}),/离线/);assert.equal(s.store.data.brains.length,0);const first=s.store.data.runs[0];assert.equal(first.checkpoint.profileCollection.samples.length,28);assert.equal(first.checkpoint.profileAnalyses.length,1);assert.equal(JSON.parse(fs.readFileSync(s.store.file,'utf8')).runs[0].checkpoint.profileAnalyses.length,1);
 // 模拟程序退出后的检查点恢复，不依赖内存中的失败对象。
 first.status='interrupted';delete first.failureOutput;const r=await s.invoke('brainStudy',{id:d.id});assert.equal(calls,4);assert.equal(r.evidence.profileAnalyses[0].reusedRunId,first.id);assert(r.brain.collection.complete);
});
test('发现过程中取消保留作品清单，不能写入档案',async t=>{
 const {s,d,browser,profile}=fixture(t);browser.collectProfile=async(_url,{onPage,signal})=>{await onPage(profile);s.runtime.cancel(s.store.data.runs[0].id);signal.throwIfAborted();};await assert.rejects(s.invoke('brainStudy',{id:d.id}));assert.equal(s.store.data.runs[0].status,'cancelled');assert.equal(s.store.data.runs[0].checkpoint.profileCollection.discoveredPosts.length,28);assert.equal(s.store.data.brains.length,0);
});

test('连续发布文案采集期间接受事件循环中的停止请求',async t=>{
 const {s,d}=fixture(t,44);const pending=s.invoke('brainStudy',{id:d.id});
 setImmediate(()=>s.runtime.cancel(s.store.data.runs[0].id));
 await assert.rejects(pending);const run=s.store.data.runs[0];
 assert.equal(run.status,'cancelled');assert.equal(run.checkpoint.profileCollection.discoveredPosts.length,44);
 assert(run.checkpoint.profileCollection.attemptedCount<44);assert.equal(s.store.data.brains.length,0);
});
test('全量不接受模型伪造摘录，旧成功批次保存用于重试',async t=>{
 const {s,d}=fixture(t);s.providers.text=async()=>({text:JSON.stringify({...analysis,evidence:[{quote:'凭空捏造不在原文的摘录',point:'不存在'}]})});await assert.rejects(s.invoke('brainStudy',{id:d.id}),/摘录不在原样本/);assert.equal(s.store.data.brains.length,0);assert.equal(s.store.data.runs[0].checkpoint.profileCollection.samples.length,28);
});
test('外部采集桥没有全量契约时拒绝伪装全量',async t=>{
 const {s,d}=fixture(t);s.providers.config().brainUrl='https://example.invalid/brain';let calls=0;s.providers.bridge=async()=>{calls++;};await assert.rejects(s.invoke('brainStudy',{id:d.id}),/全量覆盖契约/);assert.equal(calls,0);
});
test('按真实本地字节预算分批，不能仅按中文字符数判定容量',async t=>{
 const {s,d,profile}=fixture(t,4);Object.assign(s.providers.config(),{textContextTokens:32768,textMaxTokens:8192});profile.posts=profile.posts.map(p=>({...p,caption:sample.repeat(110)}));let calls=0;
 s.providers.text=async(system,user)=>{assert(Buffer.byteLength(system+user)+8192+512<=32768);calls++;return {text:JSON.stringify(analysis)};};const r=await s.invoke('brainStudy',{id:d.id});assert(calls>4);assert(r.brain.collection.complete);
});
test('素材异步核验期间编辑输入时最终提交再次保护草稿',async t=>{
 const {s,d}=fixture(t,4);s.brains.account.unchanged=async()=>{s.store.draft(d.id).brain.url='https://www.douyin.com/user/other';return true;};const r=await s.invoke('brainStudy',{id:d.id});assert(r.stale);assert.equal(s.store.data.brains.length,0);assert(s.store.draft(d.id).brain.url.endsWith('other'));
});
test('同草稿已有档案重学与新账号学习不能并发提交',async t=>{
 const {s,d}=fixture(t,4);const b=(await s.invoke('brainStudy',{id:d.id})).brain;s.store.draft(d.id).brain.sampleText='';let resolve;s.brains.account.unchanged=()=>new Promise(r=>resolve=r);const pending=s.invoke('brainStudy',{id:d.id,brainId:b.id});while(!resolve)await new Promise(r=>setTimeout(r,1));await assert.rejects(s.invoke('brainStudy',{id:d.id}),/正在处理/);resolve(true);await pending;
});
test('全账号分析后的创作输入受字节预算限制，手工样本不沿用全量声明',async t=>{
 const {creationContext}=require('../server/brain-account-analysis.cjs');const {s,d,profile}=fixture(t,4);profile.posts.forEach(p=>p.caption=sample.repeat(80));const b=(await s.invoke('brainStudy',{id:d.id})).brain;const ctx=creationContext(b,{textContextTokens:32768,textMaxTokens:8192});assert(Buffer.byteLength(ctx)<10500);assert.match(ctx,/原文摘录/);s.store.draft(d.id).brain.sampleText=sample;const r=await s.invoke('brainStudy',{id:d.id,brainId:b.id});assert.equal(r.brain.collection,undefined);assert.equal(r.brain.analysisBatches,undefined);
});
