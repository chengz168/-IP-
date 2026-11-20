const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vue=require('vue');
const sfc=require('@vue/compiler-sfc');

// 直接运行真实组件 setup，验证用户操作的前置条件和调用范围。
async function fixture({existing=false,stale=false,component='ProductStudio',productMode=false,legacy=false}={}){
 const product={url:'',sourceRunId:'',title:'羽毛玩具',description:'彩色羽毛',brand:'',sku:'',price:'',currency:'',specifications:[],selectedIndices:[],assetIds:['image'],imageRoles:{},duration:12,aspect:'9:16',brief:'',scriptRunId:existing?'script':'',shots:existing?[{text:'看看这款玩具。',visual:'商品近景',imageId:'image',duration:12,action:'羽毛轻轻摆动',camera:'近景'}]:[],narration:true};
 if(legacy)delete product.imageRoles;
 const draft=vue.ref({id:'task',product,confirmed:true,finalText:'看看这款玩具。',language:'zh',voice:{audioId:'audio'},story:{version:1,revision:0,sourceMode:'upstream',sourceText:'看看这款玩具。',episodeCount:1,episodeDuration:12,narrationMode:'upstream',episodes:[],assets:[]}});
 if(legacy)Object.assign(draft.value,{video:{mode:'product',assetId:'legacy-base'},edit:{sourceId:'legacy-base',resultId:'legacy-final'},productSelection:{runId:'legacy-run',baseId:'legacy-base',resultId:'legacy-final'}});
 const initialDraftJson=JSON.stringify(draft.value);
 const state=vue.ref({drafts:[draft.value],assets:[{id:'image',type:'image',name:'商品原图'},{id:'audio',type:'audio',name:'已生成旁白'}],runs:existing?[{id:'script',draftId:'task',type:'product-script',status:'succeeded',snapshot:{product:JSON.parse(JSON.stringify(product))},output:{images:[{id:'image',name:'商品图',role:'product'}]}}]:[],settings:{provider:{}}});
 const calls=[],notices=[];
 const studio={state,draft,busy:vue.ref(''),workflowLocked:vue.ref(false),act:async(_,work)=>work(),save:async()=>{},refresh:async()=>{},notify:(...args)=>notices.push(args),importAssets:async()=>[],navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const filename=path.resolve(__dirname,'../src/components/'+component+'.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const compiled=sfc.compileScript(descriptor,{id:'product-intro-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const helpers=await import('../src/story-ui.mjs');
 const scope=vue.effectScope(),call=async(action,payload)=>{calls.push({action,payload});return {stale,story:JSON.parse(JSON.stringify(draft.value.story))};};
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','MediaPreview','StoryStudio','AssetPicker','Modal','StoryModelSettings','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)];
 const values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},{},{},call,id=>id,()=>1,()=>{},...Object.values(helpers)];
 const componentObject=new Function(...names,compiled)(...values),vm=scope.run(()=>componentObject.setup({phase:'video',productMode},{expose(){}}));
 await vue.nextTick();
 return {vm,draft,state,calls,notices,descriptor,filename,initialDraftJson,dispose:()=>scope.stop()};
}

test('新商品采用动态介绍，旧商品展示任务保留原方式，初始化不提交模型',async()=>{
 for(const existing of [false,true]){const f=await fixture({existing});try{assert.equal(f.vm.renderMode.value,existing?'presentation':'introduction');assert.equal(Object.hasOwn(f.draft.value.product,'renderMode'),false);assert.equal(JSON.stringify(f.draft.value),f.initialDraftJson);assert.equal(f.calls.length,0);assert.deepEqual(sfc.compileTemplate({id:'product-intro-ui',filename:f.filename,source:f.descriptor.template.content}).errors,[]);}finally{f.dispose();}}
});

test('缺少新字段的旧商品挂载不写回草稿，默认角色与模式可读，用户操作才创建字段',async()=>{
 const f=await fixture({existing:true,legacy:true});try{
  assert.equal(f.vm.renderMode.value,'presentation');assert.equal(f.vm.introduction.value,false);assert.equal(f.vm.scriptStale.value,false);
  assert.equal(f.vm.imageRole('image'),'product');assert.equal(f.vm.imageRole('remote:0','detail'),'detail');assert.equal(f.vm.canScript.value,true);
  assert.equal(JSON.stringify(f.draft.value),f.initialDraftJson);assert.equal(Object.hasOwn(f.draft.value.product,'imageRoles'),false);assert.equal(Object.hasOwn(f.draft.value.product,'renderMode'),false);
  assert.match(f.descriptor.template.content,/v-model="renderMode"[^>]*value="presentation"/);
  f.vm.renderMode.value='introduction';assert.equal(f.draft.value.product.renderMode,'introduction');assert.equal(f.vm.introduction.value,true);assert.equal(Object.hasOwn(f.draft.value.product,'imageRoles'),false);
  f.vm.renderMode.value='presentation';assert.equal(f.vm.renderMode.value,'presentation');assert.equal(f.vm.introduction.value,false);
  f.vm.setImageRole('image','icon');assert.deepEqual(f.draft.value.product.imageRoles,{image:'icon'});assert.equal(f.vm.imageRole('image'),'icon');assert.equal(f.vm.scriptStale.value,true);assert.equal(f.calls.length,0);
 }finally{f.dispose();}
});

test('仅图标素材不能当作商品主体，标注变化使旧脚本失效',async()=>{
 const f=await fixture({existing:true});try{assert.equal(f.vm.canScript.value,true);assert.equal(f.vm.scriptStale.value,false);f.vm.setImageRole('image','icon');assert.equal(f.vm.canScript.value,false);assert.equal(f.vm.scriptStale.value,true);f.vm.setImageRole('image','detail');assert.equal(f.vm.canScript.value,true);assert.equal(f.calls.length,0);}finally{f.dispose();}
});

test('动态介绍缺确认稿或当前音频时阻止准备；一次点击只准备分镜',async()=>{
 const f=await fixture({existing:true});try{f.draft.value.product.renderMode='introduction';await vue.nextTick();f.draft.value.confirmed=false;await f.vm.prepareIntroduction();assert.equal(f.calls.length,0);f.draft.value.confirmed=true;f.draft.value.voice.audioId='';await f.vm.prepareIntroduction();assert.equal(f.calls.length,0);f.draft.value.voice.audioId='audio';await f.vm.prepareIntroduction();assert.deepEqual(f.calls,[{action:'prepareProductIntroduction',payload:{id:'task'}}]);assert(f.notices.some(item=>item[1]==='success'));assert(f.calls.every(item=>item.action!=='generateStoryVideo'));}finally{f.dispose();}
});

test('准备期间输入失效不能显示准备成功或自动生成镜头',async()=>{
 const f=await fixture({existing:true,stale:true});try{await f.vm.prepareIntroduction();assert.equal(f.calls.length,1);assert.match(f.vm.error.value,/未替换当前分镜/);assert.equal(f.notices.length,0);}finally{f.dispose();}
});

test('产品动态镜头直接打开视频页，商品或声音变更阻止继续旧分镜',async()=>{
 const f=await fixture({existing:true,component:'StoryStudio',productMode:true});try{const story=f.vm.story.value;story.productIntroduction={productSnapshot:JSON.parse(JSON.stringify(f.draft.value.product)),audioId:'audio'};assert.equal(f.vm.tab.value,'videos');assert.equal(f.vm.sourceChanged.value,false);f.draft.value.product.description='新规格';assert.equal(f.vm.sourceChanged.value,true);f.draft.value.product.description='彩色羽毛';assert.equal(f.vm.sourceChanged.value,false);f.draft.value.voice.audioId='new-audio';assert.equal(f.vm.sourceChanged.value,true);assert.equal(f.calls.length,0);}finally{f.dispose();}
});

test('准备前后均可核对修改屏显卖点和依据，字段限制与事实提示存在',async()=>{
 for(const component of ['ProductStudio','StoryStudio']){const f=await fixture({existing:true,component,productMode:component==='StoryStudio'});try{const template=f.descriptor.template.content;assert.match(template,/<input[^>]*v-model="shot.sellingPoint"[^>]*maxlength="160"/);assert.match(template,/<textarea[^>]*v-model="shot.evidence"[^>]*maxlength="1000"/);assert.match(template,/第二步确认的是旁白正文/);assert.deepEqual(sfc.compileTemplate({id:'product-selling-point-ui',filename:f.filename,source:template}).errors,[]);assert.equal(f.calls.length,0);}finally{f.dispose();}}
});

test('已准备分镜修改卖点和依据，保存传递新内容且不改确认旁白',async()=>{
 const f=await fixture({existing:true,component:'StoryStudio',productMode:true});try{
  f.vm.story.value.episodes=[{id:'episode',shots:[{id:'shot',text:'看看这款玩具。',assetIds:[],sellingPoint:'原宣传语',evidence:'商家描述'}]}];
  f.vm.shot.value.sellingPoint='彩色羽毛与铃铛';f.vm.shot.value.evidence='商品原图可见羽毛与铃铛，未核实耐咬功效';
  await f.vm.run('saveStory');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'saveStory');
  const saved=f.calls[0].payload.story.episodes[0].shots[0];assert.equal(saved.sellingPoint,'彩色羽毛与铃铛');assert.equal(saved.evidence,'商品原图可见羽毛与铃铛，未核实耐咬功效');assert.equal(saved.text,'看看这款玩具。');assert.equal(f.draft.value.finalText,'看看这款玩具。');
 }finally{f.dispose();}
});

test('商品分镜准备后区分目标、真实旁白和分镜覆盖时长，未准备保留规划',async()=>{
 const f=await fixture({existing:true});try{
  f.draft.value.product.renderMode='introduction';f.draft.value.product.duration=15;
  f.draft.value.product.shots=Array.from({length:3},()=>({duration:5}));
  assert.equal(f.vm.timingSummary.value,'3 个镜头 · 规划 15.0 秒');
  const audio=f.state.value.assets.find(item=>item.id==='audio');audio.duration=8.138594;
  f.draft.value.story.productIntroduction={audioId:'audio'};
  f.draft.value.story.episodes=[{shots:[{duration:2.75},{duration:2.75},{duration:2.6667}]}];
  assert.equal(f.vm.timingSummary.value,'3 个镜头 · 目标 15.0 秒 / 实际旁白 8.14 秒 / 分镜覆盖 8.17 秒');
  delete audio.duration;assert.match(f.vm.timingSummary.value,/实际旁白 未取得/);assert.doesNotMatch(f.vm.timingSummary.value,/NaN|实际旁白 15/);
  f.draft.value.product.renderMode='presentation';assert.equal(f.vm.timingSummary.value,'3 个镜头 · 规划 15.0 秒');assert.equal(f.calls.length,0);
 }finally{f.dispose();}
});
