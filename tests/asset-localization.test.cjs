const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');
const {translateStoryDesign,fingerprint,sourceOf}=require('../server/shot-localization.cjs');
const asset=()=>({id:'asset-one',kind:'prop',name:'逗猫棒',description:'一根蓝色PP逗猫棒。',prompt:'A blue PP teaser wand, 2 cm wide, white background.',selectedImageId:'image-one',images:[{id:'image-one',status:'ready'}]});
const translation=()=>({visual:'一根蓝色PP逗猫棒。',action:'蓝色PP逗猫棒，宽2 cm，白色背景。',camera:'',sound:''});
function fixture(){
 const draft={id:'draft',voice:{audioId:'voice'},video:{assetId:'video'},story:{revision:2,assets:[asset()],episodes:[]},artifacts:{other:'保留'}},controller=new AbortController(),calls=[];let saves=0;
 const service={store:{draft:()=>draft,save:()=>{saves++;}},stories:{assertMutable:()=>{}},providers:{text:async(system,user,ctx,options)=>{calls.push({system,user:JSON.parse(user),options});return {text:JSON.stringify(translation())};}}};
 const products={service,locked:async(id,work)=>work(),run:async(type,id,parameters,work)=>{calls.push({type,id,parameters});return work({signal:controller.signal,progress:()=>{}});}};
 return {draft,controller,calls,service,products,get saves(){return saves;},args:{id:'draft',assetId:'asset-one'}};
}
test('资产无需分镜即可独立转换，只附加指纹译稿，原设定媒体与稳定绑定不变',async()=>{
 const {localizeAssetView,assetTranslationSource}=await import('../server/shot-localization-view.mjs'),f=fixture(),before=structuredClone(f.draft);
 const result=await translateStoryDesign(f.products,f.args);assert.equal(result.translated,1);assert.equal(f.saves,1);assert.deepEqual(f.draft.story,before.story);assert.deepEqual(f.draft.voice,before.voice);assert.deepEqual(f.draft.video,before.video);assert.equal(f.draft.artifacts.other,'保留');assert.equal(result.qualityAccepted,false);
 const source=assetTranslationSource(f.draft.story.assets[0]),record=f.draft.artifacts.shotTranslations[source.id+':'+fingerprint(source)];assert.equal(record.source.id,'asset:asset-one');assert.equal(record.translation.action,translation().action);
 const view=localizeAssetView(f.draft.story.assets[0],f.draft.artifacts.shotTranslations);assert.equal(view.translated,true);assert.equal(view.prompt,translation().action);assert.equal(view.id,'asset-one');assert.equal(view.selectedImageId,'image-one');assert.match(f.calls[1].system,/视觉资产设定/);
 assert.equal((await translateStoryDesign(f.products,f.args)).skipped,1);assert.equal(f.saves,1);
});
test('资产源提示词变化使旧译稿不可读，换已选图不使同一译稿失效',async()=>{
 const {localizeAssetView}=await import('../server/shot-localization-view.mjs'),f=fixture();await translateStoryDesign(f.products,f.args);const a=f.draft.story.assets[0];a.selectedImageId='new-image';assert.equal(localizeAssetView(a,f.draft.artifacts.shotTranslations).translated,true);a.prompt='Another prompt.';assert.equal(localizeAssetView(a,f.draft.artifacts.shotTranslations).translated,false);assert.equal(localizeAssetView(a,f.draft.artifacts.shotTranslations).prompt,a.prompt);
});
test('普通全大写英文可中文化，同时仍保护PP、USB-C、Sony和A7M4等明确名称',async()=>{
 const {validateTranslation}=await import('../server/shot-localization-view.mjs');
 const source={visual:'',action:'A grey litter box. NO TEXT, NO WATERMARK.',camera:'',sound:''},good={visual:'',action:'灰色猫砂盆。无文字、无水印。',camera:'',sound:''};assert.deepEqual(validateTranslation(good,source),good);
 for(const token of ['PP','USB-C','Sony','A7M4']){
  const original={visual:'',action:'A '+token+' grey box.',camera:'',sound:''};assert.throws(()=>validateTranslation({...good,action:'灰色盒子。'},original),/遗漏/);assert.doesNotThrow(()=>validateTranslation({...good,action:token+'灰色盒子。'},original));
 }
});
test('实际猫砂铲失败输入明确要求action翻译，其他字段用const保持，原样英文仍拒绝且不重试',async()=>{
 const prompt='A beige plastic cat litter scoop with holes',f=fixture();f.draft.story.assets[0].description='米色塑料猫砂铲，带孔洞。';f.draft.story.assets[0].prompt=prompt;
 f.service.providers.text=async(system,user,ctx,options)=>{f.calls.push({system,user:JSON.parse(user),options});return {text:JSON.stringify({visual:f.draft.story.assets[0].description,action:prompt,camera:'',sound:''})};};
 await assert.rejects(translateStoryDesign(f.products,f.args),/英文镜头/);const request=f.calls.find(item=>item.system);
 assert.match(request.system,/本次必须翻译为简体中文的字段：action/);assert.match(request.system,/本次必须逐字保持原值的字段：visual、camera、sound/);assert.match(request.user.task,/执行忠实中文翻译/);assert.deepEqual(request.user.translateFields,['action']);assert.deepEqual(request.user.preserveFields,['visual','camera','sound']);assert.equal(request.user.source.action,prompt);
 for(const key of ['visual','camera','sound'])assert.equal(request.options.schema.properties[key].const,request.user.source[key]);assert.equal(Object.hasOwn(request.options.schema.properties.action,'const'),false);assert.equal(request.options.schema.properties.action.minLength,1);assert.equal(f.calls.filter(item=>item.system).length,1);assert.equal(f.saves,0);assert.equal(f.draft.story.assets[0].prompt,prompt);
});
test('资产翻译不允许丢失数字型号、残留普通英文、改中文或补空字段',async()=>{
 for(const invalid of [{...translation(),action:'蓝色逗猫棒，白色背景。'},{...translation(),action:'蓝色PP teaser wand，宽2 cm，白色背景。'},{...translation(),visual:'擅自修改资产原有中文'},{...translation(),sound:'无音乐'},{...translation(),extra:'越界'},'invalid']){
  const f=fixture(),before=structuredClone(f.draft);f.service.providers.text=async()=>({text:typeof invalid==='string'?invalid:JSON.stringify(invalid)});await assert.rejects(translateStoryDesign(f.products,f.args));assert.deepEqual(f.draft,before);assert.equal(f.saves,0);
 }
});
test('资产翻译取消、源修改、删除或译稿并发变化均拒绝迟到结果',async()=>{
 for(const change of [f=>f.controller.abort(),f=>f.draft.story.assets[0].prompt='用户新提示词',f=>f.draft.story.assets=[],f=>f.draft.artifacts.shotTranslations={newer:{note:'另一个结果'}}]){
  const f=fixture();f.service.providers.text=async()=>{change(f);return {text:JSON.stringify(translation())};};await assert.rejects(translateStoryDesign(f.products,f.args));assert.equal(f.saves,0);assert.equal(Object.keys(f.draft.artifacts.shotTranslations||{}).some(key=>key.startsWith('asset:asset-one:')),false);
 }
});
test('无效资产范围、缺失资产和歧义的混合范围均不调用模型或保存',async()=>{
 const f=fixture();for(const args of [{id:'draft',assetId:''},{id:'draft',assetId:[]},{id:'draft',assetId:'missing'},{...f.args,shotId:'shot'},{...f.args,id:''}])await assert.rejects(translateStoryDesign(f.products,args),/无效|不存在/);assert.equal(f.saves,0);assert.equal(f.calls.length,0);
});
test('服务和桌面入口原样透传assetId，不需要新增IPC动作',()=>{
 const service=fs.readFileSync(path.resolve(__dirname,'../server/service.cjs'),'utf8'),preload=fs.readFileSync(path.resolve(__dirname,'../electron/preload.cjs'),'utf8');assert.match(service,/handlers\.translateStoryDesign=p=>require\('\.\/shot-localization\.cjs'\)\.translateStoryDesign\(service\.products,p\)/);assert.match(preload,/translateStoryDesign/);
});
let fixtureId=0;
async function uiFixture(t,options={}){
 const helpers={...await import('../src/story-ui.mjs'),...await import('../server/shot-localization-view.mjs')},id='asset-ui-'+ ++fixtureId;
 const a=asset(),draft=vue.ref({id,confirmed:true,finalText:'当前文案',voice:{audioId:''},artifacts:{},story:{version:1,revision:2,sourceMode:'custom',sourceText:'当前文案',episodeCount:1,episodeDuration:30,narrationMode:'none',assets:[a,{...asset(),id:'asset-two',name:'另一个资产'}],episodes:[]}});
 const state=vue.ref({drafts:[draft.value],runs:[],assets:[],settings:{provider:{}}}),busy=vue.ref(''),workflowLocked=vue.ref(false),calls=[];
 const studio={draft,state,busy,workflowLocked,act:async(_,work)=>work(),refresh:async()=>{},notify:()=>{},navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const source=sfc.compileScript(descriptor,{id:'asset-localization-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','AssetPicker','Modal','StoryModelSettings','CreativePresets','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)];
 const values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},{},async(action,payload)=>{calls.push({action,payload});return options.call?options.call(action,payload):{translated:1,skipped:0};},id=>id,()=>1,()=>{},...Object.values(helpers)];
 const scope=vue.effectScope(),component=new Function('StoryImageEdit',...names,source)({},...values),vm=scope.run(()=>component.setup({productMode:false},{expose(){}}));vm.assetScope.value='all';await vue.nextTick();
 t.after(()=>{scope.stop();helpers.storyUiDrafts.delete(id);});
 function attachTranslation(){const source=helpers.assetTranslationSource(vm.asset.value);draft.value.artifacts.shotTranslations={[source.id+':'+fingerprint(source)]:{shotId:source.id,sourceFingerprint:fingerprint(source),source:sourceOf(source),translation:translation()}};}
 return {vm,draft,state,busy,workflowLocked,calls,descriptor,filename,attachTranslation};
}
test('真实组件中文阅读只读展示不污染prompt或已选图，显式编辑才写回并提醒失效',async t=>{
 const f=await uiFixture(t);f.attachTranslation();const before=JSON.parse(JSON.stringify(f.vm.asset.value));assert.equal(f.vm.assetDisplay.value.prompt,translation().action);assert.equal(f.vm.assetDisplay.value.translated,true);assert.equal(f.vm.dirty.value,false);f.vm.setAssetDesignField('prompt','意外输入');assert.deepEqual(JSON.parse(JSON.stringify(f.vm.asset.value)),before);
 f.vm.editAssetChineseTranslation();assert.equal(f.vm.asset.value.prompt,translation().action);assert.equal(f.vm.asset.value.selectedImageId,before.selectedImageId);assert.deepEqual(JSON.parse(JSON.stringify(f.vm.asset.value.images)),before.images);assert.equal(f.vm.dirty.value,true);assert.match(f.vm.assetTranslationStatus.value,/失效.*历史候选保留/);assert.equal(f.calls.length,0);
 assert.deepEqual(sfc.compileTemplate({filename:f.filename,id:'asset-localization-ui',source:f.descriptor.template.content}).errors,[]);assert.match(f.descriptor.template.content,/aria-label="资产中文阅读"/);assert.match(f.descriptor.template.content,/:value="assetDisplay.prompt" :readonly="assetDisplay.translated"/);assert.doesNotMatch(f.descriptor.template.content,/v-model="asset.prompt"/);
});
test('真实组件精确提交当前assetId，未保存或locked时不请求',async t=>{
 const f=await uiFixture(t);await f.vm.translateAssetDesign();assert.deepEqual(f.calls,[{action:'translateStoryDesign',payload:{id:f.draft.value.id,assetId:'asset-one'}}]);assert.match(f.vm.assetTranslationStatus.value,/原提示词与已选图片保持不变/);
 f.vm.asset.value.prompt='中文新提示词';await f.vm.translateAssetDesign();assert.equal(f.calls.length,1);
 for(const lock of ['busy','workflow','pending','saving','run']){
  const g=await uiFixture(t);if(lock==='busy')g.busy.value='忙碌';if(lock==='workflow')g.workflowLocked.value=true;if(lock==='pending')g.vm.pending.value=true;if(lock==='saving')g.vm.saving.value=true;if(lock==='run')g.state.value.runs.push({type:'story-translation',draftId:g.draft.value.id,status:'running'});
  await g.vm.translateAssetDesign();g.vm.editAssetChineseTranslation();assert.equal(g.calls.length,0);assert.equal(g.vm.dirty.value,false);
 }
});
test('组件翻译期间换资产或换任务不显示旧资产成功；失败保留原文媒体',async t=>{
 for(const mode of ['asset','draft','failed']){
  let resolve,reject;const pending=new Promise((a,b)=>{resolve=a;reject=b;}),f=await uiFixture(t,{call:()=>pending}),before=JSON.parse(JSON.stringify(f.vm.story.value));
  const operation=f.vm.translateAssetDesign();for(let i=0;i<10&&!f.calls.length;i++)await Promise.resolve();assert.equal(f.calls.length,1);
  if(mode==='asset')f.vm.assetId.value='asset-two';if(mode==='draft')f.draft.value.id='another-draft';if(mode==='failed')reject(Error('模型请求失败'));else resolve({translated:1,skipped:0});await operation;
  assert.equal(f.vm.assetTranslationStatus.value,'');assert.deepEqual(JSON.parse(JSON.stringify(f.vm.story.value)),before);if(mode==='failed')assert.equal(f.vm.error.value,'模型请求失败');
 }
});
test('中文转换已成功后切资产、切任务或改原文都立即清除过时提示',async t=>{
 for(const mode of ['asset','draft','description','prompt']){
  const f=await uiFixture(t);await f.vm.translateAssetDesign();assert.match(f.vm.assetTranslationStatus.value,/已保存/);
  if(mode==='asset')f.vm.assetId.value='asset-two';if(mode==='draft')f.draft.value.id='changed-task';if(mode==='description')f.vm.asset.value.description='新的中文外观';if(mode==='prompt')f.vm.asset.value.prompt='新的中文提示词';
  assert.equal(f.vm.assetTranslationStatus.value,'');
 }
});
