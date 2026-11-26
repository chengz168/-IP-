const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const vue=require('vue'),sfc=require('@vue/compiler-sfc');
const {renderToString}=require('@vue/server-renderer');
const logic=import('../server/speech-config.mjs');
const samples=[{id:'audio',type:'audio',name:'参考.wav'},{id:'video',type:'video'}];

test('声音状态按当前引擎区分本地参考与服务ID，不把记录当成推理验收',async()=>{
 const {voiceResourceStatus:status,voiceResourceHint:hint}=await logic;
 const local={ttsProtocol:'indextts-local'},profile={sampleId:'audio',remoteId:'remote-1'};
 assert.equal(status(profile,local,samples).label,'本地参考样本');
 assert.match(status(profile,local,samples).detail,/生成时校验/);
 assert.match(status(profile,local,samples).detail,/尚不代表/);
 assert.equal(status(profile,{ttsProtocol:'compatible'},samples).label,'服务音色 ID');
 assert.match(status(profile,{ttsProtocol:'compatible'},samples).detail,/实际合成验证/);
 assert.equal(status({remoteId:'remote-1'},local,samples).label,'未关联声音样本');
 assert.equal(status({sampleId:'gone'},local,samples).label,'样本记录缺失');
 assert.equal(status({sampleId:'video'},local,samples).label,'需音频样本');
 assert.match(status({sampleId:'audio'},{ttsProtocol:'windows'},samples).detail,/不能使用此参考样本/);
 assert.equal(status(profile,{ttsProtocol:'windows'},samples).label,'声音样本');
 assert.match(status({remoteId:'remote-1'},{ttsProtocol:'windows'},samples).detail,/不会使用此服务 ID/);
 assert.match(hint(local),/无需先取得服务音色 ID/);
 assert.match(hint(local),/训练服务地址未配置/);
 assert.match(hint({...local,cloneUrl:'https://example.invalid'}),/地址已配置，是否可用需实际调用验证/);
 assert.match(hint({ttsProtocol:'windows'}),/不会用于系统配音/);
 assert.doesNotMatch(hint({ttsProtocol:'compatible'}),/尚未接入/);
});

async function render(relative,provider,options={}){
 const filename=path.resolve(__dirname,'..',relative),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const helpers=await logic,slot={setup:(_,context)=>()=>vue.h('section',[context.slots.default?.(),context.slots.footer?.()])};
 const stubs={VoiceDesign:slot,I:slot,AssetPicker:slot,MediaPreview:slot,VoiceSampleEditor:slot,MicrophoneRecorder:slot,Modal:slot,ResourceStudio:slot,MaterialLibrary:slot,AccountLibrary:slot};
 const state=vue.ref({settings:{provider},assets:samples,voices:[{id:'voice',name:'参考声音',sampleId:'audio'},{id:'gone',name:'遗失声音',sampleId:'gone'}],categories:[]});
 const studio={state,draft:vue.ref({id:'isolated-voice'}),busy:vue.ref(''),act:options.act||(()=>assert.fail('展示测试不得启动任务')),notify:options.notify||(()=>{}),refresh:()=>{},importAssets:()=>{},showDialog:()=>{}};
 const dependencies={computed:vue.computed,ref:vue.ref,inject:()=>studio,watch:()=>{},onUnmounted:()=>{},...stubs,call:options.call||(()=>assert.fail('展示测试不得调用IPC')),mediaUrl:id=>'/isolated/'+id,...helpers};
 const source=sfc.compileScript(descriptor,{id:'voice-resource'}).content.replace(/\bimport\s+[^;]+;/g,'').replace('export default','return');
 const component=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
 const compiled=sfc.compileTemplate({id:'voice-resource',filename,source:descriptor.template.content,compilerOptions:{mode:'function'}});
 assert.deepEqual(compiled.errors,[]);
 component.components=stubs;component.render=new Function('Vue',compiled.code)(vue);
 const original=component.setup;
 component.setup=(props,context)=>{const vm=original(props,context);if(options.edit)vm.editing.value={name:'参考声音',sampleId:'audio'};options.capture?.(vm);return {...vm};};
 const app=vue.createSSRApp({render:()=>vue.h(component,{page:'voices'})}),warnings=[];
 app.config.warnHandler=warning=>warnings.push(warning);
 const html=await renderToString(app);assert.deepEqual(warnings,[]);return html;
}

test('声音训练页的下拉选项按本地引擎显示参考样本和缺失记录，保留训练和保存入口',async()=>{
 const html=await render('src/components/ResourceStudio.vue',{ttsProtocol:'indextts-local'});
 assert.match(html,/参考声音（本地参考样本）/);
 assert.match(html,/遗失声音（样本记录缺失）/);
 assert.match(html,/请选择本地参考声音/);
 assert.match(html,/无需先取得服务音色 ID/);
 assert.match(html,/<h3>声音样本<\/h3>/);
 assert.match(html,/无需先训练音色/);
 assert.match(html,/开始训练/);assert.match(html,/仅保存声音样本/);
 assert.doesNotMatch(html,/（仅样本）|仅保存样本不会生成克隆音色/);
});

test('声音库卡片与编辑弹窗使用同一状态说明，不把服务配置写成已接入',async()=>{
 const html=await render('src/views/Resources.vue',{ttsProtocol:'indextts-local',cloneUrl:'https://example.invalid'},{edit:true});
 assert.match(html,/本地参考样本/);assert.match(html,/样本记录缺失/);
 assert.match(html,/无需先取得服务音色 ID/);
 assert.match(html,/地址已配置，是否可用需实际调用验证/);
 assert.doesNotMatch(html,/仅保存样本|实际克隆服务尚未接入/);
});

test('创作声音选项保留预设标识并随引擎和素材记录展示同一状态',async()=>{
 const helpers=await logic,state=vue.ref({settings:{provider:{ttsProtocol:'indextts-local'}},assets:samples,voices:[{id:'preset',name:'预设甲',sampleId:'audio',provenance:{kind:'builtin-voice-preset'}},{id:'gone',name:'缺失乙',sampleId:'gone',provenance:{kind:'builtin-voice-preset'}},{id:'remote',name:'服务丙',remoteId:'voice-1'}]}),draft=vue.ref({id:'isolated-voice',voice:{speed:1}});
 const dependencies={computed:vue.computed,ref:vue.ref,inject:()=>({state,draft,busy:vue.ref(''),workflowLocked:vue.ref(false),act:()=>assert.fail('展示测试不得启动任务'),notify:()=>{}}),watch:()=>{},onMounted:()=>{},onBeforeUnmount:()=>{},call:()=>assert.fail('展示测试不得调用IPC'),mediaUrl:id=>'/isolated/'+id,...helpers};
 const source=fs.readFileSync(path.resolve(__dirname,'../src/use-voice-controls.mjs'),'utf8').replace(/\bimport\s+[^;]+;/g,'').replace('export function useVoiceControls','return function useVoiceControls');
 const controls=new Function(...Object.keys(dependencies),source)(...Object.values(dependencies))({emit:()=>{},previewAudio:vue.ref(null)});
 const labels=()=>controls.options.value.map(option=>option.label);
 assert.deepEqual(labels(),['请选择本地参考声音','预设甲（预设）（本地参考样本）','缺失乙（预设）（样本记录缺失）','服务丙（未关联声音样本）']);
 assert.deepEqual(controls.options.value.map(option=>option.value),['','sample:preset','sample:gone','sample:remote']);
 state.value.settings.provider.ttsProtocol='compatible';
 assert.deepEqual(labels(),['使用设置中的服务音色','预设甲（预设）（声音样本）','缺失乙（预设）（样本记录缺失）','服务丙（服务音色 ID）']);
 state.value.assets=[];
 assert.equal(labels()[1],'预设甲（预设）（样本记录缺失）');
 state.value.settings.provider.ttsProtocol='windows';controls.voices.value=[{name:'本机音色',culture:'zh-CN'}];
 assert.deepEqual(controls.options.value.slice(0,2),[{value:'',label:'使用设置中的系统音色'},{value:'system:本机音色',label:'本机音色 · zh-CN'}]);
});

test('保存样本只按当前引擎改变通知，保留原导入和训练调用',async()=>{
 for(const protocol of ['indextts-local','compatible']){
  let vm;const requests=[],messages=[];
  const html=await render('src/components/ResourceStudio.vue',{ttsProtocol:protocol,cloneUrl:'https://example.invalid'},{capture:value=>{vm=value;},act:async(_,work)=>work(),notify:(...args)=>messages.push(args),call:async(method,payload)=>{requests.push({method,payload});return {id:'saved-voice'};}});
  if(protocol==='compatible'){assert.match(html,/<h3>声音训练<\/h3>/);assert.match(html,/通过已配置的声音训练服务训练音色/);}
  const prepare=()=>{vm.name.value='参考';vm.assetId.value='audio';vm.sampleReady.value=true;vm.sampleEditor.value={materialize:async()=>({id:'trimmed-audio'})};};
  prepare();await vm.saveSample();
  assert.deepEqual(requests[0],{method:'importVoiceSample',payload:{id:'isolated-voice',name:'参考',sampleId:'trimmed-audio'}});
  assert.deepEqual(messages[0],[protocol==='indextts-local'?'声音片段已保存，可作为本地配音参考；效果以合成试听为准':'所选声音片段已保存，尚未训练克隆音色','success']);
  prepare();await vm.train();
  assert.equal(requests[1].method,'trainVoice');assert.equal(vm.profile.value,'saved-voice');
  assert.deepEqual(messages[1],['服务返回音色ID，已保存到声音库','success']);
 }
});
