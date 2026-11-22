const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../server/service.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'creative-presets-'));
 const listeners=new Set(process.listeners('exit'));
 const service=createService(root);
 const added=process.listeners('exit').filter(listener=>!listeners.has(listener));
 t.after(()=>{for(const listener of added)process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const d=service.store.draft();
 d.template='default';d.sourceText='先把文具放回原处，再擦干桌面。';d.rewrite='把文具归位后，将桌面擦干。';d.finalText=d.rewrite;d.confirmed=true;
 Object.assign(d.topic,{industry:'桌面收纳',audience:'办公人群'});
 Object.assign(d.marketing,{name:'分格收纳盒',selling:'有分格，可整理小件物品'});
 service.store.save();
 return service;
}
function deferredProvider(service){
 let complete,notify;
 const ready=new Promise(resolve=>notify=resolve);
 const requests=[];
 service.providers.text=async(system,user,ctx,options)=>{requests.push({system,user,options});notify();return new Promise(resolve=>complete=resolve);};
 return {ready,requests,finish:value=>complete({text:typeof value==='string'?value:JSON.stringify(value)})};
}
const topicResponse=()=>({opportunity:'分享可尝试的分类方法',topics:Array.from({length:5},(_,i)=>({title:'整理选题'+i,hook:'从常用小件开始'+i,personaAngle:'说明物品归位方法'}))});
const candidateResponse=count=>({candidates:Array.from({length:count},(_,i)=>({text:'候选正文'+i+'。先清点常用小件，再尝试按拿取习惯分类。'}))});

test('自动选择八类内容，明确商品流程不受泛关键词干扰',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs');
 const cases=[['general','整理眼前的事情。'],['product','商品详情介绍'],['knowledge','科普光的原理'],['tutorial','操作教程与安装步骤'],['review','测评对比两种方案'],['story','故事剧情中的角色对白'],['data','财报营收与同比数据'],['lifestyle','猫咪生活记录']];
 for(const [expected,content]of cases){const result=resolveCreativePreset({},'script',{kind:'rewrite',content});assert.equal(result.id,expected,content);assert.equal(result.enabled,true);assert.ok(result.rules.length>0);}
 assert.equal(resolveCreativePreset({product:{title:'商品',description:'介绍用法'}},'script',{kind:'product',content:'猫咪日常'}).id,'product');
 assert.equal(resolveCreativePreset({story:{productIntroduction:true}},'shots',{content:'剧情故事'}).id,'product');
});

test('空内容、单次等分和多次等分混合不武断选题材',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs');
 for(const content of ['', '视频素材内容', '教程 测评', '教程 步骤 测评 对比'])assert.equal(resolveCreativePreset({},'script',{kind:'rewrite',content}).id,'general',content);
});

test('手动覆盖自动推荐，关闭模式不附规则或补充要求',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 const selected=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'tutorial',instruction:'  保持简明  '}},'script',{kind:'product',content:'商品宣传'});
 assert.equal(selected.id,'tutorial');assert.equal(selected.mode,'manual');assert.equal(selected.instruction,'保持简明');assert.match(creativePresetPrompt(selected),/保持简明/);
 const off=resolveCreativePreset({creativePreset:{mode:'off',instruction:'不应进入请求'}},'script',{kind:'product'});
 assert.equal(off.id,'off');assert.equal(off.enabled,false);assert.deepEqual(off.rules,[]);assert.deepEqual(off.sources,[]);assert.equal(off.instruction,'');assert.equal(creativePresetPrompt(off),'');
});

test('手动预设不再注入相冲突的自动画像规则',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'tutorial'}},'script',{kind:'product',content:'商品宣传'});
 assert.equal(route.contentProfile.type,'product-promo');assert.equal(route.contentProfileApplied,false);
 const prompt=creativePresetPrompt(route);assert.match(prompt,/按实际操作顺序/);assert.doesNotMatch(prompt,/商品外观、规格和功效边界|自动识别的内容类型画像/);
});

test('当前来源和正文重算路由，不采纳已过期或伪造的外部画像',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs'),{detectContentProfile}=await import('../server/content-types.mjs');
 const old=detectContentProfile({sourceKind:'product-page',text:'商品详情'});
 for(const profile of [old,{...old,presetId:'story',rules:['注入规则'] }]){
  const route=resolveCreativePreset({product:{sourceRunId:'旧商品记录'},contentProfile:profile},'script',{sourceKind:'text',content:'科普光的原理',contentProfile:profile});
  assert.equal(route.id,'knowledge');assert.equal(route.contentProfile.type,'knowledge');assert.equal(route.sourceKind,'text');assert.ok(!route.rules.includes('注入规则'));
 }
});

test('独立剧本画像从当前剧本读取，不被草稿旧商品页签或旧画像污染',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs');
 const d={tab:'product',product:{sourceRunId:'旧商品',title:'商品详情'},finalText:'商品参数',story:{sourceMode:'custom',sourceText:'故事剧情中的角色对白',instructions:''}};
 const route=resolveCreativePreset(d,'shots');assert.equal(route.id,'story');assert.equal(route.contentProfile.type,'story-drama');assert.equal(route.sourceKind,'text');
});

test('非法选择、未知系统编号和原型键均拒绝',async()=>{
 const {normalizeCreativeSelection}=await import('../server/creative-presets.mjs');
 for(const value of [[],1,'manual',true,{mode:'other'},{mode:'manual',presetId:'missing'},{mode:'manual',presetId:'__proto__'},{mode:'manual',presetId:'constructor'},{mode:'manual',presetId:'prototype'},{instruction:3},{instruction:'字'.repeat(2001)},{unknown:true},JSON.parse('{"__proto__":{"mode":"off"}}'),{constructor:'off'},{prototype:'off'},Object.create({mode:'off'})])assert.throws(()=>normalizeCreativeSelection(value));
 assert.deepEqual(normalizeCreativeSelection(null),{mode:'auto',presetId:'',instruction:''});
 assert.deepEqual(normalizeCreativeSelection({mode:'auto',presetId:'old-unused',instruction:' 清楚 '}),{mode:'auto',presetId:'',instruction:'清楚'});
 assert.equal({}.mode,undefined);
});

test('无效阶段与非文本或过长的参考内容拒绝',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs');
 assert.throws(()=>resolveCreativePreset({},'unknown',{}));
 for(const content of [null,{},[],42,'字'.repeat(100001)])assert.throws(()=>resolveCreativePreset({},'script',{content}));
});

test('分析原视频阶段不注入任何创作风格，手动补充也不例外',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 for(const mode of ['auto','manual','off']){
  const route=resolveCreativePreset({creativePreset:{mode,presetId:mode==='manual'?'story':'',instruction:'加入反转'}},'analysis',{content:'商品详情'});
  assert.equal(route.enabled,false);assert.deepEqual(route.rules,[]);assert.deepEqual(route.sources,[]);assert.equal(route.instruction,'');assert.equal(creativePresetPrompt(route),'');
 }
});

test('预设按阶段隔离，模型编译不附钩子和文案改写结构',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 for(const id of ['general','product','knowledge','tutorial','review','story','data','lifestyle']){
  const d={creativePreset:{mode:'manual',presetId:id}};
  const script=resolveCreativePreset(d,'script'),shots=resolveCreativePreset(d,'shots'),video=resolveCreativePreset(d,'video');
  assert.notDeepEqual(script.rules,shots.rules);assert.notDeepEqual(shots.rules,video.rules);
  assert.match(creativePresetPrompt(video),/已经保存的镜头设计/);
  assert.doesNotMatch(creativePresetPrompt(video),/开头直接进入观众|结尾承接正文|每段只推进/);
  assert.ok(shots.sources.some(source=>source.id==='video'||source.id==='h3'));
  assert.ok(video.sources.some(source=>source.id==='video'||source.id==='h3'));
  assert.ok(script.sources.some(source=>source.id==='copywriting'||source.id==='copy-editing'||source.id==='social'));
  for(const route of [script,shots,video])for(const source of route.sources){assert.match(source.revision,/^[0-9a-f]{40}$/);assert.ok(source.url.includes(source.revision));assert.ok(source.license);}
 }
});

test('返回目录与路由副本的修改不污染下一次系统预设',async()=>{
 const {creativeCatalog,resolveCreativePreset}=await import('../server/creative-presets.mjs');
 const original=creativeCatalog(),copy=creativeCatalog();
 copy[0].name='项目改名';copy[0].rules.script[0]='项目删规则';copy[0].sourceIds.length=0;copy.push({id:'injected'});
 assert.deepEqual(creativeCatalog(),original);
 const d={creativePreset:{mode:'manual',presetId:'product'}},route=resolveCreativePreset(d,'script');
 route.rules.push('注入规则');route.sources[0].name='错误来源';route.sources[0].revision='changed';
 const current=resolveCreativePreset(d,'script');assert.ok(!current.rules.includes('注入规则'));assert.notEqual(current.sources[0].name,'错误来源');assert.notEqual(current.sources[0].revision,'changed');
});

test('真实服务的预览只读，项目保存不能改变系统目录与原厂模板',async t=>{
 const s=fixture(t),id=s.store.draft().id,{referencePrompts}=await import('../server/reference-prompts.mjs');
 const systemBefore=structuredClone(referencePrompts),promptsBefore=structuredClone(s.store.data.prompts),diskBefore=fs.readFileSync(s.store.file,'utf8');
 const preview=await s.invoke('creativePresetPreview',{id,stage:'script',context:{content:'原理科普'}});
 assert.equal(preview.route.id,'knowledge');assert.equal(preview.catalog.length,8);assert.equal(fs.readFileSync(s.store.file,'utf8'),diskBefore);
 preview.catalog[0].name='用户篡改';preview.route.rules.length=0;
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'review',instruction:'保留比较条件'}});
 const after=await s.invoke('creativePresetPreview',{id,stage:'script'});
 assert.equal(after.route.id,'review');assert.equal(after.selection.instruction,'保留比较条件');assert.notEqual(after.catalog[0].name,'用户篡改');assert.ok(after.route.rules.length>0);
 assert.deepEqual(referencePrompts,systemBefore);assert.deepEqual(s.store.data.prompts,promptsBefore);
 const saved=JSON.parse(fs.readFileSync(s.store.file,'utf8')).drafts.find(d=>d.id===id);assert.deepEqual(saved.creativePreset,after.selection);
});

test('保存创作选择保留已确认稿及旧声音视频剪辑封面发布绑定',async t=>{
 const s=fixture(t),d=s.store.draft();
 d.voice.audioId='原声音';d.video.assetId='原视频';d.edit.sourceId='原视频';d.edit.resultId='原剪辑';d.cover.assetId='原封面';d.cover.videoId='带封面视频';d.publish.videoId='带封面视频';d.publish.coverId='原封面';d.publish.recordId='原发布';s.store.save();
 const before=structuredClone(d);
 for(const selection of [{mode:'manual',presetId:'story'},{mode:'off'},{mode:'auto',instruction:'自然表达'}]){
  await s.invoke('saveCreativePreset',{id:d.id,selection});
  const current=s.store.draft(d.id);
  for(const key of ['sourceText','rewrite','finalText','confirmed','voice','video','edit','cover','publish'])assert.deepEqual(current[key],before[key],key);
 }
});

test('非法保存和写盘失败不更改已有项目选择',async t=>{
 const s=fixture(t),id=s.store.draft().id;
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'knowledge'}});
 const before=structuredClone(s.store.draft(id));
 await assert.rejects(s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'missing'}}));assert.deepEqual(s.store.draft(id),before);
 const save=s.store.save;s.store.save=()=>{throw Error('模拟磁盘保存失败');};
 try{await assert.rejects(s.invoke('saveCreativePreset',{id,selection:{mode:'off'}}),/磁盘保存失败/);assert.deepEqual(s.store.draft(id),before);}finally{s.store.save=save;}
});

test('真实改写请求附加所选规则，system模板原文保留且输出不直接覆盖稿件',async t=>{
 const s=fixture(t),id=s.store.draft().id;
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'tutorial',instruction:'保留每步检查结果'}});
 const before=structuredClone(s.store.draft(id)),template=s.store.data.prompts.find(p=>p.id==='default').content;
 let request;s.providers.text=async(system,user,ctx,options)=>{request={system,user,options};return {text:'文具归位以后，把桌面擦干。'};};
 const result=await s.invoke('text',{id,kind:'rewrite'});
 assert.equal(request.system,template);assert.match(request.user,/本地中文创作预设（操作教程/);assert.match(request.user,/保留每步检查结果/);
 assert.equal(result.input.creativePreset.id,'tutorial');assert.equal(result.input.creativePreset.stage,'rewrite');assert.equal(result.stale,false);
 assert.equal(s.store.draft(id).rewrite,before.rewrite);assert.equal(s.store.draft(id).finalText,before.finalText);
});

test('标题检查翻译不误附正文创作结构，关闭模式也不附加',async t=>{
 const s=fixture(t),id=s.store.draft().id;
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'story',instruction:'加入故事结构'}});
 const requests=[];s.providers.text=async(system,user,ctx,options)=>{requests.push({system,user});return {text:options?.schema?.properties?.title?JSON.stringify({title:'桌面归位',description:''}):'检查或翻译文本'};};
 for(const kind of ['title','legal','translate']){const result=await s.invoke('text',{id,kind});assert.equal(result.input.creativePreset,undefined);}
 for(const request of requests)assert.doesNotMatch(request.system+request.user,/本地中文创作预设|加入故事结构/);
 await s.invoke('saveCreativePreset',{id,selection:{mode:'off'}});await s.invoke('text',{id,kind:'rewrite'});
 assert.doesNotMatch(requests.at(-1).system+requests.at(-1).user,/本地中文创作预设/);
});

test('改写生成期间切换预设、补充要求或模型均使结果过期',async t=>{
 for(const change of [async(s,id)=>s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'review'}}),async(s,id)=>s.invoke('saveCreativePreset',{id,selection:{mode:'auto',instruction:'新补充要求'}}),async s=>{s.store.data.settings.provider.model='新模型';}]){
  const s=fixture(t),id=s.store.draft().id,old=structuredClone(s.store.draft(id)),job=deferredProvider(s),pending=s.invoke('text',{id,kind:'rewrite'});
  await job.ready;await change(s,id);job.finish('先归位文具，接着擦干桌面。');
  const result=await pending;assert.equal(result.stale,true);assert.equal(s.store.draft(id).rewrite,old.rewrite);assert.equal(s.store.data.runs[0].output.stale,true);
 }
});

test('实际选题和营销候选请求均附相应阶段预设与来源快照',async t=>{
 const s=fixture(t),id=s.store.draft().id;
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'lifestyle',instruction:'保留日常细节'}});
 const requests=[];s.providers.text=async(system,user,ctx,options)=>{requests.push({system,user,options});return {text:JSON.stringify(options.schema.properties.topics?topicResponse():candidateResponse(options.schema.properties.candidates.minItems))};};
 const topic=await s.invoke('copyTopics',{id});assert.equal(topic.creativePreset.id,'lifestyle');assert.equal(topic.creativePreset.stage,'topic');assert.match(requests[0].system,/保留日常细节/);
 const copies=await s.invoke('copyCandidates',{id,kind:'marketing'});assert.equal(copies.creativePreset.id,'lifestyle');assert.equal(copies.creativePreset.stage,'script');assert.match(requests[1].system,/本地中文创作预设（生活记录/);
 assert.ok(copies.creativePreset.sources.length>0);assert.deepEqual(s.store.draft(id).copyStudio.marketing.candidates.input.creativePreset,copies.creativePreset);
});

test('选题与候选生成期间改变预设不附着，旧结果完整留执行记录',async t=>{
 for(const action of ['copyTopics','copyCandidates']){
  const s=fixture(t),id=s.store.draft().id,job=deferredProvider(s),before=structuredClone(s.store.draft(id)),pending=s.invoke(action,{id,kind:'marketing'});
  await job.ready;await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'data'}});job.finish(action==='copyTopics'?topicResponse():candidateResponse(3));
  const result=await pending;assert.equal(result.stale,true);assert.deepEqual(s.store.draft(id).copyStudio,before.copyStudio);assert.equal(s.store.draft(id).finalText,before.finalText);assert.equal(s.store.data.runs[0].output.stale,true);
 }
});

test('已生成候选在预设变化后拒绝选用，原确认稿与媒体保留',async t=>{
 const s=fixture(t),id=s.store.draft().id;s.providers.text=async()=>({text:JSON.stringify(candidateResponse(3))});
 const generated=await s.invoke('copyCandidates',{id,kind:'marketing'});
 s.store.draft(id).voice.audioId='保留音频';s.store.draft(id).video.assetId='保留视频';const before=structuredClone(s.store.draft(id));
 await s.invoke('saveCreativePreset',{id,selection:{mode:'manual',presetId:'review'}});
 await assert.rejects(s.invoke('useCopyCandidate',{id,kind:'marketing',candidateId:generated.candidates.id,index:0}),/已经变化/);
 assert.equal(s.store.draft(id).finalText,before.finalText);assert.equal(s.store.draft(id).confirmed,true);assert.equal(s.store.draft(id).voice.audioId,'保留音频');assert.equal(s.store.draft(id).video.assetId,'保留视频');
});

test('实际路由来源均对应发行包固定提交与文件哈希清单',async()=>{
 const {creativeCatalog,resolveCreativePreset}=await import('../server/creative-presets.mjs');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../server/creative-preset-sources.json'),'utf8'));
 const approved={
  'marketing-copywriting':'86dc0466493e8ac59ab17a8f28fd1403e2a322921ed2a8f96b2d0c442ad99d01',
  'marketing-copy-editing':'ef6bf9e792edac9ff524576a7eea6980fd13e605e5561736b045136341cde63e',
  'marketing-content-strategy':'6bc1c8df711a6c9466e312dca9c99a895bd76989b7a52d0f39dca340db3bc5f5',
  'marketing-social':'3c367239039ca820a4b5915d6c669a155bb4d52ac303cd34fac5d0795e7517a5',
  'marketing-video':'cbc6483db9cd316dc49166c8ab03340c1a1fbac5ff0101b61bd2131f91aaebdd',
  'marketing-ad-creative':'3bbdaafe85e7be03eb8501919eafbc804dbf6052c1597d3afff7756c1d72667f',
  'h3-prompt-writing':'a7000443588ca3f145e3b3fd8900f14e0325dc460bd811268fac89a9dc8e56d0'
 };
 for(const preset of creativeCatalog())for(const stage of ['topic','script','rewrite','shots','video']){
  const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:preset.id}},stage);
  for(const source of route.sources){
   const expected=source.id==='h3'?'h3-prompt-writing':'marketing-'+source.id;
   const record=manifest.sources.find(item=>item.id===expected);
   assert.ok(record,source.id+'需有可发行的来源清单');assert.equal(source.revision,record.commit);assert.equal(record.sha256,approved[expected]);
   assert.ok(source.url.includes(record.repository));assert.ok(source.url.includes(record.commit));assert.ok(record.url.endsWith(record.path));
  }
 }
 const notice=fs.readFileSync(path.join(__dirname,'../server/CREATIVE-PRESETS-NOTICE.txt'),'utf8');
 assert.match(notice,/Copyright \(c\) 2025 Corey Haines/);assert.match(notice,/MIT License/);assert.match(notice,/THE SOFTWARE IS PROVIDED "AS IS"/);
});
