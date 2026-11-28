const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{computed,ref,watch}=require('vue');
const {parse,compileScript,compileStyle,compileTemplate}=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../src/components/VideoPanel.vue');
const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename});
const compiled=compileScript(descriptor,{id:'video-production-plan-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
const componentNames=['I','VideoResult','AvatarSelect','DropdownSelect','VideoShotsEditor','VideoDriverAudio','StoryStudio','ProductStudio','AvatarOptimizeDialog'];
const plan=()=>({version:'production-plan-v1',status:'inferred',presentation:'narrated-scenes',mode:'story',contentType:{id:'knowledge',name:'知识讲解'},confidence:'medium',reason:'用示意画面解释原理，并保留旁白。',cues:['讲解原理'],steps:['拆分镜头','确认画面资产'],requirements:['核对信息来源'],reference:{sourceRunId:'reference'}});

// 执行真实组件 setup，隔离宿主保存、IPC 与刷新，不访问模型或用户工作区。
function fixture(options={}){
 const draft=ref({id:'draft',confirmed:true,finalText:'这是一段已确认的知识讲解文案。',sourceUrl:'',voice:{audioId:''},video:{mode:'single',productionInstruction:'使用动画搭配旁白',shots:[],routing:{policy:'auto',mode:'single',confidence:'low',reason:'等待识别'}}});
 const state=ref({runs:[],assets:[],avatars:[],settings:{provider:{}}}),busy=ref(''),workflowLocked=ref(false),calls=[],events=[];
 let leave=()=>{};
 const save=async()=>{events.push('save');if(options.save)await options.save(draft);};
 const studio={draft,state,busy,workflowLocked,save,navigate(){},notify:(...message)=>events.push(message),act:async(label,work)=>{if(busy.value||workflowLocked.value)return;busy.value=label;try{await save();return await work();}catch(error){events.push(['error',error.message]);return undefined;}finally{busy.value='';}}};
 const call=async(action,payload)=>{calls.push({action,payload});events.push(action);return options.call?options.call({draft,state,action,payload}):{plan:plan(),stale:false};};
 const component=new Function('computed','inject','onBeforeUnmount','ref','watch','call','shotInputSignature','shotTotal',...componentNames,compiled)(computed,()=>studio,callback=>{leave=callback;},ref,watch,call,()=>'',()=>0,...componentNames.map(()=>({})));
 const vm=component.setup({}, {expose(){},emit(){}});
 return {vm,draft,state,busy,workflowLocked,calls,events,unmount:()=>leave()};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('制作计划真实模板、样式和脚本可编译',()=>{
 assert.deepEqual(errors,[]);
 assert.deepEqual(compileTemplate({id:'video-production-plan-ui',source:descriptor.template.content,filename}).errors,[]);
 const css=fs.readFileSync(path.resolve(__dirname,'../src/video-production-plan.css'),'utf8');
 assert.deepEqual(compileStyle({id:'video-production-plan-ui',source:css,filename:'video-production-plan.css'}).errors,[]);
});

test('只显示后端确认有效的计划摘要，历史原始计划不冒充当前识别',()=>{
 const {vm,draft}=fixture();draft.value.video.productionPlan=plan();assert.equal(vm.productionPlan.value,null);
 draft.value.video.routing.productionPlan=plan();assert.equal(vm.productionPlan.value.contentType.name,'知识讲解');assert.equal(vm.presentationLabel.value,'分镜画面＋旁白');assert.match(vm.referenceBasis.value,/文字拆解/);
 draft.value.video.routing.productionPlan.reference.visualObservations=[{description:'第一处采样'},{description:'第二处采样'}];assert.match(vm.referenceBasis.value,/2 个采样画面/);assert.match(vm.referenceBasis.value,/不能代表逐帧/);
 delete draft.value.video.routing.productionPlan;assert.equal(vm.productionPlan.value,null);assert.equal(vm.presentationLabel.value,'单形象口播');
});

test('制作要求独立保存后识别，结果不会直接覆盖草稿',async()=>{
 const {vm,draft,calls,events}=fixture();const originalText=draft.value.finalText;
 await vm.identifyProduction();assert.deepEqual(calls,[{action:'planVideo',payload:{id:'draft'}}]);assert(events.indexOf('save')<events.indexOf('planVideo'));
 assert.equal(draft.value.finalText,originalText);assert.equal(draft.value.video.mode,'single');assert.equal(draft.value.video.productionInstruction,'使用动画搭配旁白');assert.equal(draft.value.video.productionPlan,undefined);assert.match(vm.planNotice.value,/已更新制作建议/);assert.equal(vm.planning.value,false);
});

test('手动模式只保存独立制作要求，不调用识别、不改变制作方式',async()=>{
 const {vm,draft,calls,events}=fixture();draft.value.video.routing.policy='manual';await vm.identifyProduction();assert.equal(calls.length,0);assert(events.includes('save'));assert.equal(draft.value.video.mode,'single');assert.equal(draft.value.video.routing.policy,'manual');assert.match(vm.planNotice.value,/保持当前手动/);assert.doesNotMatch(vm.planNotice.value,/已更新识别/);
});

test('首次保存尚未完成也锁住重复识别，保存后只提交一次',async()=>{
 const pending=deferred();let saves=0;const {vm,calls}=fixture({save:async()=>{if(++saves===1)await pending.promise;}});
 const first=vm.identifyProduction();assert.equal(vm.locked.value,true);await vm.identifyProduction();assert.equal(calls.length,0);pending.resolve();await first;assert.equal(calls.length,1);assert.equal(vm.locked.value,false);
});

test('已有任务和输入边界阻止识别，包括未知生成状态',async()=>{
 const {vm,state,busy,workflowLocked,draft,calls}=fixture();busy.value='其他操作';await vm.identifyProduction();busy.value='';workflowLocked.value=true;await vm.identifyProduction();workflowLocked.value=false;
 state.value.runs=[{id:'generation',draftId:'draft',type:'story-video',status:'unknown'}];await vm.identifyProduction();state.value.runs=[];
 draft.value.confirmed=false;await vm.identifyProduction();assert.match(vm.planDisabledReason.value,/确认最终文案/);draft.value.confirmed=true;draft.value.video.productionInstruction='字'.repeat(1501);await vm.identifyProduction();assert.match(vm.planDisabledReason.value,/1500/);assert.equal(calls.length,0);
});

test('保存期间换任务、改文案、改参考或离开页面，不提交旧识别',async()=>{
 for(const change of [f=>{f.draft.value.id='other';},f=>{f.draft.value.finalText='修改后的文案';},f=>{f.draft.value.referenceSelection={sourceRunId:'new-reference'};},f=>f.unmount()]){
  const pending=deferred(),f=fixture({save:()=>pending.promise});const work=f.vm.identifyProduction();change(f);pending.resolve();await work;assert.equal(f.calls.length,0);assert.equal(f.vm.planning.value,false);
 }
});

test('act再次保存期间更换输入也会在IPC前拒绝',async()=>{
 let saves=0;const f=fixture({save:async draft=>{if(++saves===2)draft.value.video.productionInstruction='新的制作要求';}});await f.vm.identifyProduction();assert.equal(f.calls.length,0);assert.match(f.vm.planNotice.value,/已变化/);
});

test('识别中编辑当前稿或服务返回过期结果，不回填迟到计划',async()=>{
 const pending=deferred(),f=fixture({call:()=>pending.promise});const work=f.vm.identifyProduction();await tick();assert.equal(f.calls.length,1);f.draft.value.finalText='用户在等待期间修改的文案';pending.resolve({plan:plan(),stale:false});await work;
 assert.equal(f.draft.value.finalText,'用户在等待期间修改的文案');assert.equal(f.draft.value.video.routing.productionPlan,undefined);assert.match(f.vm.planNotice.value,/未用于当前制作/);
 const stale=fixture({call:async()=>({plan:plan(),stale:true})});await stale.vm.identifyProduction();assert.match(stale.vm.planNotice.value,/未用于当前制作/);assert.equal(stale.draft.value.video.mode,'single');
});

test('识别中换任务或卸载，不给新页面显示旧操作提示',async()=>{
 for(const change of [f=>{f.draft.value.id='other';},f=>f.unmount()]){
  const pending=deferred(),f=fixture({call:()=>pending.promise});const work=f.vm.identifyProduction();await tick();change(f);pending.resolve({plan:plan(),stale:false});await work;assert.equal(f.vm.planNotice.value,'');assert.equal(f.vm.planError.value,'');assert.equal(f.draft.value.video.routing.productionPlan,undefined);
 }
});

test('保存和IPC错误显示真实原因，释放锁且保留制作要求',async()=>{
 const failedSave=fixture({save:async()=>{throw Error('草稿保存失败');}});await failedSave.vm.identifyProduction();assert.equal(failedSave.calls.length,0);assert.equal(failedSave.vm.planError.value,'草稿保存失败');assert.equal(failedSave.vm.locked.value,false);
 const failedIPC=fixture({call:async()=>{throw Error('当前文本模型未配置');}});await failedIPC.vm.identifyProduction();assert.equal(failedIPC.vm.planError.value,'当前文本模型未配置');assert.equal(failedIPC.draft.value.video.productionInstruction,'使用动画搭配旁白');assert.equal(failedIPC.vm.locked.value,false);
});

test('规则回退准确提示为规则建议，不写语义识别或质量通过',async()=>{
 const f=fixture({call:async()=>({plan:{...plan(),status:'fallback'},stale:false})});await f.vm.identifyProduction();assert.match(f.vm.planNotice.value,/规则/);assert.doesNotMatch(f.vm.planNotice.value,/质量.*通过|语义识别完成/);
});
