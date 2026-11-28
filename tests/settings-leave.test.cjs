const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');

function compile(relative,context,props={}){
 // 组件编译测试剥离 import，显式补齐展示与通知依赖；导航守卫继续使用真实逻辑。
 context={ActivationDialog:{},FirstRunWizard:{},CreativeLearning:{},EnhancedToast:{},WorkspaceNavigation:{},useNotification:()=>({toast:vue.ref(null),notify(){},success(){},error(){},warning(){},progress(){},dismiss(){},dismissTransient(){}}),useGlobalShortcuts:()=>({register:()=>()=>{}}),...require('../src/release-ui.mjs'),...context};
 const filename=path.resolve(__dirname,'..',relative),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const script=sfc.compileScript(descriptor,{id:'settings-leave'}),code=script.content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const component=new Function(...Object.keys(context),code)(...Object.values(context)),scope=vue.effectScope();
 let exposed;const vm=scope.run(()=>component.setup(props,{expose:value=>exposed=value,emit(){}}));
 return {vm,exposed,descriptor,dispose:()=>scope.stop()};
}
async function settingsFixture(options={}){
 const helpers=Object.assign({},...await Promise.all(['provider-key-drafts','model-settings','typography'].map(name=>import('../src/'+name+'.mjs'))));
 const state=vue.ref({settings:{theme:'default',fontSize:'comfortable',view:'new',provider:{},localEnvironment:{autoStart:true,comfyRoot:'D:/Old'}},drafts:[],assets:[],runs:[]}),calls=[],messages=[];
 let registered,unmounted;
 const studio={state,busy:vue.ref(''),act:async(_,work)=>{try{return await work();}catch(error){messages.push(error.message);return undefined;}},notify:message=>messages.push(message),showDialog(){},refresh:async()=>{},registerPageLeaveGuard:guard=>{registered=guard;return ()=>registered=null;}};
 const call=async(action,payload)=>{calls.push({action,payload});if(options.call)return options.call(action,payload,state);return true;};
 const f=compile('src/views/SettingsView.vue',{computed:vue.computed,inject:()=>studio,ref:vue.ref,watch:vue.watch,onBeforeUnmount:fn=>unmounted=fn,I:{},call,Modal:{},PromptManager:{},ModelPicker:{},CapabilityKeys:{},LocalEnvironment:{},window:{studio:{}},...helpers},{initialTab:'models'});
 return {...f,state,calls,messages,guard:()=>registered,cleanup(){unmounted();f.dispose();}};
}

test('设置未修改直接离开，输入修改后取消与放弃各自保持明确结果',async()=>{
 const f=await settingsFixture();try{
  assert.equal(f.guard()(),true);assert(!f.vm.settingsDirty.value);
  f.vm.config.value.provider.baseUrl='http://127.0.0.1:9999';const cancelled=f.guard()();assert(f.vm.leaveDialog.value);assert.equal(f.calls.length,0);
  f.vm.resolveLeave(false);assert.equal(await cancelled,false);assert.equal(f.vm.config.value.provider.baseUrl,'http://127.0.0.1:9999');assert(f.vm.settingsDirty.value);
  const discarded=f.guard()();f.vm.resolveLeave(true);assert.equal(await discarded,true);assert.equal(f.calls.length,0);
 }finally{f.cleanup();}
});

test('保存失败不离开、保留地址与密钥输入，取消后可重试',async()=>{
 const f=await settingsFixture({call:async()=>{throw Error('连接参数保存失败');}});try{
  f.vm.config.value.provider.baseUrl='https://example.invalid/v1';f.vm.key.value='memory-only-test-key';f.vm.changeKey.value=true;
  const waiting=f.guard()();await f.vm.saveAndLeave();assert(f.vm.leaveDialog.value);assert(f.vm.settingsDirty.value);assert.match(f.vm.leaveError.value,/未能保存/);
  assert.equal(f.vm.key.value,'memory-only-test-key');assert.equal(f.vm.config.value.provider.baseUrl,'https://example.invalid/v1');assert.equal(f.calls.length,1);f.vm.resolveLeave(false);assert.equal(await waiting,false);
 }finally{f.cleanup();}
});

test('明确保存后才提交密钥，成功清理内存输入与待保存状态',async()=>{
 const f=await settingsFixture();try{
  f.vm.config.value.outputDir='E:/Export';f.vm.key.value='memory-only-test-key';f.vm.changeKey.value=true;f.vm.keyDrafts.value.tts={action:'set',value:'tts-memory-key',error:''};
  const waiting=f.guard()();assert.equal(f.calls.length,0);await f.vm.saveAndLeave();assert.equal(await waiting,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.key,'memory-only-test-key');assert.equal(f.calls[0].payload.capabilityKeys.tts,'tts-memory-key');assert(!Object.hasOwn(f.calls[0].payload,'localEnvironment'));
  assert.equal(f.vm.key.value,'');assert(!f.vm.changeKey.value);assert.equal(f.vm.keyDrafts.value.tts.value,'');assert(!f.vm.settingsDirty.value);assert.equal(f.guard()(),true);
 }finally{f.cleanup();}
});

test('未勾选更新的密钥输入不能在保存并离开时悄悄丢弃',async()=>{
 const f=await settingsFixture();try{
  f.vm.key.value='unconfirmed-memory-key';const waiting=f.guard()();await f.vm.saveAndLeave();assert.equal(f.calls.length,0);assert(f.vm.leaveDialog.value);assert.equal(f.vm.key.value,'unconfirmed-memory-key');assert(f.messages.some(message=>message.includes('勾选')));f.vm.resolveLeave(false);assert.equal(await waiting,false);
 }finally{f.cleanup();}
});

test('启动配置独立保存，失败留页；切设置分类不卸载该编辑器',async()=>{
 const f=await settingsFixture();try{
  let count=0;f.vm.environmentEditor.value={dirty:true,blocked:false,save:async()=>{count++;return false;}};
  const waiting=f.guard()();await f.vm.saveAndLeave();assert(f.vm.leaveDialog.value);assert.match(f.vm.leaveError.value,/启动配置/);assert.equal(f.calls.length,0);assert.equal(count,1);
  f.vm.tab.value='general';assert(f.vm.hasUnsavedSettings.value);f.vm.tab.value='models';f.vm.environmentEditor.value.save=async()=>{count++;f.vm.environmentEditor.value.dirty=false;return true;};
  await f.vm.saveAndLeave();assert.equal(await waiting,true);assert.equal(count,2);assert.equal(f.calls.length,0);
  const tree=sfc.compileTemplate({source:f.descriptor.template.content,filename:'SettingsView.vue',id:'settings-leave'});assert.deepEqual(tree.errors,[]);
  assert.match(f.descriptor.template.content,/v-show="tab==='models'"[^>]*><LocalEnvironment ref="environmentEditor" configure/);assert.doesNotMatch(f.descriptor.template.content,/:key="tab"/);
 }finally{f.cleanup();}
});

test('一般设置保存不覆盖已独立更新的启动配置，已生效字号不产生离开误报',async()=>{
 const f=await settingsFixture();try{
  f.state.value.settings.localEnvironment.comfyRoot='F:/New';f.vm.config.value.theme='midnight';await f.vm.save();assert(!Object.hasOwn(f.calls[0].payload,'localEnvironment'));assert.equal(f.state.value.settings.localEnvironment.comfyRoot,'F:/New');assert(!f.vm.settingsDirty.value);
 }finally{f.cleanup();}
 const font=await settingsFixture({call:async(action,payload)=>action==='saveAppearance'?{fontSize:payload.fontSize}:true});try{await font.vm.changeFontSize('large');assert.equal(font.vm.config.value.fontSize,'large');assert(!font.vm.settingsDirty.value);}finally{font.cleanup();}
});

test('设置保存中拒绝重复请求，已在后台检查的干净环境不阻止离开',async()=>{
 let done;const waiting=new Promise(resolve=>done=resolve),f=await settingsFixture({call:async()=>waiting});try{
  f.vm.environmentEditor.value={dirty:false,blocked:true};assert.equal(f.guard()(),true);
  f.vm.config.value.theme='midnight';const first=f.vm.save();assert(f.vm.settingsSaving.value);assert.equal(await f.vm.save(),false);assert.equal(f.guard()(),false);assert.equal(f.calls.length,1);done(true);await first;assert(!f.vm.settingsDirty.value);
 }finally{f.cleanup();}
});

test('后台服务检查不阻止放弃未保存路径，专用保存尚在进行时保留页面',async()=>{
 const f=await settingsFixture();try{f.vm.environmentEditor.value={dirty:true,blocked:true,pending:'saveLocalEnvironment'};assert.equal(f.guard()(),false);f.vm.environmentEditor.value.pending='';const waiting=f.guard()();assert(f.vm.leaveDialog.value);f.vm.resolveLeave(true);assert.equal(await waiting,true);}finally{f.cleanup();}
});

async function appFixture(){
 const helpers=await import('../src/local-environment-ui.mjs'),calls=[],windows=[],hooks={},data={license:{active:true,activated:true},currentId:'draft',drafts:[{id:'draft',sourceText:'原文'}],settings:{view:'new',fontSize:'comfortable'},runs:[],accounts:[],workflowJobs:[],localEnvironment:{status:'ready',services:[]}};
 const context={ref:vue.ref,computed:vue.computed,watch:vue.watch,onMounted:fn=>hooks.mount=fn,onUnmounted:fn=>hooks.unmount=fn,provide(){},I:{},Modal:{},Workflow:{},LegacyWorkflow:{},Resources:{},SettingsView:{},TaskCenter:{},call:async(action,payload)=>{calls.push({action,payload});return structuredClone(data);},pickFiles:async()=>[],OperationStatus:{},LocalEnvironment:{},applyTypography(){},workflowView(){},copySourceChanged:()=>false,window:{studio:{window:action=>windows.push(action)}},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},Date,...helpers};
 const f=compile('src/App.vue',context);await hooks.mount();f.vm.page.value='settings';return {...f,calls,windows,cleanup(){hooks.unmount();f.dispose();}};
}

test('返回、菜单、新任务、切换任务与关闭窗口都遵守设置离开取消',async()=>{
 const f=await appFixture();try{
  let checks=0;const unregister=f.vm.registerPageLeaveGuard(()=>{checks++;return false;});
  await f.vm.goBack();await f.vm.navigate('voices');await f.vm.newTask();await f.vm.selectTask('other');await f.vm.closeWindow();assert.equal(checks,5);assert.equal(f.vm.page.value,'settings');assert.equal(f.windows.length,0);assert.deepEqual(f.calls.map(call=>call.action),['state','environmentStatus']);
  unregister();await f.vm.navigate('voices');assert.equal(f.vm.page.value,'voices');await f.vm.closeWindow();assert.deepEqual(f.windows,['close']);
 }finally{f.cleanup();}
});

test('待确认离开期间重复导航不会执行第二个目标',async()=>{
 const f=await appFixture();try{
  let release,checks=0;f.vm.registerPageLeaveGuard(()=>{checks++;return new Promise(resolve=>release=resolve);});const first=f.vm.navigate('voices');assert.equal(checks,1);assert.equal(await f.vm.navigate('assets'),false);assert.equal(checks,1);release(true);assert.equal(await first,true);assert.equal(f.vm.page.value,'voices');
 }finally{f.cleanup();}
});
