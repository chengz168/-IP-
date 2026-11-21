const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vue=require('vue');
const sfc=require('@vue/compiler-sfc');

test('桌面桥允许中文镜头候选操作并保留未知操作拒绝',async()=>{
 let bridge;const calls=[];
 require('node:vm').runInNewContext(fs.readFileSync(path.resolve(__dirname,'../electron/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return true;}}})});
 const payload={id:'task',episodeId:'episode',shotId:'shot',instruction:'保留首帧，动作从开头发生'};
 assert.equal(await bridge.invoke('proposeProductShotDesign',payload),true);
 assert.deepEqual(calls,[['studio:invoke','proposeProductShotDesign',payload]]);
 await assert.rejects(bridge.invoke('unknown-action',{}),/不支持的操作/);
});

const design={visual:'原图商品近景，羽毛完整可见。',action:'前两秒轻摆长杆，羽毛跟随摆动后回稳。',camera:'固定近景，保持商品完整可见。',sound:'保留轻微自然环境声，不生成对白。',videoPrompt:'Natural light on the referenced product. Complete the gentle sway in the first two seconds.'};

// 运行真实组件 setup，验证建议不会绕过用户确认写入镜头。
async function fixture({refreshAfterAct=false}={}){
 const product={title:'羽毛逗猫棒',shots:[]};
 const source={id:'task',product,confirmed:true,finalText:'轻轻摆动。',voice:{audioId:'audio'},story:{version:1,revision:4,sourceMode:'upstream',sourceText:'轻轻摆动。',episodeCount:1,episodeDuration:8,narrationMode:'upstream',productIntroduction:{productSnapshot:product,audioId:'audio'},assets:[{id:'product',kind:'prop',name:'商品原图',selectedImageId:'image'}],episodes:[{id:'episode',title:'商品',text:'轻轻摆动。',shots:[{id:'shot',text:'轻轻摆动。',sellingPoint:'长杆与羽毛',evidence:'商品详情原文',visual:'Product close up',action:'Sway gently',camera:'Close up',sound:'No dialogue',videoPrompt:'Preserve product',duration:2,assetIds:['product'],iconIds:['icon'],images:[{id:'image'}],videos:[{id:'video'}],selectedImageId:'image',selectedVideoId:'video'},{id:'other',text:'查看详情。',visual:'Other shot',duration:2,assetIds:['product'],images:[],videos:[]}]}]}};
 const draft=vue.ref(source),state=vue.ref({drafts:[draft.value],runs:[],assets:[{id:'image',type:'image'}],settings:{provider:{}}}),calls=[],notices=[];
 let proposed=async()=>({design:{...design},inputHash:'hash',revision:draft.value.story.revision,stale:false});
 const studio={draft,state,busy:vue.ref(''),workflowLocked:vue.ref(false),act:async(_,fn)=>{const result=await fn();if(refreshAfterAct){draft.value=JSON.parse(JSON.stringify(draft.value));state.value={...state.value,drafts:[draft.value]};}return result;},refresh:async()=>{},notify:(...args)=>notices.push(args),navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const call=async(action,payload)=>{calls.push({action,payload:JSON.parse(JSON.stringify(payload))});if(action==='proposeProductShotDesign')return proposed(payload);if(action==='saveStory'){draft.value.story={...JSON.parse(JSON.stringify(payload.story)),revision:payload.revision+1};return{story:JSON.parse(JSON.stringify(draft.value.story))};}throw Error('测试未预期调用：'+action);};
 const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const compiled=sfc.compileScript(descriptor,{id:'shot-design-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),helpers=await import('../src/story-ui.mjs');
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','AssetPicker','Modal','StoryModelSettings','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)];
 const values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},call,id=>id,()=>1,()=>{},...Object.values(helpers)];
 const scope=vue.effectScope(),component=new Function(...names,compiled)(...values),vm=scope.run(()=>component.setup({productMode:true},{expose(){}}));await vue.nextTick();
 return{vm,draft,state,calls,notices,filename,descriptor,setProposal:fn=>{proposed=fn;},dispose:()=>scope.stop()};
}

test('中文优化先保存当前编辑，只预览候选，取消不写回设计',async()=>{
 const f=await fixture();try{
  f.vm.shot.value.visual='用户刚编辑的画面';f.vm.shotDesignInstruction.value='动作清晰可见';await f.vm.proposeShotDesign();
  assert.deepEqual(f.calls.map(item=>item.action),['saveStory','proposeProductShotDesign']);assert.equal(f.calls[1].payload.instruction,'动作清晰可见');assert.equal(f.calls[1].payload.episodeId,'episode');assert.equal(f.vm.shot.value.visual,'用户刚编辑的画面');assert.equal(f.vm.shotDesignCandidate.value.design.visual,design.visual);assert.deepEqual(f.vm.shotDesignFields.map(([key])=>key),['visual','action','camera','sound']);assert.equal(f.vm.shotDesignKeys.includes('videoPrompt'),true);assert.equal(Object.hasOwn(f.vm.shotDesignCandidate.value.before,'videoPrompt'),false);assert.match(f.descriptor.template.content,/界面中文编辑，系统按模型格式组装生成指令/);
  f.vm.cancelShotDesign();assert.equal(f.vm.shotDesignCandidate.value,null);assert.equal(f.calls.length,2);assert.equal(f.vm.shot.value.visual,'用户刚编辑的画面');
  assert.deepEqual(sfc.compileTemplate({id:'shot-design-ui',filename:f.filename,source:f.descriptor.template.content}).errors,[]);
 }finally{f.dispose();}
});

test('显式应用只更新五个设计字段，保留事实、旁白、时长和绑定',async()=>{
 const f=await fixture();try{
  const before=JSON.parse(JSON.stringify(f.vm.shot.value));await f.vm.proposeShotDesign();await f.vm.applyShotDesign();
  const actual=f.calls.find(item=>item.action==='saveStory').payload.story.episodes[0].shots[0];
  for(const key of Object.keys(design))assert.equal(actual[key],design[key]);
  for(const key of ['text','sellingPoint','evidence','duration','assetIds','iconIds','images','videos','selectedImageId','selectedVideoId'])assert.deepEqual(actual[key],before[key]);
  assert.equal(f.vm.shotDesignCandidate.value,null);
 }finally{f.dispose();}
});

test('同ID草稿刷新保留优化要求及成功候选，真实切换ID才清空',async()=>{
 const f=await fixture({refreshAfterAct:true});try{
  f.vm.shotDesignInstruction.value='保留首帧，主体动作从开头发生';
  await f.vm.proposeShotDesign();
  assert.equal(f.vm.shotDesignInstruction.value,'保留首帧，主体动作从开头发生');
  assert.equal(f.vm.shotDesignCandidate.value?.design.visual,design.visual);
  assert.equal(f.vm.error.value,'');
  const candidate=f.vm.shotDesignCandidate.value;
  f.draft.value={...JSON.parse(JSON.stringify(f.draft.value)),updatedAt:'本次状态刷新'};
  f.state.value={...f.state.value,drafts:[f.draft.value]};await vue.nextTick();
  assert.equal(f.vm.shotDesignInstruction.value,'保留首帧，主体动作从开头发生');
  assert.equal(f.vm.shotDesignCandidate.value,candidate);
  f.draft.value={...JSON.parse(JSON.stringify(f.draft.value)),id:'different-task'};await vue.nextTick();
  assert.equal(f.vm.shotDesignInstruction.value,'');assert.equal(f.vm.shotDesignCandidate.value,null);
 }finally{f.dispose();}
 const switched=await fixture();try{
  switched.vm.shotDesignInstruction.value='保留当前镜头';switched.vm.shotId.value='other';
  assert.equal(switched.vm.shotDesignInstruction.value,'');
 }finally{switched.dispose();}
});

test('候选生成中切换镜头或更改内容后，不允许套用返回的旧建议',async()=>{
 for(const change of [vm=>{vm.shotId.value='other';},vm=>{vm.shot.value.action='新的动作';},vm=>{vm.shotDesignInstruction.value='新的要求';}]){
  const f=await fixture();try{
   let release;f.setProposal(()=>new Promise(resolve=>{release=resolve;}));const request=f.vm.proposeShotDesign();while(!release)await Promise.resolve();change(f.vm);const savesBefore=f.calls.filter(item=>item.action==='saveStory').length;release({design,inputHash:'hash',revision:4,stale:false});await request;
   assert.equal(f.vm.shotDesignCandidate.value,null);assert.match(f.vm.error.value,/已作废/);await f.vm.applyShotDesign();assert.equal(f.calls.filter(item=>item.action==='saveStory').length,savesBefore);
  }finally{f.dispose();}
 }
});

test('预览后编辑、切换任务及服务报告过期，均不会保存旧建议',async()=>{
 const f=await fixture();try{
  await f.vm.proposeShotDesign();f.vm.shot.value.sellingPoint='新的卖点';assert.equal(f.vm.shotDesignCandidate.value,null);await f.vm.applyShotDesign();assert.equal(f.calls.filter(item=>item.action==='saveStory').length,0);
  await f.vm.persist();await f.vm.proposeShotDesign();f.draft.value.id='new-task';assert.equal(f.vm.shotDesignCandidate.value,null);await f.vm.applyShotDesign();assert.equal(f.calls.filter(item=>item.action==='saveStory').length,1);
 }finally{f.dispose();}
 const stale=await fixture();try{stale.setProposal(async()=>({design,inputHash:'hash',revision:3,stale:true}));await stale.vm.proposeShotDesign();assert.equal(stale.vm.shotDesignCandidate.value,null);assert.match(stale.vm.error.value,/版本已变化/);}finally{stale.dispose();}
});
