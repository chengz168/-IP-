const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue');
let fixtureId=0;
async function fixture(t,options={}){
 const helpers={...await import('../src/story-ui.mjs'),...await import('../server/shot-localization-view.mjs')};
 const story={version:1,revision:2,sourceMode:'upstream',sourceText:'这是已经确认的非口播创作文案。',episodeCount:options.episodeCount||1,episodeDuration:60,narrationMode:options.narrationMode||'upstream',aspect:'9:16',style:'自然写实',instructions:'',assets:[],episodes:options.withEpisode?[{id:'episode',title:'当前集',text:'这是已经确认的非口播创作文案。',narrationAssetId:options.independentNarration?'independent-audio':'',resultId:'selected-result',shots:[{id:'shot',text:'已确认镜头',duration:60,assetIds:[],images:[{id:'selected-image',status:'ready'}],videos:[{id:'selected-video',status:'ready'}],selectedImageId:'selected-image',selectedVideoId:'selected-video'}]}]:[]};
 if(options.multipleEpisodes)story.episodes=[...story.episodes,{id:'episode-2',text:'第二集',shots:[]}];
 story.episodesSourceHash=await helpers.storyEpisodeFingerprint(story);
 const id='upstream-duration-'+ ++fixtureId,draft=vue.ref({id,confirmed:true,finalText:story.sourceText,voice:{audioId:options.noAudio?'':'voice-audio'},story});
 const duration=Object.hasOwn(options,'duration')?options.duration:5.30576;
 const state=vue.ref({drafts:[draft.value],runs:[],assets:options.missingAsset?[]:[{id:'voice-audio',name:'第三步C音色配音',type:options.wrongType?'video':'audio',duration}],settings:{provider:{}}});
 const busy=vue.ref(''),workflowLocked=vue.ref(false),calls=[],notices=[];
 const studio={draft,state,busy,workflowLocked,act:async(_,work)=>work(),refresh:async()=>{},notify:(...args)=>notices.push(args),navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const {descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
 const source=sfc.compileScript(descriptor,{id:'story-upstream-duration-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','AssetPicker','Modal','StoryModelSettings','CreativePresets','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)];
 const values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},{},async(action,payload)=>{calls.push({action,payload});throw Error('本次时长设置不应调用媒体或服务接口');},id=>id,()=>1,()=>{},...Object.values(helpers)];
 const scope=vue.effectScope(),component=new Function('StoryImageEdit',...names,source)({},...values),vm=scope.run(()=>component.setup({productMode:!!options.productMode},{expose(){}}));
 t.after(()=>{scope.stop();helpers.storyUiDrafts.delete(id);});await vue.nextTick();
 async function settleFingerprint(){const expected=await helpers.storyEpisodeFingerprint(vm.story.value);for(let turn=0;turn<20&&vm.inputFingerprint.value!==expected;turn++)await new Promise(setImmediate);assert.equal(vm.inputFingerprint.value,expected);}
 await settleFingerprint();return{vm,draft,state,busy,workflowLocked,calls,notices,descriptor,settleFingerprint};
}

test('真实StoryStudio模板可编译，音频计划面板和两位小数输入接入现有创作来源',async t=>{
 const f=await fixture(t);assert.deepEqual(sfc.compileTemplate({id:'story-upstream-duration-ui',filename,source:f.descriptor.template.content}).errors,[]);
 assert.match(f.descriptor.template.content,/aria-label="配音与计划时长"/);assert.match(f.descriptor.template.content,/按第三步配音设置时长/);assert.match(f.descriptor.template.content,/v-model.number="story.episodeDuration" type="number" min="1" max="600" step="0.01"/);assert.match(f.descriptor.template.content,/允许的误差为0.15秒/);
 assert.match(f.descriptor.template.content,/class="story-eyebrow">\{\{props.productMode\?'产品介绍':'非口播创作'\}\}/);assert.doesNotMatch(f.descriptor.template.content,/PRODUCT INTRODUCTION|STORY STUDIO/);
});

test('真实合成面板原声控制兼容旧稿，自动20%及手动静音不改镜头设计',async t=>{
 const f=await fixture(t,{withEpisode:true});assert.equal(f.vm.originalAudioMode.value,'custom');assert.equal(f.vm.originalAudioPercent.value,100);assert.equal(f.vm.story.value.originalAudioVolume,undefined);
 const shots=JSON.parse(JSON.stringify(f.vm.story.value.episodes[0].shots));f.vm.originalAudioMode.value='auto';assert.equal(f.vm.story.value.originalAudioVolume,null);assert.equal(f.vm.originalAudioPercent.value,20);f.vm.story.value.narrationMode='none';assert.equal(f.vm.originalAudioPercent.value,100);f.vm.originalAudioPercent.value=0;assert.equal(f.vm.story.value.originalAudioVolume,0);assert.equal(f.vm.originalAudioMode.value,'custom');assert.deepEqual(f.vm.story.value.episodes[0].shots,shots);
 f.busy.value='正在处理';f.vm.originalAudioPercent.value=80;assert.equal(f.vm.story.value.originalAudioVolume,0);assert.match(f.descriptor.template.content,/aria-label="镜头原声音量"/);assert.match(f.descriptor.template.content,/降低音量不能单独分离它们/);
});

test('真实5.30576秒第三步配音明确设置为5.31秒，只改拆集计划，不改变媒体或声音',async t=>{
 const f=await fixture(t);assert.equal(f.vm.upstreamTimingVisible.value,true);assert.equal(f.vm.upstreamNarrationDuration.value,5.30576);assert.equal(f.vm.plannedDurationLabel.value,'60.00 秒');assert.equal(f.vm.canUseUpstreamDuration.value,true);
 const original=JSON.parse(JSON.stringify(f.draft.value));f.vm.useUpstreamDuration();assert.equal(f.vm.story.value.episodeDuration,5.31);assert.equal(f.draft.value.voice.audioId,original.voice.audioId);assert.deepEqual(f.draft.value,original);assert.equal(f.calls.length,0);assert.match(f.notices[0][0],/5.31 秒/);assert.match(f.notices[0][0],/拆集、拆分镜头/);assert.equal(f.vm.canUseUpstreamDuration.value,false);
});

test('已有拆集镜头时沿用指纹失效要求重拆，按钮不替换媒体及旁白并提前说明保存失效',async t=>{
 const f=await fixture(t,{withEpisode:true,independentNarration:true});assert.equal(f.vm.sourceChanged.value,false);assert.equal(f.vm.hasIndependentNarration.value,true);
 const previous=JSON.parse(JSON.stringify(f.vm.story.value.episodes));f.vm.useUpstreamDuration();await vue.nextTick();await f.settleFingerprint();
 assert.equal(f.vm.story.value.episodeDuration,5.31);assert.equal(f.vm.sourceChanged.value,true);assert.deepEqual(f.vm.story.value.episodes,previous);assert.equal(f.vm.episode.value.narrationAssetId,'independent-audio');assert.match(f.notices[0][0],/重新拆集.*重新拆分镜头/);assert.match(f.descriptor.template.content,/本按钮不会更换它/);assert.match(f.descriptor.template.content,/保存后旧镜头的选用会按版本规则失效/);assert.equal(f.calls.length,0);
});

test('多集、已有多集、商品和无旁白模式都不显示或执行单集配音对齐',async t=>{
 for(const options of [{episodeCount:2},{withEpisode:true,multipleEpisodes:true},{productMode:true},{narrationMode:'none'}]){
  const f=await fixture(t,options);assert.equal(f.vm.upstreamTimingVisible.value,false);f.vm.useUpstreamDuration();assert.equal(f.vm.story.value.episodeDuration,60);assert.equal(f.notices.length,0);assert.equal(f.calls.length,0);
 }
});

test('小于4秒或超过600秒给出原因，原音频4秒及4.004秒都允许按4.00秒规划',async t=>{
 for(const [duration,reason] of [[0.5,/不足4秒/],[3.9999,/不足4秒/],[600.0001,/超过每集600秒/],[601,/超过每集600秒/]]){
  const f=await fixture(t,{duration});assert.equal(f.vm.upstreamNarrationDuration.value,duration);assert.match(f.vm.upstreamTimingProblem.value,reason);assert.equal(f.vm.canUseUpstreamDuration.value,false);f.vm.useUpstreamDuration();assert.equal(f.vm.story.value.episodeDuration,60);assert.equal(f.calls.length,0);
 }
 for(const [duration,planned] of [[4,4],[4.004,4],[600,600]]){const edge=await fixture(t,{duration});assert.equal(edge.vm.canUseUpstreamDuration.value,true);edge.vm.useUpstreamDuration();assert.equal(edge.vm.story.value.episodeDuration,planned);}
});

test('缺失、错误类型或非可信有限时长提示重新生成或导入，不使用猜测时长',async t=>{
 for(const options of [{noAudio:true},{missingAsset:true},{wrongType:true},...[-1,0,NaN,Infinity,null,undefined,'5.3'].map(duration=>({duration}))]){
  const f=await fixture(t,options);assert.equal(f.vm.upstreamNarrationDuration.value,null);assert(f.vm.upstreamTimingProblem.value);assert.equal(f.vm.canUseUpstreamDuration.value,false);f.vm.useUpstreamDuration();assert.equal(f.vm.story.value.episodeDuration,60);assert.equal(f.calls.length,0);
 }
});

test('忙碌、自动流程和现有故事运行均锁住按钮及处理函数',async t=>{
 for(const lock of ['busy','workflow','pending','saving','run']){
  const f=await fixture(t);if(lock==='busy')f.busy.value='正在生成';if(lock==='workflow')f.workflowLocked.value=true;if(lock==='pending')f.vm.pending.value=true;if(lock==='saving')f.vm.saving.value=true;if(lock==='run')f.state.value.runs.push({id:'running',draftId:f.draft.value.id,type:'story-video',status:'running'});
  assert.equal(f.vm.canUseUpstreamDuration.value,false);f.vm.useUpstreamDuration();assert.equal(f.vm.story.value.episodeDuration,60);assert.equal(f.notices.length,0);
 }
});

test('单集合成显示真实默认第三步旁白及来源，明确指定优先，多集和无声不回退',async t=>{
 const f=await fixture(t,{withEpisode:true});assert.equal(f.vm.effectiveNarrationId.value,'voice-audio');assert.equal(f.vm.selectedNarration.value.name,'第三步C音色配音');assert.equal(f.vm.selectedNarrationSource.value,'第三步配音（单集默认）');
 assert.equal(f.vm.episode.value.narrationAssetId,'');f.vm.episode.value.narrationAssetId='voice-audio';assert.equal(f.vm.selectedNarrationSource.value,'第三步配音（已指定）');
 f.state.value.assets.push({id:'independent',type:'audio',name:'本集独立音频',duration:5.3});f.vm.episode.value.narrationAssetId='independent';assert.equal(f.vm.selectedNarration.value.name,'本集独立音频');assert.equal(f.vm.selectedNarrationSource.value,'本集指定音频');
 f.vm.episode.value.narrationAssetId='missing';assert.equal(f.vm.selectedNarration.value,undefined);assert.equal(f.vm.effectiveNarrationId.value,'missing');assert.equal(f.vm.selectedNarrationSource.value,'');
 const multiple=await fixture(t,{withEpisode:true,multipleEpisodes:true});assert.equal(multiple.vm.effectiveNarrationId.value,'');assert.equal(multiple.vm.selectedNarration.value,undefined);
 const none=await fixture(t,{withEpisode:true,narrationMode:'none',independentNarration:true});assert.equal(none.vm.effectiveNarrationId.value,'');assert.equal(none.vm.selectedNarration.value,undefined);
 const invalid=await fixture(t,{withEpisode:true,wrongType:true});assert.equal(invalid.vm.selectedNarration.value,undefined);assert.equal(invalid.vm.selectedNarrationSource.value,'');
 assert.match(f.descriptor.template.content,/selectedNarrationSource/);assert.match(f.descriptor.template.content,/恢复单集默认配音/);assert.match(f.descriptor.template.content,/需要无旁白时，请在创作来源选择/);
});
