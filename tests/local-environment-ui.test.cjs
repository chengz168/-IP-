const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');

async function fixture(options={}){
 const filename=path.resolve(__dirname,'../src/components/LocalEnvironment.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const helpers=await import('../src/local-environment-ui.mjs'),state=vue.ref({settings:{localEnvironment:{autoStart:true,comfyRoot:'D:/ComfyUI',comfyPython:'',ollamaExecutable:''}},localEnvironment:{status:'ready',checking:false,services:[]}}),calls=[];
 const call=async(action,payload)=>{calls.push({action,payload});if(options.call)return options.call(action,payload,state);if(action==='saveLocalEnvironment')state.value.settings.localEnvironment=structuredClone(payload.settings);return {status:'ready',checking:false,services:[]};};
 const studio={state,refresh:options.refresh||(async()=>{})};
 const code=sfc.compileScript(descriptor,{id:'local-environment-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const names=['computed','inject','ref','watch','I','call',...Object.keys(helpers)],values=[vue.computed,()=>studio,vue.ref,vue.watch,{},call,...Object.values(helpers)],scope=vue.effectScope();
 const component=new Function(...names,code)(...values),vm=scope.run(()=>component.setup({configure:options.configure!==false},{expose(){},emit(){}}));
 return {vm,state,calls,descriptor,filename,dispose:()=>scope.stop()};
}

test('环境组件、模型设置与标题栏真实模板可编译且组件样式可编译',()=>{
 for(const relative of ['src/components/LocalEnvironment.vue','src/views/SettingsView.vue','src/App.vue']){
  const filename=path.resolve(__dirname,'..',relative),{descriptor,errors}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(errors,[]);
  const script=sfc.compileScript(descriptor,{id:'env-compile'});assert(script.content);assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename,id:'env-compile',compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
  for(const style of descriptor.styles)assert.deepEqual(sfc.compileStyle({source:style.content,filename,id:'env-compile',scoped:style.scoped}).errors,[]);
 }
});

test('状态文案区分服务响应、按需加载与外部服务，不把预检当推理成功',async()=>{
 const h=await import('../src/local-environment-ui.mjs');assert.equal(h.localEnvironmentSummary(), '本地环境待检查');assert.equal(h.localEnvironmentStatus({status:'ready'}),'服务已响应');assert.equal(h.localEnvironmentStatus({status:'on-demand'}),'按任务加载');assert.equal(h.localEnvironmentStatus({status:'external'}),'外部服务');assert(h.localEnvironmentBusy({status:'starting'}));assert(h.localEnvironmentBusy({status:'ready',checking:true}));assert(!h.localEnvironmentBusy({status:'ready'}));assert.equal(h.localEnvironmentConfig({}).autoStart,true);assert.equal(h.localEnvironmentConfig({autoStart:false}).autoStart,false);
});

test('轮询更新未修改的配置，用户未保存路径和开关保持不变',async()=>{
 const f=await fixture();try{
  f.state.value.settings.localEnvironment.comfyRoot='E:/Changed';await vue.nextTick();assert.equal(f.vm.config.value.comfyRoot,'E:/Changed');
  f.vm.config.value.comfyRoot='F:/Unsaved';f.vm.config.value.autoStart=false;
  f.state.value.settings.localEnvironment={autoStart:true,comfyRoot:'G:/Remote'};await vue.nextTick();assert.equal(f.vm.config.value.comfyRoot,'F:/Unsaved');assert.equal(f.vm.config.value.autoStart,false);assert(f.vm.dirty.value);
 }finally{f.dispose();}
});

test('专用保存只传启动配置，成功后清理待保存并使用服务器规范配置',async()=>{
 const f=await fixture({call:async(action,payload,state)=>{assert.equal(action,'saveLocalEnvironment');assert.deepEqual(Object.keys(payload),['settings']);state.value.settings.localEnvironment={...payload.settings,comfyRoot:payload.settings.comfyRoot.trim()};return {status:'idle',checking:false,services:[]};}});try{
  f.vm.config.value.comfyRoot=' E:/Comfy ';await f.vm.operate('saveLocalEnvironment');assert.equal(f.calls.length,1);assert.equal(f.vm.config.value.comfyRoot,'E:/Comfy');assert(!f.vm.dirty.value);assert.match(f.vm.message.value,/已保存/);assert.equal(f.vm.error.value,'');
 }finally{f.dispose();}
});

test('启动使用保存后的配置，未保存配置先提示且不提交',async()=>{
 const f=await fixture();try{f.vm.config.value.comfyRoot='D:/Unsaved';await f.vm.operate('ensureLocalEnvironment');assert.equal(f.calls.length,0);assert.match(f.vm.error.value,/尚未保存/);await f.vm.operate('saveLocalEnvironment');await f.vm.operate('ensureLocalEnvironment');assert.deepEqual(f.calls[1],{action:'ensureLocalEnvironment',payload:{}});assert.equal(f.vm.pending.value,'');}finally{f.dispose();}
});

test('并发点击检查不重复启动，服务检查中禁止重复操作且失败反馈可重试',async()=>{
 let resolve;const task=new Promise(done=>resolve=done);const f=await fixture({call:async()=>task});try{
  const first=f.vm.operate('ensureLocalEnvironment');assert(f.vm.blocked.value);await f.vm.operate('ensureLocalEnvironment');assert.equal(f.calls.length,1);resolve({status:'degraded',checking:false,services:[{id:'comfy',status:'failed',message:'Python路径无效'}]});await first;assert.equal(f.state.value.localEnvironment.services[0].message,'Python路径无效');assert(!f.vm.blocked.value);
  f.state.value.localEnvironment.checking=true;await f.vm.operate('ensureLocalEnvironment');assert.equal(f.calls.length,1);
 }finally{f.dispose();}
 const failed=await fixture({call:async()=>{throw Error('启动失败：未找到本机 Python');}});try{await failed.vm.operate('ensureLocalEnvironment');assert.match(failed.vm.error.value,/未找到本机 Python/);assert.equal(failed.vm.pending.value,'');assert(!failed.vm.blocked.value);}finally{failed.dispose();}
});

test('保存失败保留输入、待保存状态，环境详情不调用全局 act 或保存草稿',async()=>{
 const f=await fixture({call:async()=>{throw Error('保存路径校验失败');}});try{f.vm.config.value.comfyPython='D:/Missing/python.exe';await f.vm.operate('saveLocalEnvironment');assert(f.vm.dirty.value);assert.equal(f.vm.config.value.comfyPython,'D:/Missing/python.exe');assert.match(f.vm.error.value,/校验失败/);assert.doesNotMatch(f.descriptor.scriptSetup.content,/\bact\(|\bsaveDraft\b/);}finally{f.dispose();}
});

test('真实 App 在检查中及时轮询、空闲时低频只读刷新，并能直达模型设置',async()=>{
 const filename=path.resolve(__dirname,'../src/App.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}),helpers=await import('../src/local-environment-ui.mjs');
 let mounted,tick,now=0;const calls=[],data={currentId:'draft',drafts:[{id:'draft',sourceText:'验收原文'}],settings:{view:'new',fontSize:'comfortable'},runs:[],accounts:[],workflowJobs:[],localEnvironment:{status:'ready',checking:false,services:[]}};
 const call=async action=>{calls.push(action);return structuredClone(data);};
 const names=['ref','computed','watch','onMounted','onUnmounted','provide','I','Modal','Workflow','LegacyWorkflow','Resources','SettingsView','TaskCenter','call','pickFiles','OperationStatus','LocalEnvironment','applyTypography','workflowView','copySourceChanged','window','setInterval','clearInterval','setTimeout','clearTimeout','Date',...Object.keys(helpers)];
 const values=[vue.ref,vue.computed,vue.watch,fn=>mounted=fn,()=>{},()=>{},{},{},{},{},{},{},{},call,()=>{},{},{},()=>{},()=>{},()=>false,{studio:{}},fn=>(tick=fn,1),()=>{},()=>1,()=>{},{now:()=>now},...Object.values(helpers)];
 const code=sfc.compileScript(descriptor,{id:'environment-app-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),scope=vue.effectScope(),component=new Function(...names,code)(...values),vm=scope.run(()=>component.setup({}, {expose(){}}));
 try{
  await mounted();assert.deepEqual(calls,['state']);now=2000;tick();await vue.nextTick();assert.equal(calls.length,1);
  now=16000;tick();await vue.nextTick();assert.equal(calls.length,2);
  data.localEnvironment={status:'checking',checking:true,services:[]};await vm.refresh();now=18000;tick();await vue.nextTick();assert.equal(calls.length,4);assert(calls.every(action=>action==='state'));
  vm.environmentDialog.value=true;await vm.openEnvironmentSettings();assert.equal(vm.environmentDialog.value,false);assert.equal(vm.page.value,'settings');assert.equal(vm.settingsInitialTab.value,'models');
 }finally{scope.stop();}
});

test('真实模型设置保存不把旧启动配置快照写回专用配置',async()=>{
 const filename=path.resolve(__dirname,'../src/views/SettingsView.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const modules=await Promise.all([import('../src/provider-key-drafts.mjs'),import('../src/model-settings.mjs'),import('../src/typography.mjs')]),helpers=Object.assign({},...modules),calls=[];
 const state=vue.ref({settings:{provider:{},localEnvironment:{autoStart:true,comfyRoot:'D:/Old'}},drafts:[],assets:[],runs:[]}),studio={state,busy:vue.ref(''),act:async(_,work)=>work(),notify(){},showDialog(){},refresh:async()=>{}};
 const names=['computed','inject','ref','watch','onBeforeUnmount','I','call','Modal','PromptManager','ModelPicker','CapabilityKeys','LocalEnvironment','window',...Object.keys(helpers)],values=[vue.computed,()=>studio,vue.ref,vue.watch,()=>{},{},async(action,payload)=>{calls.push({action,payload});return true;},{},{},{},{},{},{studio:{}},...Object.values(helpers)];
 const code=sfc.compileScript(descriptor,{id:'environment-settings-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),scope=vue.effectScope(),component=new Function(...names,code)(...values),vm=scope.run(()=>component.setup({initialTab:'models'}, {expose(){}}));
 try{assert.equal(vm.tab.value,'models');state.value.settings.localEnvironment.comfyRoot='E:/Fresh';await vm.save();assert.equal(calls[0].action,'saveSettings');assert(!Object.hasOwn(calls[0].payload,'localEnvironment'));assert(calls[0].payload.provider);assert.equal(state.value.settings.localEnvironment.comfyRoot,'E:/Fresh');}finally{scope.stop();}
});
