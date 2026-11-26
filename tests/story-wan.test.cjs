const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WAN_DEFAULTS,wanCanvas,wanFrameLength,wanGraph,inspectWanModels,validateWanInput}=require('../server/story-wan.cjs');
const input={prompt:'固定机位，商品保持原位，仅少量透明蒸汽缓慢向上散开。',duration:10.458,aspect:'9:16',image:{assetId:'confirmed-first-frame'},seed:23};
function objectInfo(){
 const graph=wanGraph({input,image:'uploaded/first.png'}),info=Object.fromEntries(Object.values(graph).map(row=>[row.class_type,{input:{required:{}}}]));
 const set=(name,field,values)=>{info[name].input.required[field]=[values];};
 set('UNETLoader','unet_name',[WAN_DEFAULTS.storyWanModel]);set('UNETLoader','weight_dtype',['default']);
 set('CLIPLoader','clip_name',[WAN_DEFAULTS.storyWanClip]);set('CLIPLoader','type',['wan']);set('CLIPLoader','device',['default']);
 set('VAELoader','vae_name',[WAN_DEFAULTS.storyWanVae]);set('KSampler','sampler_name',['uni_pc']);set('KSampler','scheduler',['simple']);set('SaveVideo','format',['auto']);set('SaveVideo','format.codec',['auto']);
 info.Wan22ImageToVideoLatent.input.optional={start_image:['IMAGE']};return info;
}
test('原生尺寸对齐32并明确补边到精确横竖画幅，未接入画幅不能悄悄替换',()=>{
 for(const [aspect,ratio]of [['9:16',9/16],['16:9',16/9]]){
  const size=wanCanvas(aspect);assert.equal(size.width%32,0);assert.equal(size.height%32,0);assert.equal(size.outputWidth/size.outputHeight,ratio);assert(size.outputWidth>=size.width&&size.outputHeight>=size.height);
 }
 assert.deepEqual(wanCanvas('16:9'),{width:1280,height:704,outputWidth:1280,outputHeight:720});
 for(const aspect of ['1:1','4:3','3:4','other'])assert.throws(()=>wanCanvas(aspect),/仅支持9:16或16:9/);
});
test('完整镜头按4k+1生成且覆盖计划时长，121帧不作为硬上限',()=>{
 for(const [duration,length]of [[4,97],[5,121],[10.458,253],[15,361]]){
  assert.equal(wanFrameLength({...input,duration}),length);assert.equal((length-1)%4,0);assert(length/24>=duration);assert(length/24-duration<5/24);
 }
 for(const duration of [0,3.99,15.01,NaN,Infinity,'5'])assert.throws(()=>wanFrameLength({...input,duration}),/4至15秒/);
 assert.equal(wanFrameLength({...input,duration:.25,productIntroduction:{version:1}}),97);
 for(const duration of [0,-1,15.01])assert.throws(()=>wanFrameLength({...input,duration,productIntroduction:{version:1}}),/大于0且不超过15秒/);
});
test('官方单首帧图贯通输入到SaveVideo，固定采样配方不混入H3或音频节点',()=>{
 const graph=wanGraph({input,image:'uploaded/first.png',seed:23,prefix:'isolated/wan',prompt:'The griddle remains fixed while a little transparent vapor rises.'});
 assert.equal(graph['1'].inputs.unet_name,WAN_DEFAULTS.storyWanModel);assert.equal(graph['2'].inputs.type,'wan');assert.equal(graph['3'].inputs.vae_name,WAN_DEFAULTS.storyWanVae);
 assert.equal(graph['7'].inputs.length,253);assert.equal(graph['7'].inputs.batch_size,1);assert.deepEqual(graph['7'].inputs.start_image,['6',0]);
 assert.deepEqual(graph['9'].inputs,{seed:23,steps:20,cfg:5,sampler_name:'uni_pc',scheduler:'simple',denoise:1,model:['8',0],positive:['4',0],negative:['5',0],latent_image:['7',0]});
 assert.equal(graph['8'].inputs.shift,8);assert.equal(graph['15'].inputs.fps,24);assert(!Object.hasOwn(graph['15'].inputs,'audio'));assert.deepEqual(graph['16'].inputs.video,['15',0]);
 assert.doesNotMatch(JSON.stringify(graph),/MiniMax|LoraLoader|VAEDecodeAudio|17k|Picture 2/);assert.doesNotMatch(graph['5'].inputs.text,/\bstatic\b|\bstill\b|静态|静止/i);
 for(const row of Object.values(graph))for(const value of Object.values(row.inputs))if(Array.isArray(value)){assert(graph[value[0]],'每个输入链接必须指向真实节点');assert(Number.isInteger(value[1]));}
 assert.throws(()=>wanGraph({input,image:'first.png',weights:{model:'wan2.1.safetensors',clip:WAN_DEFAULTS.storyWanClip,vae:WAN_DEFAULTS.storyWanVae}}),/官方三权重/);
});
test('不能静默忽略资产参考、尾帧、无首帧和无效种子',()=>{
 for(const patch of [{referenceMode:'assets'},{referenceMode:'unknown'},{references:[{assetId:'ref'}]},{references:{}},{lastFrame:{assetId:'last'}},{lastFrameId:'last'},{image:null},{seed:-1},{seed:2**32},{seed:1.2}])assert.throws(()=>validateWanInput({...input,...patch}));
 assert.equal(validateWanInput(input).supportsAudio,false);assert.equal(validateWanInput({...input,seed:0}).frameLength,253);
 assert.throws(()=>wanGraph({input,image:''}),/缺少已上传/);assert.throws(()=>wanGraph({input,image:'first.png',seed:-1}),/固定种子/);
});
test('无音轨能力门禁检查原文、已确认方案与编译结果，不删除显式对白冒充执行',()=>{
 for(const patch of [{prompt:'厨师说：“已经好了。”'},{instruction:'保留对白：欢迎。'},{approvedStoryDesign:{sound:'第二秒说话，原声对白。'}},{prompt:'The chef says: welcome.'},{sound:'Use a voiceover.'},{prompt:'A singer sings softly.'}])assert.throws(()=>validateWanInput({...input,...patch}),/不支持显式对白/);
 assert.throws(()=>wanGraph({input,image:'first.png',prompt:'The chef speaks clearly.'}),/编译后的指令包含人声/);
 for(const prompt of ['商品保持静止。无对白、无画外音，只要画面。','厨师不说话，产品不动。','No speech or voiceover. The camera remains fixed.','后期配音，当前仅生成商品画面。','后期会添加旁白，当前只生成画面。','Post-production narration. The griddle remains fixed.'])assert.doesNotThrow(()=>validateWanInput({...input,prompt}));
});
test('画外旁白与后期配音、第三步既有配音及真实自动预设不被误认为现场人声',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 const route=resolveCreativePreset({tab:'story',story:{sourceText:'厨师讲解商品操作，提供口播教程。'},creativePreset:{mode:'auto'}},'video');
 const preset=creativePresetPrompt(route),original='C为画外旁白，人物只允许手部或胸部以下，不能让男讲解员对口型。';
 assert.match(preset,/建议制作链路：[^\n]*配音/);
 const productSound='旁白使用第三步完整配音，镜头只要低环境声，不产生对白或背景音乐。';
 for(const patch of [{storyInstructions:original},{prompt:input.prompt+preset,creativePreset:route},{style:'建议链路：文案→配音→剪辑。'},{approvedProductDesign:{sound:productSound},productIntroduction:{version:1}},{sound:'旁白已单独配音，后期加入。'},{sound:'Narration is already recorded and will be added separately.'}])assert.doesNotThrow(()=>validateWanInput({...input,...patch}));
 assert.doesNotThrow(()=>wanGraph({input:{...input,storyInstructions:original},image:'first.png',prompt:input.prompt+preset+'\n'+original}));
 assert.throws(()=>validateWanInput({...input,creativePreset:{...route,instruction:'现场对白：请开始。'}}),/不支持显式对白/);
 assert.throws(()=>validateWanInput({...input,sound:'旁白使用第三步完整配音；现场对白：请开始。'}),/不支持显式对白/);
 assert.equal(validateWanInput({...input,approvedProductDesign:{sound:productSound}}).supportsAudio,false);
});
test('检查报告区分节点缺失、模型缺失、选项不兼容与实际生成验收',()=>{
 const ready=inspectWanModels(objectInfo());assert.equal(ready.ready,true);assert.equal(ready.generationVerified,false);assert.equal(ready.supportsLastFrame,false);assert.equal(ready.supportsSeed,true);assert.equal(ready.supportsAudio,false);
 const absent=objectInfo();delete absent.ModelSamplingSD3;absent.VAELoader.input.required.vae_name=[[]];absent.KSampler.input.required.sampler_name=[['euler']];delete absent.Wan22ImageToVideoLatent.input.optional.start_image;
 const report=inspectWanModels(absent);assert.equal(report.ready,false);assert(report.missingNodes.includes('ModelSamplingSD3'));assert(report.missingModels.includes(WAN_DEFAULTS.storyWanVae));assert(report.invalidOptions.includes('KSampler.sampler_name=uni_pc'));assert(report.invalidOptions.includes('Wan22ImageToVideoLatent.start_image'));
 assert.equal(inspectWanModels(objectInfo(),{storyWanModel:'other.safetensors'}).ready,false);assert.equal(inspectWanModels({}).ready,false);
});
test('真实V3动态容器与嵌套codec分支支持auto，缺少该分支仍明确阻止就绪',()=>{
 const info=objectInfo(),codec=['COMFY_DYNAMICCOMBO_V3',{options:[{key:'auto',inputs:{required:{}}},{key:'h264',inputs:{required:{}}}]}];
 delete info.SaveVideo.input.required['format.codec'];
 info.SaveVideo.input.required.format=['COMFY_DYNAMICCOMBO_V3',{options:[{key:'auto',inputs:{required:{codec}}},{key:'mp4',inputs:{required:{codec}}}]}];
 assert.equal(inspectWanModels(info).ready,true);
 codec[1].options=codec[1].options.filter(option=>option.key!=='auto');
 assert(inspectWanModels(info).invalidOptions.includes('SaveVideo.format.codec=auto'));
 info.SaveVideo.input.required.format[1].options=info.SaveVideo.input.required.format[1].options.filter(option=>option.key!=='auto');
 assert(inspectWanModels(info).invalidOptions.includes('SaveVideo.format=auto'));
});
