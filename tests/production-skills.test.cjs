const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../server/service.cjs');
const {StoryGenerator}=require('../server/story-generator.cjs');
const {Media}=require('../server/media.cjs');
const {createStory}=require('../server/story-contract.cjs');
const {productionSkillCatalog}=require('../server/production-skills.mjs');
const {resolveCreativePreset,creativePresetPrompt}=require('../server/creative-presets.mjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-skills-')),listeners=new Set(process.listeners('exit')),s=createService(root);
 const added=process.listeners('exit').filter(fn=>!listeners.has(fn));
 t.after(()=>{for(const fn of added)process.removeListener('exit',fn);fs.rmSync(root,{recursive:true,force:true});});
 const d=s.store.draft();d.finalText='小明走进花园。他拿起水壶浇花。';d.confirmed=true;d.creativePreset={mode:'manual',presetId:'story',instruction:''};s.store.save();return {s,d,root};
}
async function shotFixture(t){
 const f=fixture(t),{s,d}=f;const story=createStory(d);story.episodeDuration=4;await s.stories.save({id:d.id,story,revision:0});await s.stories.splitEpisodes({id:d.id});
 const e=d.story.episodes[0];s.providers.text=async()=>({text:JSON.stringify({shots:[{endUnit:2,visual:'一人花园浇花',action:'拿起水壶',camera:'中景固定',sound:'环境声',imagePrompt:'一位穿蓝衣的人在花园站立',videoPrompt:'抬起水壶'}]})});await s.stories.splitShots({id:d.id,episodeId:e.id});
 return {...f,target:{episodeId:d.story.episodes[0].id,shotId:d.story.episodes[0].shots[0].id}};
}
test('十二项视频工厂方法与八阶段精确匹配，清单不冒充自动执行',()=>{
 const methods=productionSkillCatalog();assert.equal(methods.length,12);assert.equal(new Set(methods.map(s=>s.id)).size,12);
 const expected={topic:['audience-hook'],script:['audience-hook','script-continuity'],rewrite:['rewrite-clarity'],episodes:['episode-planning'],shots:['shot-staging'],assets:['asset-binding'],image:['reference-continuity'],video:['video-motion']};
 for(const [stage,ids] of Object.entries(expected)){
  const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'product'}},stage);assert.deepEqual(route.skills.map(s=>s.id),ids);
  for(const skill of route.skills){assert.match(creativePresetPrompt(route),new RegExp(skill.name));assert.equal(skill.execution,'prompt');assert.match(skill.origin.revision,/^[a-f0-9]{40}$/);}
  const off=resolveCreativePreset({creativePreset:{mode:'off'}},stage);assert.deepEqual(off.skills,[]);assert.equal(creativePresetPrompt(off),'');
 }
 assert.equal(methods.filter(s=>s.execution==='checklist').length,4);
 assert.throws(()=>resolveCreativePreset({},'voice'),/阶段无效/);
 assert.deepEqual(resolveCreativePreset({},'analysis').skills,[]);
 const copy=productionSkillCatalog();copy[0].rules[0]='错误规则';copy[0].origin.files.length=0;assert.notEqual(productionSkillCatalog()[0].rules[0],'错误规则');assert.equal(productionSkillCatalog()[0].origin.files.length,3);
});
test('拆集和资产提取实际文本请求调用对应方法，没有跨阶段结构',async t=>{
 const {s,d}=await shotFixture(t);const calls=[];s.providers.text=async(system,user)=>{calls.push({system,user});return {text:JSON.stringify({assets:[{key:'new_person',kind:'character',name:'小明',description:'花园中的小明',prompt:'A person in a garden'}],bindings:[{shotId:d.story.episodes[0].shots[0].id,assetKeys:['new_person']}]})};};
 const assets=await s.stories.extractAssets({id:d.id});assert.equal(assets.creativePreset.stage,'assets');assert.deepEqual(assets.creativePreset.skills.map(s=>s.id),['asset-binding']);assert.match(calls[0].system,/资产识别与复用/);assert.match(calls[0].system,/新实体使用本次结果内唯一临时key/);assert.match(calls[0].system,/空复用清单不代表不能提取新实体/);assert.doesNotMatch(calls[0].system,/开头直接进入观众/);assert.notEqual(d.story.assets[0].id,'new_person');
 const story=structuredClone(d.story);story.episodeCount=2;await s.stories.save({id:d.id,story,revision:story.revision});s.providers.text=async(system)=>{calls.push({system});return {text:JSON.stringify({episodes:[{title:'进入花园',endUnit:1},{title:'拿起水壶',endUnit:2}]})};};
 const episodes=await s.stories.splitEpisodes({id:d.id});assert.equal(episodes.creativePreset.stage,'episodes');assert.match(calls.at(-1).system,/拆集与分集规划/);assert.doesNotMatch(calls.at(-1).system,/分镜调度与镜间衔接/);assert.equal(d.story.episodes.map(e=>e.text).join(''),d.finalText);
});
test('资产提取期间改变任务预设，迟到绑定不覆盖当前内容',async t=>{
 const {s,d}=await shotFixture(t);let finish;const before=structuredClone(d.story),pendingReady=new Promise(resolve=>{s.providers.text=async()=>{resolve();return new Promise(done=>finish=done);};});
 const pending=s.stories.extractAssets({id:d.id});await pendingReady;d.creativePreset={mode:'off'};finish({text:JSON.stringify({assets:[],bindings:[{shotId:d.story.episodes[0].shots[0].id,assetKeys:[]}]})});const result=await pending;assert.equal(result.stale,true);assert.deepEqual(d.story,before);
});
test('图片计划与执行保留方法快照，生成中切换预设标过期并禁止选用',async t=>{
 const {s,d,target,root}=await shotFixture(t);let finish,notify;const ready=new Promise(resolve=>notify=resolve);s.stories.generator.image=async input=>{notify(input);return new Promise(done=>finish=done);};
 const pending=s.stories.generateImage({id:d.id,...target});const input=await ready;assert.equal(input.creativePreset.stage,'image');assert.equal(input.creativePreset.skills[0].id,'reference-continuity');d.creativePreset={mode:'off'};
 const file=path.join(root,'result.png');fs.writeFileSync(file,'仅为流程夹具');const material=s.store.addAsset(file,{type:'image'});finish(material);const result=await pending;assert.equal(result.stale,true);assert.equal(result.candidate.creativePreset.skills[0].id,'reference-continuity');await assert.rejects(s.stories.selectImage({id:d.id,...target,imageId:material.id}),/过期/);
});
test('图片真实适配器将规则发送给本地模型图，关闭模式不附加',async t=>{
 const {s,root}=fixture(t);s.store.data.settings.provider.storyImageArchitecture='z-image-turbo';const g=new StoryGenerator(s.store,new Media(s.store),s.providers),graphs=[];
 g.comfy.json=async()=>({UNETLoader:{input:{required:{unet_name:[['z_image_turbo_bf16.safetensors']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen_3_4b.safetensors']],type:[['lumina2']]}}},VAELoader:{input:{required:{vae_name:[['ae.safetensors']]}}},KSampler:{input:{required:{sampler_name:[['res_multistep']],scheduler:[['simple']]}}},...Object.fromEntries(['ModelSamplingAuraFlow','CLIPTextEncode','EmptySD3LatentImage','VAEDecode','SaveImage'].map(k=>[k,{}]))});
 g.executeComfy=async remote=>{graphs.push(remote);return {id:'流程夹具'};};
 for(const mode of ['auto','off'])await g.image({prompt:'一只红色水壶放在木桌上',aspect:'9:16',references:[],creativePreset:resolveCreativePreset({creativePreset:{mode}},'image')});
 assert.match(graphs[0].graph['4'].inputs.text,/角色服装与道具一致/);assert.doesNotMatch(graphs[1].graph['4'].inputs.text,/本阶段制作技能/);assert.equal(graphs[0].input.creativePreset.skills[0].id,'reference-continuity');
});
test('真实观察到的虚构同事经历和后台说明被拒绝，旧选题与完整失败证据保留',async t=>{
 const {s,d}=fixture(t);d.topic.industry='桌面整理操作教程';const clean=()=>({opportunity:'分享分类和清洁的步骤',topics:Array.from({length:5},(_,i)=>({title:'整理桌面'+i,hook:'先按用途归位，再擦桌面。',personaAngle:'按步骤演示整理动作'}))});s.providers.text=async()=>({text:JSON.stringify(clean())});await s.invoke('copyTopics',{id:d.id});const before=structuredClone(s.store.draft(d.id).copyStudio);
 for(const hook of ['很多同事问我怎么让桌面清爽。','资料里有一个简单的清洁建议。','资料给出了两个方向。']){
  const bad=clean();bad.topics[0].hook=hook;s.providers.text=async()=>({text:JSON.stringify(bad)});await assert.rejects(s.invoke('copyTopics',{id:d.id}),/未通过内容检查/);assert.deepEqual(s.store.draft(d.id).copyStudio,before);assert.ok(s.store.data.runs[0].failureOutput.rawText.includes(hook));
 }
 const {assessTopics}=await import('../server/topic-quality.mjs');assert.equal(assessTopics({fields:{source:'很多同事问我怎么整理桌面'}},[{title:'整理建议',hook:'很多同事问我怎么整理桌面。'}]).status,'needs-review');assert.doesNotMatch(creativePresetPrompt(resolveCreativePreset({},'script')),/personaAngle/);
});
