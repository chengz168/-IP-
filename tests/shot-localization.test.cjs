const test=require('node:test'),assert=require('node:assert/strict');
const {fingerprint,sourceOf,needsTranslation,localizeShot,translateStoryDesign,translateProductDesign}=require('../server/shot-localization.cjs');
const english=id=>({id,visual:'A blue rod on a white table.',action:'Move left once, then stop.',camera:'Static close shot.',sound:'No music.',selectedImageId:'image',selectedVideoId:'video',images:[{id:'image',inputHash:'image-hash'}],videos:[{id:'video',inputHash:'video-hash'}]});
const chinese=()=>({visual:'蓝色长杆位于白色桌面上。',action:'向左移动一次，然后停止。',camera:'近景固定机位。',sound:'无音乐。'});
function fixture(){
 const draft={id:'draft',story:{revision:4,episodes:[{id:'episode',shots:[english('one'),english('two')]}]},artifacts:{other:'保留'},video:{assetId:'full-video'},voice:{audioId:'voice'},confirmed:true,finalText:'已有文案'};
 const controller=new AbortController(),calls=[];let saves=0;
 const service={store:{draft:()=>draft,save:()=>{saves++;}},stories:{assertMutable:()=>{}},providers:{text:async(system,user,ctx,options)=>{calls.push({system,user:JSON.parse(user),options});return {text:JSON.stringify(chinese())};}}};
 const products={service,locked:async(id,work)=>work(),run:async(type,id,parameters,work)=>work({signal:controller.signal,progress:()=>{}})};
 return {draft,service,products,calls,controller,args:{id:'draft',episodeId:'episode'},get saves(){return saves;}};
}
test('源指纹只随镜头ID和四项设计变化，媒体变化不会使阅读译稿失效',()=>{
 const a=english('a');assert.equal(fingerprint(a),fingerprint({...a,selectedVideoId:'other',duration:3,text:'其他台词'}));assert.notEqual(fingerprint(a),fingerprint({...a,action:'Move right.'}));assert.notEqual(fingerprint(a),fingerprint({...a,id:'b'}));
 assert.equal(needsTranslation('PP材质配蓝杆。'),false);assert.equal(needsTranslation('Static.'),true);assert.equal(needsTranslation(''),false);
});
test('中文内普通英文词组和单词必须翻译，品牌、明确型号与材料缩写保持可读',()=>{
 for(const value of ['一根 teaser wand 位于画面中央。','蓝色rod向左移动。','机位为close-up。','中文里保留 wand。','缓慢 Move left。'])assert.equal(needsTranslation(value),true,value);
 for(const value of ['PP材质搭配LED灯，使用Sony A7M4拍摄。','Nikon Z6-II 位于画面中央。','品牌：Acme 的PP长杆。','Acme品牌型号X2采用ABS。','iPhone 16支持USB-C，重量25 kg。','ComfyUI与MiniMax H3保持原名。'])assert.equal(needsTranslation(value),false,value);
});
test('整集转换原子保存独立译稿，原故事和全部媒体选择逐字保持',async()=>{
 const f=fixture(),before=structuredClone(f.draft),result=await translateStoryDesign(f.products,f.args);assert.equal(result.translated,2);assert.equal(f.saves,1);
 assert.deepEqual(f.draft.story,before.story);assert.deepEqual(f.draft.video,before.video);assert.deepEqual(f.draft.voice,before.voice);assert.equal(f.draft.artifacts.other,'保留');assert.equal(result.qualityAccepted,false);assert.equal(result.evidence.length,2);
 const view=localizeShot(f.draft.story.episodes[0].shots[0],f.draft.artifacts.shotTranslations);assert.equal(view.translated,true);assert.equal(view.visual,chinese().visual);assert.equal(view.selectedVideoId,'video');
});
test('单镜转换不触及同集其他镜头，重复调用直接复用，中文和空字段跳过',async()=>{
 const f=fixture();f.draft.story.episodes[0].shots[1]={id:'two',...chinese(),sound:''};
 const result=await translateStoryDesign(f.products,{...f.args,shotId:'one'});assert.equal(result.translated,1);assert.equal(f.calls.length,1);
 const reused=await translateStoryDesign(f.products,f.args);assert.equal(reused.translated,0);assert.equal(reused.skipped,2);assert.equal(f.calls.length,1);assert.equal(f.saves,1);
});
test('源设计被修改后旧译稿停止显示，原图与视频改变仍可显示同一译稿',async()=>{
 const f=fixture();await translateStoryDesign(f.products,f.args);const shot=f.draft.story.episodes[0].shots[0];shot.selectedImageId='new-image';assert.equal(localizeShot(shot,f.draft.artifacts.shotTranslations).translated,true);shot.camera='Wide shot.';assert.equal(localizeShot(shot,f.draft.artifacts.shotTranslations).translated,false);
});
test('旧缓存残留teaser wand时不显示为有效译稿，原镜头不变且真实模型可重新转换',async()=>{
 const f=fixture(),shot=f.draft.story.episodes[0].shots[0],source=sourceOf(shot),key=shot.id+':'+fingerprint(shot),before=structuredClone(f.draft.story);
 const old={shotId:shot.id,episodeId:'episode',sourceFingerprint:fingerprint(shot),source,translation:{...chinese(),visual:'蓝色teaser wand位于桌面。'}};f.draft.artifacts.shotTranslations={[key]:old};
 assert.equal(localizeShot(shot,f.draft.artifacts.shotTranslations).translated,false);const result=await translateStoryDesign(f.products,{...f.args,shotId:shot.id});assert.equal(result.translated,1);assert.equal(result.skipped,0);assert.equal(f.calls.length,1);assert.equal(localizeShot(shot,f.draft.artifacts.shotTranslations).visual,chinese().visual);assert.deepEqual(f.draft.story,before);
});
test('新模型残留teaser wand明确拒绝且不覆盖旧缓存，失败响应仍可查证',async()=>{
 const f=fixture(),shot=f.draft.story.episodes[0].shots[0],key=shot.id+':'+fingerprint(shot),source=sourceOf(shot);f.draft.artifacts.shotTranslations={[key]:{shotId:shot.id,sourceFingerprint:fingerprint(shot),source,translation:{...chinese(),visual:'原有teaser wand'}}};const before=structuredClone(f.draft.artifacts);
 f.service.providers.text=async()=>({text:JSON.stringify({...chinese(),visual:'一个teaser wand在白桌面上。'})});let error;try{await translateStoryDesign(f.products,{...f.args,shotId:shot.id});}catch(e){error=e;}assert.match(error.message,/英文镜头/);assert.equal(error.evidence.translation.responses.length,1);assert.match(error.evidence.translation.responses[0].response.text,/teaser wand/);assert.deepEqual(f.draft.artifacts,before);assert.equal(f.saves,0);
});
test('末镜格式、中文、字段或类型校验失败时，不保存此前成功的半集译稿',async()=>{
 for(const invalid of ['not-json',{...chinese(),camera:'Still English camera.'},{...chinese(),action:''},{...chinese(),constructor:'危险字段'},{...chinese(),__proto__:'x',evil:'x'},null,{...chinese(),sound:42}]){
  const f=fixture(),before=structuredClone(f.draft);let count=0;f.service.providers.text=async()=>({text:++count===1?JSON.stringify(chinese()):typeof invalid==='string'?invalid:JSON.stringify(invalid)});
  await assert.rejects(translateStoryDesign(f.products,f.args));assert.deepEqual(f.draft,before);assert.equal(f.saves,0);
 }
});
test('原有数字、型号与已中文字段必须保留，不凭翻译接口改剧情',async()=>{
 for(const source of [{action:'Move 2 cm left.'},{visual:'A PP blue rod.'},{visual:'中文原有设计'}]){
  const f=fixture();Object.assign(f.draft.story.episodes[0].shots[0],source);await assert.rejects(translateStoryDesign(f.products,{...f.args,shotId:'one'}),/遗漏|无需翻译/);assert.equal(f.saves,0);
 }
});
test('取消、用户在模型期间改字段或改已有译稿，最终均不写入结果',async()=>{
 for(const change of [f=>f.controller.abort(),f=>f.draft.story.episodes[0].shots[0].action='用户新动作',f=>f.draft.artifacts.shotTranslations={newer:{note:'用户已保存的新译稿'}}]){
  const f=fixture();f.service.providers.text=async()=>{change(f);return {text:JSON.stringify(chinese())};};await assert.rejects(translateStoryDesign(f.products,f.args));assert.equal(f.saves,0);assert.equal(Object.keys(f.draft.artifacts.shotTranslations||{}).includes('one:'+fingerprint(english('one'))),false);
 }
});
test('批量过程中新增或删除镜头会使整个范围过期，不能漏掉新增镜头后报整集完成',async()=>{
 const f=fixture();let count=0;f.service.providers.text=async()=>{if(++count===1)f.draft.story.episodes[0].shots.push(english('three'));return {text:JSON.stringify(chinese())};};await assert.rejects(translateStoryDesign(f.products,f.args),/变化/);assert.equal(f.saves,0);
});
test('保存失败只恢复译稿容器，不覆盖用户同时更新的其他字段',async()=>{
 const f=fixture(),before=structuredClone(f.draft.artifacts);f.service.store.save=()=>{f.draft.title='新的任务名';throw Error('磁盘保存失败');};await assert.rejects(translateStoryDesign(f.products,f.args),/磁盘/);assert.deepEqual(f.draft.artifacts,before);assert.equal(f.draft.title,'新的任务名');
});
test('不存在的集或镜头和非法参数返回业务错误，无模型与存储调用',async()=>{
 const f=fixture();for(const args of [{id:'draft',episodeId:'missing'},{...f.args,shotId:'missing'},{...f.args,shotId:{}}])await assert.rejects(translateStoryDesign(f.products,args),/不存在|无效/);assert.equal(f.calls.length,0);assert.equal(f.saves,0);
});

// 执行真实组件的 setup，验证阅读译稿不会通过双向绑定污染原始设计。
async function uiFixture(){
 const fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc'),helpers={...await import('../src/story-ui.mjs'),...await import('../server/shot-localization-view.mjs')};
 const f=fixture(),draft=vue.ref({...f.draft,product:{},language:'中文',voice:{audioId:''},story:{version:1,revision:4,sourceMode:'custom',sourceText:'已有文案',episodeCount:1,episodeDuration:30,narrationMode:'none',assets:[],episodes:f.draft.story.episodes}});
 for(const shot of draft.value.story.episodes[0].shots)shot.assetIds=[];
 helpers.storyUiDrafts.delete(draft.value.id);
 const state=vue.ref({drafts:[draft.value],runs:[],assets:[],settings:{provider:{}}}),calls=[];
 const studio={draft,state,busy:vue.ref(''),workflowLocked:vue.ref(false),act:async(_,work)=>work(),refresh:async()=>{},notify:()=>{},navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}),compiled=sfc.compileScript(descriptor,{id:'localization-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','AssetPicker','Modal','StoryModelSettings','CreativePresets','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)],values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},{},async(action,payload)=>{calls.push({action,payload});return {translated:0,skipped:2};},id=>id,()=>1,()=>{},...Object.values(helpers)];
 const scope=vue.effectScope(),component=new Function(...names,compiled)(...values),vm=scope.run(()=>component.setup({productMode:true},{expose(){}}));await vue.nextTick();
 return {vm,draft,calls,dispose:()=>scope.stop()};
}
test('组件仅显示独立中文译稿，不改原字段，不误标为未保存；显式编辑才复制译稿',async()=>{
 const f=await uiFixture();try{
  const shot=f.vm.shot.value,source=sourceOf(shot),before=structuredClone(JSON.parse(JSON.stringify(shot)));
  f.draft.value.artifacts.shotTranslations={[shot.id+':'+fingerprint(shot)]:{shotId:shot.id,sourceFingerprint:fingerprint(shot),source,translation:chinese()}};
  assert.equal(f.vm.shotDisplay.value.visual,chinese().visual);assert.equal(f.vm.shotDisplay.value.translated,true);assert.equal(f.vm.dirty.value,false);
  f.vm.setDesignField('visual','意外输入');assert.equal(shot.visual,before.visual);assert.deepEqual(f.calls,[]);
  f.vm.editChineseTranslation();assert.equal(shot.visual,chinese().visual);assert.equal(f.vm.dirty.value,true);assert.equal(shot.selectedImageId,before.selectedImageId);assert.equal(shot.selectedVideoId,before.selectedVideoId);assert.match(f.vm.translationStatus.value,/媒体选用失效/);
 }finally{f.dispose();}
});
test('组件按当前镜头或当前集提交准确范围，未保存修改禁止翻译',async()=>{
 const f=await uiFixture();try{
  await f.vm.translateDesign('shot');assert.deepEqual(f.calls[0],{action:'translateStoryDesign',payload:{id:'draft',episodeId:'episode',shotId:'one'}});
  await f.vm.translateDesign('episode');assert.deepEqual(f.calls[1],{action:'translateStoryDesign',payload:{id:'draft',episodeId:'episode'}});
  f.vm.shot.value.action='用户未保存的编辑';await f.vm.translateDesign('episode');assert.equal(f.calls.length,2);
 }finally{f.dispose();}
});
test('组件与服务端共用旧缓存校验，夹英文译稿不再显示，原始英文仍可核对',async()=>{
 const f=await uiFixture();try{
  const shot=f.vm.shot.value,source=sourceOf(shot),before=shot.visual;
  f.draft.value.artifacts.shotTranslations={[shot.id+':'+fingerprint(shot)]:{shotId:shot.id,sourceFingerprint:fingerprint(shot),source,translation:{...chinese(),visual:'蓝色teaser wand位于桌面。'}}};
  assert.equal(f.vm.shotDisplay.value.translated,false);assert.equal(f.vm.shotDisplay.value.visual,before);assert.equal(localizeShot(shot,f.draft.value.artifacts.shotTranslations).translated,false);assert.equal(f.vm.dirty.value,false);
 }finally{f.dispose();}
});

test('真实Store旧快照保存保留服务端译稿，客户端伪造无法创建或覆盖译稿',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../server/store.cjs'),{Runtime}=require('../server/runtime.cjs'),{ProductStudio}=require('../server/product-studio.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shot-localization-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),draft=store.draft(),f=fixture();draft.story=structuredClone(f.draft.story);store.save();const oldSnapshot=structuredClone(draft);
 const runtime=new Runtime(store),service={store,runtime,stories:{assertMutable:()=>{}},providers:f.service.providers},products=new ProductStudio(service);
 await translateStoryDesign(products,{...f.args,id:draft.id});const saved=structuredClone(store.draft().artifacts.shotTranslations);
 oldSnapshot.title='从旧快照修改任务标题';store.updateDraft(oldSnapshot);assert.deepEqual(store.draft().artifacts.shotTranslations,saved);assert.equal(store.draft().title,oldSnapshot.title);
 const forged=structuredClone(store.draft());forged.artifacts.shotTranslations={forged:{translation:{visual:'伪造镜头'}}};store.updateDraft(forged);assert.deepEqual(store.draft().artifacts.shotTranslations,saved);
 assert.deepEqual(new Store(dir).draft().artifacts.shotTranslations,saved);
 const freshDir=fs.mkdtempSync(path.join(os.tmpdir(),'shot-localization-forgery-'));t.after(()=>fs.rmSync(freshDir,{recursive:true,force:true}));const freshStore=new Store(freshDir),fresh=structuredClone(freshStore.draft());fresh.artifacts.shotTranslations=forged.artifacts.shotTranslations;freshStore.updateDraft(fresh);assert.equal(Object.hasOwn(freshStore.draft().artifacts,'shotTranslations'),false);
});

test('真实Runtime在翻译格式拒绝时持久化原始响应，失败任务不附加任何译稿',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../server/store.cjs'),{Runtime}=require('../server/runtime.cjs'),{ProductStudio}=require('../server/product-studio.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shot-localization-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),draft=store.draft(),f=fixture();draft.story=structuredClone(f.draft.story);store.save();let count=0;
 const service={store,runtime:new Runtime(store),stories:{assertMutable:()=>{}},providers:{text:async()=>({text:++count===1?JSON.stringify(chinese()):'raw-invalid-model-response'})}};
 await assert.rejects(translateStoryDesign(new ProductStudio(service),{...f.args,id:draft.id}),/有效JSON/);
 const persisted=new Store(dir),run=persisted.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.failureOutput.translation.responses.length,2);assert.equal(run.failureOutput.translation.responses[1].response.text,'raw-invalid-model-response');assert.equal(run.failureOutput.translation.validatedShots,1);assert.equal(run.failureOutput.translation.translationAttached,false);assert.equal(persisted.draft().artifacts.shotTranslations,undefined);
});

test('商品未准备故事分镜也能独立转换，来源与位置隔离且原设计和媒体不变',async()=>{
 const {productShotView}=await import('../server/shot-localization-view.mjs');
 const f=fixture();delete f.draft.story;f.draft.product={scriptRunId:'script-one',shots:[english('ignored'),english('ignored')]};
 const before=structuredClone(f.draft),result=await translateProductDesign(f.products,{id:'draft'});
 assert.equal(result.translated,2);assert.deepEqual(f.draft.product,before.product);assert.deepEqual(f.draft.voice,before.voice);assert.deepEqual(f.draft.video,before.video);
 assert.equal(productShotView(f.draft.product,0,f.draft.artifacts.shotTranslations).visual,chinese().visual);
 assert.equal((await translateProductDesign(f.products,{id:'draft'})).skipped,2);assert.equal(f.calls.length,2);
 f.draft.product.scriptRunId='script-two';assert.equal(productShotView(f.draft.product,0,f.draft.artifacts.shotTranslations).translated,false);
 f.draft.product.scriptRunId='script-one';f.draft.product.shots[0].camera='New camera.';assert.equal(productShotView(f.draft.product,0,f.draft.artifacts.shotTranslations).translated,false);
 assert.equal(productShotView(f.draft.product,1,f.draft.artifacts.shotTranslations).translated,true);
});

test('商品翻译失败、取消或脚本变化均不保存半批译稿',async()=>{
 for(const change of ['invalid','cancel','script','reorder']){
  const f=fixture();f.draft.product={scriptRunId:'script',shots:[english('one'),english('two')]};let count=0;
  f.service.providers.text=async()=>{if(++count===2){if(change==='invalid')return {text:'invalid'};if(change==='cancel')f.controller.abort();if(change==='script')f.draft.product.scriptRunId='new';if(change==='reorder')f.draft.product.shots.reverse();}return {text:JSON.stringify(chinese())};};
  // 位置相同、四字段相同的镜头互换不影响阅读内容，所以用不同设计验证顺序失效。
  if(change==='reorder')f.draft.product.shots[1].camera='Wide shot.';
  await assert.rejects(translateProductDesign(f.products,{id:'draft'}));assert.equal(f.saves,0);assert.equal(f.draft.artifacts.shotTranslations,undefined);
 }
});
