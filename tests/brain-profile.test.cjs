const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createService}=require('./support/licensed-service.cjs');
const {profileSnapshot,normalizeProfile,verifyIdentity}=require('../electron/douyin-profile.cjs');
const {VideoParserBrowser}=require('../electron/video-parser-browser.cjs');
const sample='收纳并不是把物品全部藏起来。先清点桌面上每天会用到的东西，再按使用频率分类。常用的放在手边，不常用的放进抽屉。先选一个小区域整理，观察拿取是否顺手，再调整分区。保持一个方便执行的习惯，比一次整理所有空间更容易坚持。';
const profileId='MS4w_Test',profileUrl='https://www.douyin.com/user/'+profileId;
const profile=()=>({id:profileId,name:'测试账号',url:profileUrl,visibleCount:8,loginLimited:true,posts:Array.from({length:8},(_,i)=>({id:String(100+i),title:'作品'+i,url:'https://www.douyin.com/video/'+(100+i),profileId,author:'测试账号'}))});
const analysis={summary:'先澄清误区，再给出分步操作。',tone:['清晰'],structure:['澄清误区'],strengths:['具体操作'],avoid:['夸大'],topicAngles:['日常习惯'],evidence:[{quote:'先选一个小区域整理',point:'从小区域开始'}]};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-profile-')),previous=new Set(process.listeners('exit'));
 const browser={collectProfile:async()=>profile()},s=createService(root,undefined,{videoParserBrowser:browser});
 const listener=process.listeners('exit').find(fn=>!previous.has(fn));t.after(()=>{process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const d=s.store.draft();d.brain.url='查看TA的更多作品 https://v.douyin.com/account/';d.brain.mode='shallow';d.sourceText='保留原文案';s.store.save();
 s.media.probe=async()=>({format:{duration:30},streams:[{codec_type:'audio'}]});s.providers.text=async()=>({text:JSON.stringify(analysis)});
 let calls=0;s.extractReferenceSource=async({sourceUrl,profileIdentity},ctx)=>{calls++;assert.equal(profileIdentity,profileId);const file=path.join(root,'source-'+calls+'.wav');fs.writeFileSync(file,'媒体测试夹具'+calls);const a=s.store.addAsset(file,{type:'audio',duration:30});ctx.onReferenceAsset(a.id);return {text:sample,engine:'fixture-asr',segments:[{start:0,end:30,text:sample}],linkSource:{url:sourceUrl,assetId:a.id,sha256:crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex'),identity:{profileId,videoId:sourceUrl.split('/').at(-1)}}};};
 return {s,d,browser,calls:()=>calls};
}
test('公开作品区域过滤推荐、图文、作者不匹配与重复链接',()=>{
 const snap={url:profileUrl,name:'测试账号',listPresent:true,loginLimited:true,posts:[{url:'https://www.douyin.com/video/123',alt:'测试账号：真实标题',title:'真实标题'},{url:'https://www.douyin.com/video/123',alt:'测试账号：重复'},{url:'https://www.douyin.com/video/124',alt:'其他人：推荐'},{url:'https://www.douyin.com/note/125',alt:'测试账号：图文'}]};
 assert.deepEqual(normalizeProfile(snap,profileUrl).posts.map(p=>p.id),['123']);
 assert.throws(()=>normalizeProfile(snap,profileUrl+'other'),/不一致/);assert.throws(()=>normalizeProfile({...snap,posts:[]},profileUrl),/未返回/);
 assert.throws(()=>normalizeProfile({...snap,url:'https://www.douyin.com/video/123'},'https://v.douyin.com/short/'),/单条作品/);
 assert.match(profileSnapshot.toString(),/root\?\.querySelector\('\[data-e2e="user-post-list"\]'\)/);
});
test('详情作者必须唯一且与主页一致，地址切换不能接受',()=>{
 const v='https://www.douyin.com/video/123';assert.equal(verifyIdentity({url:v,authors:[profileUrl,profileUrl]},profileId,v).videoId,'123');
 for(const snap of [{url:v,authors:[]},{url:v,authors:[profileUrl+'other']},{url:v,authors:[profileUrl,profileUrl+'other']},{url:'https://www.douyin.com/video/124',authors:[profileUrl]}])assert.throws(()=>verifyIdentity(snap,profileId,v));
});
test('共享浏览器拒绝并发导航，结束和异常均释放占用',async()=>{
 const b=new VideoParserBrowser({});let done;const pending=b.exclusive(()=>new Promise(r=>done=r));await assert.rejects(b.exclusive(async()=>{}),/另一条链接/);done();await pending;await assert.rejects(b.exclusive(async()=>{throw Error('采集失败');}),/采集失败/);assert.equal(await b.exclusive(async()=>42),42);
});
test('无外部接口时本地公开作品走真实提取契约，来源档案与原草稿均正确',async t=>{
 const {s,d,calls}=fixture(t),r=await s.invoke('brainStudy',{id:d.id});assert.equal(calls(),3);assert.equal(r.brain.sources.length,3);assert.equal(r.brain.collection.successCount,3);assert.equal(r.brain.collection.complete,true);assert.equal(r.brain.sources[0].media.transcription.text,sample);assert.equal(r.brain.url,profileUrl);assert.equal(s.store.draft(d.id).sourceText,'保留原文案');assert.match(s.store.draft(d.id).brain.url,/查看TA/);assert.equal(s.references.source.locks.size,0);assert.equal((await s.invoke('state')).brainCollection.local,true);await assert.rejects(s.invoke('deleteAsset',{id:r.brain.sources[0].assetId}),/引用/);
});
test('部分作品失败则尝试后续作品，数量不足仍准确显示部分采样',async t=>{
 const {s,d}=fixture(t),original=s.extractReferenceSource;s.extractReferenceSource=async(args,ctx)=>{if(!args.sourceUrl.endsWith('100'))throw Error('平台未返回音轨');return original(args,ctx);};const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.brain.collection.complete,false);assert.equal(r.brain.collection.successCount,1);assert.equal(r.brain.collection.failed.length,4);assert.equal(r.brain.collection.attemptedCount,5);
});
test('全失败及只有标题无媒体证据不能保存已学习档案',async t=>{
 const {s,d}=fixture(t);s.extractReferenceSource=async()=>({text:sample});await assert.rejects(s.invoke('brainStudy',{id:d.id}),/有效文案不足/);assert.equal(s.store.data.brains.length,0);assert.equal(s.store.data.runs[0].failureOutput.profileCollection.failed.length,5);assert.equal(s.references.source.locks.size,0);
});
test('分析失败后的重试复用哈希校验通过的转写，不重复调用ASR',async t=>{
 const {s,d,calls}=fixture(t);s.providers.text=async()=>{throw Error('模型离线');};await assert.rejects(s.invoke('brainStudy',{id:d.id}),/模型离线/);assert.equal(calls(),3);s.providers.text=async()=>({text:JSON.stringify(analysis)});const r=await s.invoke('brainStudy',{id:d.id});assert.equal(calls(),3);assert.ok(r.brain.sources.every(row=>row.reusedRunId));
});
test('取消时保留已提取证据、释放锁并禁止写入档案',async t=>{
 const {s,d}=fixture(t),original=s.extractReferenceSource;s.extractReferenceSource=async(args,ctx)=>{const r=await original(args,ctx);s.runtime.cancel(s.store.data.runs[0].id);return r;};await assert.rejects(s.invoke('brainStudy',{id:d.id}));assert.equal(s.store.data.brains.length,0);assert.equal(s.store.data.runs[0].status,'cancelled');assert.equal(s.references.source.locks.size,0);
});
test('采集后输入变化或模型配置变化均只留执行证据',async t=>{
 const {s,d}=fixture(t);s.providers.text=async()=>{s.providers.config().asrLanguage='en';return {text:JSON.stringify(analysis)};};const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.stale,true);assert.equal(s.store.data.brains.length,0);assert.equal(s.references.source.locks.size,0);
});
test('深度学习采样6条并保持音轨分析边界',async t=>{
 const {s,d,calls}=fixture(t);d.brain.mode='deep';const r=await s.invoke('brainStudy',{id:d.id});assert.equal(calls(),6);assert.equal(r.brain.collection.requestedCount,6);assert.match(r.brain.collection.limitation,/未分析视频画面/);assert.equal(r.evidence.analysisBasis.source,'audio-transcription');
});
test('重试优先新作品和已有成功样本，保留每次真实尝试清单',async t=>{
 const {s,d}=fixture(t);d.brain.mode='deep';const original=s.extractReferenceSource;s.extractReferenceSource=async(args,ctx)=>{if(!args.sourceUrl.endsWith('107'))throw Error('没有识别到语音');return {...await original(args,ctx),text:'有效短句不足二十字'};};await assert.rejects(s.invoke('brainStudy',{id:d.id}),/不足80/);
 const next=profile();next.posts.push({id:'200',title:'新公开作品',url:'https://www.douyin.com/video/200',profileId,author:'测试账号'});s.profileBrowser.collectProfile=async()=>next;s.extractReferenceSource=original;
 const r=await s.invoke('brainStudy',{id:d.id});assert.equal(r.brain.collection.selectedUrls[0],'https://www.douyin.com/video/200');assert.equal(r.brain.collection.successCount,6);
});
test('显式选择发布文案时读取真实配文，不调用ASR也不伪造音轨来源',async t=>{
 const {s,d,calls}=fixture(t);d.brain.profileSource='caption';const p=profile();p.posts=p.posts.map(post=>({...post,caption:sample}));s.profileBrowser.collectProfile=async()=>p;let prompt;s.providers.text=async(_system,user)=>{prompt=user;return {text:JSON.stringify(analysis)};};const r=await s.invoke('brainStudy',{id:d.id});assert.equal(calls(),0);assert.equal(r.brain.collection.basis,'caption');assert.equal(r.brain.collection.successCount,3);assert.equal(r.brain.sources[0].kind,'profile-caption');assert.equal(r.brain.sources[0].media,undefined);assert.equal(r.evidence.analysisBasis.source,'published-caption');assert.match(prompt,/不是视频中的口播文字/);assert.match(r.brain.collection.limitation,/不是视频口播转写/);
});
test('发布文案不足时不能用音轨或标题占位生成伪档案',async t=>{
 const {s,d,calls}=fixture(t);d.brain.profileSource='caption';await assert.rejects(s.invoke('brainStudy',{id:d.id}),/不足80/);assert.equal(calls(),0);assert.equal(s.store.data.brains.length,0);
});
