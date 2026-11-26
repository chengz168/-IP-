const {test}=require('node:test'),assert=require('node:assert/strict');

test('显式资产参考只改变视频系统规则，不改路由和用户要求，默认首帧输出保持相同',async()=>{
 const {resolveCreativePreset,creativePresetPrompt,creativeCatalog}=await import('../server/creative-presets.mjs');
 for(const item of creativeCatalog()){
  const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:item.id}},'video'),before=structuredClone(route),original=creativePresetPrompt(route);
  assert.match(original,/参考图是实际首帧/);assert.equal(creativePresetPrompt(route,{referenceMode:'first-frame'}),original);assert.equal(creativePresetPrompt(route,{}),original);
  const assets=creativePresetPrompt(route,{referenceMode:'assets'});assert.match(assets,/不固定首帧或尾帧/);assert.match(assets,/动作起点、方向与终态由当前已保存镜头设计定义/);assert.doesNotMatch(assets,/参考图是实际首帧|从实际首帧出发/);assert.deepEqual(route,before);
 }
 const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'product',instruction:'请先保留我的首帧描述原文用于讨论。'}},'video');assert.match(creativePresetPrompt(route,{referenceMode:'assets'}),/请先保留我的首帧描述原文用于讨论/);
});

test('资产模式不改变非视频阶段、关闭模式和未支持的参考模式',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 for(const stage of ['script','shots','assets','image']){const route=resolveCreativePreset({},stage);assert.equal(creativePresetPrompt(route,{referenceMode:'assets'}),creativePresetPrompt(route));}
 const route=resolveCreativePreset({},'video');assert.equal(creativePresetPrompt(route,{referenceMode:'unknown'}),creativePresetPrompt(route));assert.equal(creativePresetPrompt(resolveCreativePreset({creativePreset:{mode:'off'}},'video'),{referenceMode:'assets'}),'');
});

test('商品镜头实际翻译调用及审计system均按显式资产参考编译',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs'),{compileProductMotion}=require('../server/product-prompt.cjs');
 const creativePreset=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'product'}},'video'),calls=[],providers={text:async(system,user)=>{calls.push({system,user});return {text:JSON.stringify({prompt:'Show the approved stove and one continuous wiping motion.'})};}},ctx={progress(){}};
 const input={creativePreset,productIntroduction:{version:1},approvedProductDesign:{visual:'扒炉',action:'擦拭台面',camera:'固定近景',sound:'低环境声'},referenceMode:'assets'};
 const output=await compileProductMotion(providers,input,ctx);assert.match(calls[0].system,/不固定首帧或尾帧/);assert.doesNotMatch(calls[0].system,/参考图是实际首帧|从实际首帧出发/);assert.equal(output.promptCompilation.system,calls[0].system);assert.equal(output.referenceMode,'assets');
 await compileProductMotion(providers,{...input,referenceMode:undefined},ctx);assert.match(calls[1].system,/参考图是实际首帧/);
});
