const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{ref,computed,watch}=require('vue');
const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
const file=path.resolve(__dirname,'../src/components/AvatarOptimizeDialog.vue');
const {descriptor,errors}=parse(fs.readFileSync(file,'utf8'),{filename:file});

// 执行真实 SFC 的 setup；只替换宿主注入与 API，避免启动模型或操作日常工作区。
function fixture(options={}){
 const draft=ref({id:'draft',confirmed:true,finalText:'商业航天产业观察',video:{mode:'single',avatarId:'source',aspect:'9:16'}}),state=ref({assets:[{id:'source-video',type:'video',width:1080,height:1920}],runs:[]}),busy=ref(''),workflowLocked=ref(false),events=[],calls=[];
 const studio={draft,state,busy,workflowLocked,notify(){},save:options.save||async function(){},refresh:async()=>{if(options.refresh)await options.refresh(state);},act:async(label,work)=>{busy.value=label;try{return await work();}catch{return undefined;}finally{busy.value='';}}};
 const call=async(action,payload)=>{calls.push({action,payload});if(options.call)return options.call(action,payload);return {avatar:{id:'optimized',name:'优化副本'},asset:{id:'optimized-video'}};};
 const compiled=compileScript(descriptor,{id:'avatar-optimize-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const component=new Function('computed','inject','onBeforeUnmount','ref','watch','Modal','I','call','mediaUrl',compiled)(computed,()=>studio,()=>{},ref,watch,{}, {},call,id=>'/media/'+id);
 const vm=component.setup({avatar:{id:'source',name:'原形象',assetId:'source-video'}},{expose(){},emit:(...args)=>events.push(args)});
 return {vm,draft,state,busy,workflowLocked,events,calls};
}

test('优化弹窗和视频面板真实模板可编译',()=>{
 assert.deepEqual(errors,[]);
 for(const relative of ['src/components/AvatarOptimizeDialog.vue','src/components/VideoPanel.vue']){
  const filename=path.resolve(__dirname,'..',relative),parsed=parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(parsed.errors,[]);compileScript(parsed.descriptor,{id:relative});assert.deepEqual(compileTemplate({id:relative,source:parsed.descriptor.template.content,filename}).errors,[]);
 }
});

test('优化生成只登记预览，明确选用后才保存新形象，参数使用真实接口契约',async()=>{
 const {vm,draft,calls,events}=fixture();assert.equal(vm.look.value,'natural');assert.equal(vm.background.value,'business-studio');await vm.optimize();
 assert.deepEqual(calls[0],{action:'avatarOptimize',payload:{id:'draft',avatarId:'source',look:'natural',background:'business-studio',beautyStrength:12}});assert.equal(draft.value.video.avatarId,'source');assert.equal(vm.generated.value.asset.id,'optimized-video');assert.equal(events.length,0);
 await vm.useGenerated();assert.equal(draft.value.video.avatarId,'optimized');assert.deepEqual(events[0],['saved',{id:'optimized',name:'优化副本'}]);
});

test('后端配置错误保留真实原因与原选择，忙碌和工作流锁禁止重复请求',async()=>{
 const {vm,draft,calls,busy,workflowLocked}=fixture({call:async()=>{throw Error('本地人物抠像模型缺失');}});await vm.optimize();assert.match(vm.error.value,/本地人物抠像模型缺失/);assert.equal(draft.value.video.avatarId,'source');assert.equal(vm.working.value,false);
 busy.value='其他任务';await vm.optimize();assert.equal(calls.length,1);busy.value='';workflowLocked.value=true;await vm.optimize();assert.equal(calls.length,1);
});

test('参数变化撤下旧预览，不会把保留背景结果当成商务演播室选用',async()=>{
 const {vm,draft}=fixture();await vm.optimize();assert(vm.generated.value);vm.background.value='original';assert.equal(vm.generated.value,null);await vm.useGenerated();assert.equal(draft.value.video.avatarId,'source');
});

test('停止按钮调用当前优化记录，不将停止误标为优化成功',async()=>{
 const {vm,state,calls}=fixture({call:async()=>true});state.value.runs=[{id:'run',draftId:'draft',type:'avatar-optimize',status:'running'}];await vm.stop();assert.deepEqual(calls,[{action:'cancelRun',payload:{id:'run'}}]);assert.equal(vm.stopRequested.value,true);assert.equal(vm.generated.value,null);
});

test('刚提交即停止时主动刷新执行记录，不等待定时轮询',async()=>{
 let refreshes=0;
 const {vm,calls}=fixture({call:async()=>true,refresh:async(state)=>{refreshes++;state.value.runs=[{id:'just-started',draftId:'draft',type:'avatar-optimize',status:'running'}];}});
 await vm.stop();assert.equal(refreshes,2);assert.deepEqual(calls,[{action:'cancelRun',payload:{id:'just-started'}}]);assert.equal(vm.stopRequested.value,true);assert.equal(vm.error.value,'');
});

test('任务或形象已切换时不选用迟到副本，保存失败恢复原选择',async()=>{
 const stale=fixture();await stale.vm.optimize();stale.draft.value.video.avatarId='other';await stale.vm.useGenerated();assert.equal(stale.draft.value.video.avatarId,'other');assert.equal(stale.events.length,0);
 const failed=fixture({save:async()=>{throw Error('磁盘不可写');}});await failed.vm.optimize();await failed.vm.useGenerated();assert.equal(failed.draft.value.video.avatarId,'source');assert.match(failed.vm.error.value,/磁盘不可写/);assert.equal(failed.vm.generated.value.avatar.id,'optimized');
});

function backgroundFixture(options={}){
 const plan={source:{draftId:'draft',avatarId:'source',sourceHash:'text-sha',finalText:'商业航天产业观察'},candidates:[{id:'background-1',label:'航天展厅·开阔',prompt:'无人航天展厅'},{id:'background-2',label:'航天展厅·层次',prompt:'无人航天展厅，柔和侧光'}]};
 const result={asset:{id:'background-image'},candidate:plan.candidates[0],source:plan.source,stale:false};
 const base=fixture({...options,call:async(action,payload)=>{if(options.call)return options.call(action,payload,{plan,result});if(action==='coverSourceSize')return {width:1080,height:1920};if(action==='planAvatarBackground')return plan;if(['generateAvatarBackground','queryAvatarBackground'].includes(action))return result;return {avatar:{id:'optimized'},asset:{id:'optimized-video'}};}});
 base.vm.background.value='content-image';return {...base,plan,result};
}

test('文案背景须先生成真实图并明确选用，人物请求绑定来源与轻度美颜',async()=>{
 const {vm,calls,draft}=backgroundFixture();await vm.planBackground();assert.equal(vm.backgroundCandidateId.value,'background-1');await vm.generateBackground();assert.equal(vm.selectedBackground.value,null);await vm.optimize();assert.equal(calls.filter(row=>row.action==='avatarOptimize').length,0);assert.match(vm.error.value,/先生成并选用/);
 vm.selectBackground();await vm.optimize();assert.deepEqual(calls.at(-1),{action:'avatarOptimize',payload:{id:'draft',avatarId:'source',look:'natural',background:'content-image',beautyStrength:12,backgroundAssetId:'background-image',sourceHash:'text-sha'}});assert.equal(draft.value.video.avatarId,'source');assert.equal(vm.generated.value.asset.id,'optimized-video');
});

test('文案、美颜与补充要求变化使不匹配预览失效',async()=>{
 const {vm,draft}=backgroundFixture();await vm.planBackground();await vm.generateBackground();vm.selectBackground();await vm.optimize();assert(vm.generated.value);vm.beautyStrength.value=0;assert.equal(vm.generated.value,null);assert.equal(vm.selectedBackground.value.asset.id,'background-image');
 vm.instruction.value='换成真实卫星地面站';assert.equal(vm.selectedBackground.value,null);assert.equal(vm.generatedBackground.value.stale,true);
 await vm.generateBackground();vm.selectBackground();draft.value.finalText='新的文案';assert.equal(vm.backgroundPlan.value,null);assert.equal(vm.selectedBackground.value,null);assert.equal(vm.generatedBackground.value.stale,true);
});

test('迟到背景与服务错误不得误选，不以假图片替代失败',async()=>{
 const stale=backgroundFixture({call:async(action,payload,{plan,result})=>action==='planAvatarBackground'?plan:{...result,stale:true}});await stale.vm.planBackground();await stale.vm.generateBackground();stale.vm.selectBackground();assert.equal(stale.vm.selectedBackground.value,null);assert.match(stale.vm.error.value,/旧文案或旧人物/);
 const failed=backgroundFixture({call:async(action,payload,{plan})=>{if(action==='planAvatarBackground')return plan;throw Error('本地 ComfyUI 不可用');}});await failed.vm.planBackground();await failed.vm.generateBackground();assert.equal(failed.vm.generatedBackground.value,null);assert.match(failed.vm.error.value,/本地 ComfyUI 不可用/);
});

test('未知背景任务只查询原任务，停止也定位背景任务',async()=>{
 const {vm,state,calls}=backgroundFixture();state.value.runs=[{id:'background-run',draftId:'draft',type:'avatar-background',status:'unknown'}];assert.equal(vm.canQueryBackground.value,true);await vm.queryBackground();assert.deepEqual(calls[0],{action:'queryAvatarBackground',payload:{id:'draft',runId:'background-run'}});assert.equal(vm.selectedBackground.value,null);assert(vm.generatedBackground.value);assert(!calls.some(row=>row.action==='generateAvatarBackground'));
 state.value.runs[0].status='running';await vm.stop();assert.deepEqual(calls.at(-1),{action:'cancelRun',payload:{id:'background-run'}});
});

test('美颜可以单独启用，关闭后拒绝无处理的原片副本',async()=>{
 const {vm,calls}=fixture();vm.look.value='original';vm.background.value='original';vm.beautyStrength.value=12;await vm.optimize();assert.equal(calls.length,1);assert.equal(calls[0].payload.beautyStrength,12);vm.beautyStrength.value=0;await vm.optimize();assert.equal(calls.length,1);assert.match(vm.error.value,/至少选择/);
});

test('形象生成期间更换文案，不重新展示迟到副本供当前文案选用',async()=>{
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});const {vm,draft}=fixture({call:async()=>waiting});const work=vm.optimize();draft.value.finalText='更新的最终文案';finish({avatar:{id:'late-copy'},asset:{id:'late-video'}});await work;assert.equal(vm.generated.value,null);assert.equal(draft.value.video.avatarId,'source');assert.match(vm.error.value,/当前文案、任务或人物已变化/);
});

test('轮询刷新用同值对象替换草稿时，保留当前背景选择和预览',async()=>{
 const {vm,draft}=backgroundFixture();await vm.planBackground();await vm.generateBackground();vm.selectBackground();await vm.optimize();draft.value=JSON.parse(JSON.stringify(draft.value));assert.equal(vm.selectedBackground.value.asset.id,'background-image');assert.equal(vm.generated.value.asset.id,'optimized-video');assert.equal(vm.backgroundPlan.value.source.sourceHash,'text-sha');
});

test('重新打开从成功记录恢复背景候选，真实图片须再次明确选用',()=>{
 const {vm,state,result}=backgroundFixture();state.value.assets.push({id:'background-image',type:'image',name:'航天背景'});state.value.runs=[{id:'saved-run',draftId:'draft',type:'avatar-background',status:'succeeded',output:result,parameters:{instruction:'侧光'}}];assert.equal(vm.backgroundHistory.value.length,1);assert.equal(vm.selectedBackground.value,null);vm.previewHistory(vm.backgroundHistory.value[0]);assert.equal(vm.generatedBackground.value.asset.id,'background-image');assert.equal(vm.selectedBackground.value,null);vm.selectBackground();assert.equal(vm.selectedBackground.value.asset.id,'background-image');
});

test('历史记录过滤其他人物和不存在的图片，旧文案候选不可选用',()=>{
 const {vm,state,result,draft}=backgroundFixture();state.value.assets.push({id:'background-image',type:'image'});state.value.runs=[{id:'saved-run',draftId:'draft',type:'avatar-background',status:'succeeded',output:result},{id:'other-avatar',draftId:'draft',type:'avatar-background',status:'succeeded',output:{...result,source:{...result.source,avatarId:'other'}}},{id:'missing',draftId:'draft',type:'avatar-background',status:'succeeded',output:{...result,asset:{id:'missing-image'}}}];assert.equal(vm.backgroundHistory.value.length,1);draft.value.finalText='新的主题';assert.equal(vm.backgroundHistory.value[0].stale,true);vm.previewHistory(vm.backgroundHistory.value[0]);assert.equal(vm.generatedBackground.value,null);assert.equal(vm.selectedBackground.value,null);
});

test('背景比例跟随视频设置，未配置时读取显示尺寸，不硬编码竖屏',async()=>{
 const horizontal=backgroundFixture();horizontal.draft.value.video.aspect='16:9';await horizontal.vm.planBackground();await horizontal.vm.generateBackground();assert.equal(horizontal.calls.find(row=>row.action==='planAvatarBackground').payload.aspect,'16:9');assert.equal(horizontal.calls.find(row=>row.action==='generateAvatarBackground').payload.aspect,'16:9');assert(!horizontal.calls.some(row=>row.action==='coverSourceSize'));
 const measured=backgroundFixture({call:async(action,payload,{plan,result})=>action==='coverSourceSize'?{width:1440,height:1080}:action==='planAvatarBackground'?plan:result});delete measured.draft.value.video.aspect;await measured.vm.planBackground();assert.deepEqual(measured.calls[0],{action:'coverSourceSize',payload:{assetId:'source-video'}});assert.equal(measured.calls.find(row=>row.action==='planAvatarBackground').payload.aspect,'4:3');
});

test('无可靠尺寸时明确要求选择比例，不偷偷生成9:16背景',async()=>{
 const {vm,draft,calls}=backgroundFixture({call:async()=>{throw Error('无法解析视频');}});delete draft.value.video.aspect;await vm.planBackground();assert.equal(vm.backgroundPlan.value,null);assert.match(vm.error.value,/手动选择背景比例/);assert(!calls.some(row=>row.action==='planAvatarBackground'));
});

test('比例改变撤销旧方案与已选图片，不能按旧比例发新任务',async()=>{
 const {vm,calls}=backgroundFixture();await vm.planBackground();await vm.generateBackground();vm.selectBackground();vm.backgroundAspect.value='16:9';assert.equal(vm.backgroundPlan.value,null);assert.equal(vm.selectedBackground.value,null);await vm.generateBackground();assert.equal(calls.filter(row=>row.action==='generateAvatarBackground').length,1);
});

test('查询其他人物的未知背景结果时只能查看，不绑定给当前人物',async()=>{
 const {vm,state}=backgroundFixture({call:async(action,payload,{result})=>({...result,source:{...result.source,avatarId:'different-avatar'}})});state.value.runs=[{id:'old-unknown',draftId:'draft',type:'avatar-background',status:'unknown'}];await vm.queryBackground();assert.equal(vm.generatedBackground.value.stale,true);vm.selectBackground();assert.equal(vm.selectedBackground.value,null);
});
