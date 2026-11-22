const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vue=require('vue');
const sfc=require('@vue/compiler-sfc');

const filename=path.resolve(__dirname,'../src/components/CreativePresets.vue');
const descriptor=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}).descriptor;
const compiled=sfc.compileScript(descriptor,{id:'creative-presets-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
const response=(name='知识讲解')=>({catalog:[{id:'knowledge',name:'知识讲解',stages:['script','rewrite']}],selection:{mode:'auto',presetId:'',instruction:''},route:{id:'knowledge',name,mode:'auto',rules:['用可核实的例子解释概念'],version:'2026-11-22.1',sources:[{id:'writing',name:'公开写作方法',url:'https://example.test/skill',revision:'r1'}]}});
async function fixture(handler){
 const draft=vue.ref({id:'one',tab:'topic',sourceText:'已保存的正文'}),state=vue.ref({runs:[]}),calls=[];
 const props=vue.reactive({stage:'script',context:{kind:'product'},disabled:false});
 let currentHandler=handler||(async action=>{if(action==='creativePresetPreview')return response();if(action==='saveCreativePreset')return {};throw Error(action);});
 const studio={draft,state,busy:vue.ref(''),workflowLocked:vue.ref(false),save:async()=>{calls.push({action:'save'});},refresh:async()=>{calls.push({action:'refresh'});}};
 const call=async(action,payload)=>{calls.push({action,payload:JSON.parse(JSON.stringify(payload))});return currentHandler(action,payload);};
 const dispose=[];
 const component=new Function('computed','inject','onBeforeUnmount','ref','watch','call','setTimeout','clearTimeout',compiled)(vue.computed,()=>studio,fn=>dispose.push(fn),vue.ref,vue.watch,call,()=>1,()=>{});
 const scope=vue.effectScope(),vm=scope.run(()=>component.setup(props,{expose(){}}));
 await vue.nextTick();await Promise.resolve();
 return{draft,state,props,vm,calls,handler(fn){currentHandler=fn;},dispose(){dispose.forEach(fn=>fn());scope.stop();}};
}

test('预设卡初次读取使用流程上下文，不给旧任务自动写默认值',async()=>{
 const f=await fixture();try{assert.deepEqual(f.calls.map(x=>x.action),['creativePresetPreview']);assert.deepEqual(f.calls[0].payload,{id:'one',stage:'script',context:{kind:'product'}});assert.equal(Object.hasOwn(f.draft.value,'creativePreset'),false);assert.equal(f.vm.routeTitle.value,'知识讲解');assert.equal(f.vm.dirty.value,false);assert.equal(f.vm.sourceRows.value[0].version,'r1');assert.deepEqual(sfc.compileTemplate({id:'creative-presets-ui',filename,source:descriptor.template.content}).errors,[]);}finally{f.dispose();}
});

test('推荐刷新失败保留未保存选择和创作要求，重试也不覆盖编辑',async()=>{
 const f=await fixture();try{f.vm.mode.value='manual';f.vm.presetId.value='knowledge';f.vm.instruction.value='使用生活化例子';f.handler(async()=>{throw Error('服务暂不可用');});await f.vm.loadPreview();assert.match(f.vm.error.value,/服务暂不可用/);assert.equal(f.vm.instruction.value,'使用生活化例子');f.handler(async()=>response('通用表达'));await f.vm.loadPreview();assert.equal(f.vm.routeTitle.value,'通用表达');assert.equal(f.vm.mode.value,'manual');assert.equal(f.vm.presetId.value,'knowledge');assert.equal(f.vm.instruction.value,'使用生活化例子');assert.equal(f.vm.dirty.value,true);}finally{f.dispose();}
});

test('保存先保护同页草稿；服务拒绝不丢编辑，成功后才刷新已保存设置',async()=>{
 const f=await fixture();try{f.vm.instruction.value='先说明问题再解释';f.handler(async action=>{if(action==='saveCreativePreset')throw Error('暂时无法写入');return response();});await f.vm.persist();assert.deepEqual(f.calls.slice(-2).map(x=>x.action),['save','saveCreativePreset']);assert.match(f.vm.error.value,/暂时无法写入/);assert.equal(f.vm.dirty.value,true);assert.equal(f.vm.instruction.value,'先说明问题再解释');f.handler(async action=>action==='creativePresetPreview'?response():{});await f.vm.persist();assert.deepEqual(f.calls.slice(-4).map(x=>x.action),['save','saveCreativePreset','refresh','creativePresetPreview']);assert.equal(f.vm.dirty.value,false);assert.equal(f.vm.saving.value,false);}finally{f.dispose();}
});

test('切换任务或阶段会拒绝旧推荐响应，不污染新任务',async()=>{
 const pending=[];const f=await fixture((action,payload)=>new Promise(resolve=>pending.push({payload,resolve})));try{assert.equal(pending.length,1);f.draft.value={id:'two',tab:'topic'};await vue.nextTick();assert.equal(pending.length,2);pending[1].resolve(response('新任务推荐'));await Promise.resolve();await Promise.resolve();pending[0].resolve(response('旧任务推荐'));await Promise.resolve();await Promise.resolve();assert.equal(f.vm.routeTitle.value,'新任务推荐');f.props.stage='rewrite';await vue.nextTick();assert.equal(pending[2].payload.stage,'rewrite');assert.equal(f.vm.route.value,null);}finally{f.dispose();}
});

test('不适用阶段和运行锁不能保存，关闭预设可显式保存',async()=>{
 const f=await fixture();try{f.vm.mode.value='manual';f.vm.presetId.value='wrong';assert.equal(f.vm.manualMismatch.value,true);await f.vm.persist();assert.equal(f.calls.length,1);f.vm.mode.value='off';f.props.disabled=true;await f.vm.persist();assert.equal(f.calls.length,1);f.props.disabled=false;await f.vm.persist();assert.equal(f.calls.find(x=>x.action==='saveCreativePreset').payload.selection.mode,'off');}finally{f.dispose();}
});
