const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc');
const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue');let fixtureId=0;
async function fixture(t,options={}){
 const helpers={...await import('../src/story-ui.mjs'),...await import('../server/shot-localization-view.mjs')},asset=(id,imageId=id+'-image')=>({id,name:id,kind:'prop',images:[{id:imageId,status:'ready'}],selectedImageId:imageId});
 const story={version:1,revision:2,sourceMode:'custom',sourceText:'拿起扒炉，展示板面。',episodeCount:1,episodeDuration:10,narrationMode:'upstream',assets:[asset('stove'),asset('room')],episodes:[{id:'episode',title:'当前集',text:'拿起扒炉，展示板面。',narrationAssetId:'',shots:[{id:'shot',text:'拿起扒炉，展示板面。',duration:10,assetIds:['stove','room'],images:[],selectedImageId:'',videos:[],selectedVideoId:'',...(options.mode?{referenceMode:options.mode}:{})}]}]};
 story.episodesSourceHash=await helpers.storyEpisodeFingerprint(story);const id='reference-ui-'+ ++fixtureId,draft=vue.ref({id,voice:{audioId:'voice-audio'},story}),state=vue.ref({drafts:[draft.value],runs:[],assets:[{id:'voice-audio',type:'audio',name:'本集旁白',duration:10},...story.assets.map(a=>({id:a.selectedImageId,type:'image'}))],settings:{provider:{storyVideoProtocol:'comfy-h3'}}}),calls=[];
 const studio={draft,state,busy:vue.ref(''),workflowLocked:vue.ref(false),act:async(_,work)=>work(),refresh:async()=>{},notify:()=>{},navigate:()=>{},registerDraftFlusher:()=>()=>{}};
 const {descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}),source=sfc.compileScript(descriptor,{id:'reference-ui'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return');
 const call=async(action,payload)=>{calls.push({action,payload});if(options.fail&&action==='alignStoryNarration')throw Error('切点落在识别段内部，请明确允许估计后重试');const saved=JSON.parse(JSON.stringify(payload.story||draft.value.story));if(action==='alignStoryNarration'){saved.episodes[0].narrationTiming={method:payload.allowEstimated?'asr-boundaries-with-explicit-interpolation':'asr-exact-text-boundaries',requiresReview:true,estimatedBoundaries:payload.allowEstimated?1:0};}return{story:saved,timing:saved.episodes[0].narrationTiming,recognition:{segments:[]}};};
 const names=['computed','inject','ref','watch','nextTick','onBeforeUnmount','I','AssetPicker','Modal','StoryModelSettings','CreativePresets','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)],values=[vue.computed,()=>studio,vue.ref,vue.watch,vue.nextTick,()=>{},{},{},{},{},{},call,id=>id,()=>1,()=>{},...Object.values(helpers)],scope=vue.effectScope(),component=new Function(...names,source)(...values),vm=scope.run(()=>component.setup({productMode:false},{expose(){}}));
 t.after(()=>{scope.stop();helpers.storyUiDrafts.delete(id);});await vue.nextTick();vm.inputFingerprint.value=await helpers.storyEpisodeFingerprint(vm.story.value);return{vm,state,draft,calls,descriptor,helpers,studio};
}

test('资产参考验证明确限制模式、本地H3、重复绑定和有效图片，旧首帧规则保留',async()=>{
 const {storyShotProblems,storyVideoControlProblems}=await import('../src/story-ui.mjs'),assets=[{id:'stove',name:'扒炉',selectedImageId:'stove-image',images:[{id:'stove-image',status:'ready'}]}],shot={referenceMode:'assets',assetIds:['stove']},media=[{id:'stove-image',type:'image'}];
 assert.deepEqual(storyShotProblems(shot,assets,{video:true,media}),[]);assert.match(storyShotProblems({...shot,referenceMode:undefined},assets,{video:true}).join(),/构图图/);
 assert.match(storyVideoControlProblems({...shot,referenceMode:'invalid'}).join(),/有效/);assert.match(storyVideoControlProblems(shot,'bridge').join(),/仅支持本地H3/);assert.match(storyVideoControlProblems({...shot,lastFrameId:'last'}).join(),/不支持尾帧/);
 assert.match(storyShotProblems({...shot,assetIds:['stove','stove']},assets,{video:true,media}).join(),/不能重复/);
 const repeated=[...assets,{id:'other',name:'另一资产',selectedImageId:'stove-image',images:assets[0].images}];assert.match(storyShotProblems({...shot,assetIds:['stove','other']},repeated,{video:true,media}).join(),/不能重复/);
 assert.match(storyShotProblems(shot,assets,{video:true,media:[]}).join(),/失效/);assert.match(storyShotProblems({...shot,assetIds:Array.from({length:10},(_,i)=>'asset-'+i)},[],{video:true}).join(),/1至9张/);
});

test('资产模式第三阶段按已确认绑定图计算，视频仍须人工确认，云端不计参考就绪',async t=>{
 const f=await fixture(t,{mode:'assets'}),before=JSON.stringify(f.vm.story.value);assert.equal(f.vm.videoIssues.value.length,0);assert.equal(f.vm.progress.value.stages[2].label,'画面参考');assert.equal(f.vm.progress.value.stages[2].done,true);assert.equal(f.vm.progress.value.counts.framesReady,1);assert.equal(f.vm.progress.value.next.stage,'videos');assert.equal(f.vm.progress.value.counts.videosReady,0);assert.equal(JSON.stringify(f.vm.story.value),before);
 f.state.value.settings.provider.storyVideoProtocol='bridge';assert.equal(f.vm.progress.value.stages[2].done,false);assert.match(f.vm.videoIssues.value.join(),/本地H3/);assert.equal(f.vm.shot.value.referenceMode,'assets');
 f.state.value.settings.provider.storyVideoProtocol='comfy-h3';f.vm.chooseLastFrame();assert.equal(f.vm.picker.value,null);f.vm.shot.value.lastFrameId='last';assert.match(f.vm.videoIssues.value.join(),/尾帧/);
});

test('真实组件默认首帧不迁移，资产预览保留绑定编辑并隔离首帧生成',async t=>{
 const f=await fixture(t);assert.equal(f.vm.videoReferenceMode.value,'first-frame');assert.equal(f.vm.shot.value.referenceMode,undefined);assert.match(f.vm.videoIssues.value.join(),/构图图/);f.vm.videoReferenceMode.value='assets';assert.equal(f.vm.shot.value.referenceMode,'assets');assert.deepEqual(f.vm.videoIssues.value,[]);
 const template=f.descriptor.template.content;assert.deepEqual(sfc.compileTemplate({id:'reference-ui',filename,source:template}).errors,[]);assert.match(template,/aria-label="镜头视频参考方式"/);assert.match(template,/<template v-if="!assetReferenceMode"><p v-if="textOnlyImage/);assert.match(template,/aria-label="已绑定资产参考图"/);assert.match(template,/v-if="!props.productMode\|\|assetReferenceMode" class="story-bindings"/);assert.match(template,/:disabled="locked\|\|!localVideo\|\|assetReferenceMode" @click="chooseLastFrame"/);assert.match(template,/generateStoryVideo',\{\.\.\.shotPayload\(\),instruction:correction\}/);
});

test('旁白严格按钮默认不传估算许可，独立估算按钮才显式传true并展示复核状态',async t=>{
 const f=await fixture(t);assert(f.vm.canAlignNarration.value);await f.vm.alignNarration();let requests=f.calls.filter(c=>c.action==='alignStoryNarration');assert.equal(requests.length,1);assert.deepEqual(requests[0].payload,{id:f.draft.value.id,episodeId:'episode'});assert.equal(f.vm.narrationTimingLabel.value,'识别文字边界对齐');assert.match(f.vm.narrationTimingStatus.value,/不能据此认定全部准确/);
 await f.vm.alignNarration(true);requests=f.calls.filter(c=>c.action==='alignStoryNarration');assert.equal(requests.length,2);assert.equal(requests[1].payload.allowEstimated,true);assert.equal(f.vm.narrationTimingLabel.value,'识别边界与显式估算切点');assert.match(f.vm.narrationTimingStatus.value,/估算切点/);assert.match(f.descriptor.template.content,/按识别段估算切点（需复核）/);assert.match(f.descriptor.template.content,/episode.narrationTiming.requiresReview/);assert.equal(f.vm.shot.value.selectedVideoId,'');
});

test('严格对齐错误在旁白区域保留且不自动降级，缺音频与忙碌拒绝调用',async t=>{
 const f=await fixture(t,{fail:true});await f.vm.alignNarration();assert.equal(f.calls.filter(c=>c.action==='alignStoryNarration').length,1);assert.match(f.vm.narrationTimingError.value,/明确允许估计/);assert.equal(f.vm.story.value.episodes[0].narrationTiming,undefined);
 f.state.value.assets=f.state.value.assets.filter(a=>a.type!=='audio');assert.equal(f.vm.canAlignNarration.value,false);await f.vm.alignNarration(true);assert.equal(f.calls.filter(c=>c.action==='alignStoryNarration').length,1);f.studio.busy.value='执行中';assert.equal(f.vm.canAlignNarration.value,false);
});

test('可信稿映射与词内估算均显式选择，旧严格按钮不携带映射许可',async t=>{
 const f=await fixture(t);assert.equal(f.vm.referenceMappingEstimated.value,false);
 await f.vm.alignNarration(false,true);let request=f.calls.filter(c=>c.action==='alignStoryNarration').at(-1);assert.equal(request.payload.allowReferenceMapping,true);assert.equal(request.payload.allowEstimated,undefined);
 await f.vm.alignNarration(true,true);request=f.calls.filter(c=>c.action==='alignStoryNarration').at(-1);assert.equal(request.payload.allowReferenceMapping,true);assert.equal(request.payload.allowEstimated,true);
 await f.vm.alignNarration();request=f.calls.filter(c=>c.action==='alignStoryNarration').at(-1);assert.equal(request.payload.allowReferenceMapping,undefined);assert.equal(request.payload.allowEstimated,undefined);
 assert.match(f.descriptor.template.content,/按确认稿映射识别切点（需回听）/);assert.match(f.descriptor.template.content,/原始识别、音频及正文不改/);assert.match(f.descriptor.template.content,/referenceMapping.differences/);
});

test('旁白对齐失效标签与合成阻塞一致，无旁白及旧无凭据不误禁用',async t=>{
 const f=await fixture(t,{mode:'assets'}),reason='对齐已失效，请重新按旁白对齐';
 // 隔离候选已确认且媒体存在，让断言只检查新增的旁白阻塞条件。
 f.vm.episode.value.shots[0].videos=[{id:'confirmed-video',status:'ready'}];f.vm.episode.value.shots[0].selectedVideoId='confirmed-video';f.state.value.assets.push({id:'confirmed-video',type:'video'});
 assert.equal(f.vm.composeReason.value,'');assert.equal(f.vm.narrationTimingLabel.value,'未对齐');
 f.vm.episode.value.narrationTiming={method:'asr-exact-text-boundaries',invalidated:true};
 assert.equal(f.vm.composeReason.value,reason);assert.equal(f.vm.narrationTimingLabel.value,reason);
 assert.match(f.descriptor.template.content,/:disabled="locked\|\|!!composeReason\|\|sourceChanged" :title="composeReason" @click="run\('composeStoryEpisode'/);
 f.vm.story.value.narrationMode='none';assert.equal(f.vm.composeReason.value,'');
 f.vm.story.value.narrationMode='upstream';assert.equal(f.vm.composeReason.value,reason);
 f.vm.episode.value.narrationTiming={method:'asr-exact-text-boundaries'};assert.equal(f.vm.composeReason.value,'');assert.equal(f.vm.narrationTimingLabel.value,'识别文字边界对齐');
 delete f.vm.episode.value.narrationTiming;assert.equal(f.vm.composeReason.value,'');
 f.vm.episode.value.shots[0].selectedVideoId='';assert.match(f.vm.composeReason.value,/有效版本/);
 f.vm.episode.value.shots=[];assert.equal(f.vm.composeReason.value,'请先拆分镜头');
 assert.equal(f.calls.length,0);
});

test('过期对齐成功通知在失效及输入变化时清除，错误与映射审计保留',async t=>{
 const changes=[
  ['凭据失效',f=>{f.vm.episode.value.narrationTiming.invalidated=true;}],
  ['镜头时长',f=>{f.vm.shot.value.duration=10.1;}],
  ['镜头台词',f=>{f.vm.shot.value.text+='展示边沿。';}],
  ['镜头顺序和身份',f=>{f.vm.shot.value.id='new-shot';}],
  ['本集正文',f=>{f.vm.episode.value.text+='展示边沿。';}],
  ['来源正文',f=>{f.vm.story.value.sourceText+='展示边沿。';}],
  ['本集旁白',f=>{f.vm.episode.value.narrationAssetId='another-audio';}],
  ['第三步配音',f=>{f.draft.value.voice.audioId='another-audio';}],
  ['切换无旁白',f=>{f.vm.story.value.narrationMode='none';}]
 ];
 for(const [label,change] of changes){
  const f=await fixture(t);await f.vm.alignNarration();assert.match(f.vm.narrationTimingStatus.value,/已保存/);
  const mapping={differences:[{original:'版',reference:'板',sourceOffset:0}],limitation:'需逐镜回听'};
  f.vm.episode.value.narrationTiming.referenceMapping=mapping;
  f.vm.narrationTimingStatus.value='已保存确认稿映射，请逐镜回听差异与切点。';f.vm.narrationTimingError.value='保留已有错误';
  f.vm.shot.value.visual='只修改构图';assert.match(f.vm.narrationTimingStatus.value,/已保存确认稿映射/,label+'：无关画面编辑不清除');
  change(f);assert.equal(f.vm.narrationTimingStatus.value,'',label);assert.equal(f.vm.narrationTimingError.value,'保留已有错误',label);
  assert.deepEqual(JSON.parse(JSON.stringify(f.vm.episode.value.narrationTiming.referenceMapping)),mapping,label+'：映射审计未改');
  assert.equal(f.calls.filter(c=>c.action==='alignStoryNarration').length,1,label+'：不自动重试');
 }
 const f=await fixture(t);await f.vm.alignNarration();f.vm.episode.value.narrationTiming.invalidated=true;assert.equal(f.vm.narrationTimingStatus.value,'');
 await f.vm.alignNarration();assert.match(f.vm.narrationTimingStatus.value,/已保存识别对齐结果/);assert.equal(f.vm.episode.value.narrationTiming.invalidated,undefined);
 assert.match(f.descriptor.template.content,/v-if="narrationTimingError" class="story-notice error" role="alert"/);
});

test('正常刷新及同输入hydrate保留对齐成功通知，真实输入变化才即时清除',async t=>{
 const f=await fixture(t);await f.vm.alignNarration();const notice=f.vm.narrationTimingStatus.value;
 assert.match(notice,/已保存识别对齐结果/);
 // run 已先 hydrate 后设置成功通知；相同输入的后续回填不能误清该通知。
 const aligned=JSON.parse(JSON.stringify(f.vm.story.value));
 f.vm.hydrate(aligned);assert.equal(f.vm.narrationTimingStatus.value,notice);
 for(let revision=3;revision<=5;revision++){
  const refreshed=JSON.parse(JSON.stringify(f.state.value));
  refreshed.drafts[0].story={...JSON.parse(JSON.stringify(aligned)),revision};
  f.state.value=refreshed;f.draft.value=JSON.parse(JSON.stringify(refreshed.drafts[0]));
  await vue.nextTick();
  assert.equal(f.vm.story.value.revision,revision,'实际经过 remote revision watcher 的 hydrate');
  assert.equal(f.vm.narrationTimingStatus.value,notice,'正常状态和草稿刷新保留成功通知');
 }
 f.vm.shot.value.duration=10.1;assert.equal(f.vm.narrationTimingStatus.value,'','同一次成功之后编辑时长立即清除');
 const stale=JSON.parse(JSON.stringify(f.vm.story.value));stale.episodes[0].narrationTiming.invalidated=true;
 f.vm.hydrate(stale);await vue.nextTick();assert.equal(f.vm.narrationTimingStatus.value,'','失效回填不恢复旧成功通知');
 assert.equal(f.calls.filter(c=>c.action==='alignStoryNarration').length,1);
});
