const {test}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto');

test('非口播编辑初始化复用前文且不修改现有任务，旧数据保留候选和扩展字段',async()=>{
  const {storyEditorValue,upstreamStoryText}=await import('../src/story-ui.mjs');
  const d={finalText:'已确认最终文案',rewrite:'改写草稿',sourceText:'原稿'};
  const value=storyEditorValue(d);assert.equal(value.sourceText,d.finalText);assert.equal(value.sourceMode,'upstream');assert.equal(value.narrationMode,'none');assert.equal(d.story,undefined);
  d.story={version:1,revision:7,sourceMode:'custom',sourceText:'独立剧本',episodes:[],assets:[{id:'asset-1',images:[{id:'media-1'}]}],episodesSourceHash:'saved-hash'};
  const restored=storyEditorValue(d);restored.assets[0].images[0].id='changed';assert.equal(d.story.assets[0].images[0].id,'media-1');assert.equal(restored.episodesSourceHash,'saved-hash');assert.equal(restored.revision,7);
  assert.equal(upstreamStoryText({rewrite:'只有改写'}),'只有改写');
});

test('镜头缺失绑定、资产图片或构图图时给出准确前置条件',async()=>{
  const {storyShotProblems}=await import('../src/story-ui.mjs');
  assert.deepEqual(storyShotProblems(null,[]),['请先选择一个镜头']);
  assert.match(storyShotProblems({assetIds:[]},[]).join(''),/尚未绑定/);
  assert.match(storyShotProblems({assetIds:['missing']},[]).join(''),/已移除/);
  const assets=[{id:'character',name:'主角',selectedImageId:''}];
  assert.match(storyShotProblems({assetIds:['character']},assets).join(''),/主角.*尚未确认/);
  assets[0].selectedImageId='portrait';
  assert.deepEqual(storyShotProblems({assetIds:['character']},assets),[]);
  assert.match(storyShotProblems({assetIds:['character']},assets,{video:true}).join(''),/构图图/);
  assert.deepEqual(storyShotProblems({assetIds:['character'],selectedImageId:'frame'},assets,{video:true}),[]);
});

test('分集输入指纹与服务端一致，集数或时长变化使旧分集失效',async()=>{
  const {storyEpisodeFingerprint}=await import('../src/story-ui.mjs');
  const story={sourceText:'上游完整剧本',episodeCount:2,episodeDuration:30};
  const expected=crypto.createHash('sha256').update(JSON.stringify([story.sourceText,2,30])).digest('hex');
  assert.equal(await storyEpisodeFingerprint(story),expected);
  assert.notEqual(await storyEpisodeFingerprint({...story,episodeCount:3}),expected);
  assert.notEqual(await storyEpisodeFingerprint({...story,episodeDuration:15}),expected);
});

test('本地多资产构图要求有效主参考，单资产自动选用，云端多图不受限制',async()=>{
  const {storyShotProblems,storyPrimaryReferenceId,createStoryShot}=await import('../src/story-ui.mjs');
  const assets=[{id:'girl',name:'女孩',selectedImageId:'girl-image'},{id:'garden',name:'花园',selectedImageId:'garden-image'}];
  const shot={assetIds:['girl','garden'],primaryReferenceAssetId:''};
  assert.equal(storyPrimaryReferenceId(shot),'');
  assert.match(storyShotProblems(shot,assets,{imageProtocol:'comfy'}).join(''),/本地构图主参考/);
  assert.deepEqual(storyShotProblems(shot,assets,{imageProtocol:'compatible'}),[]);
  assert.deepEqual(storyShotProblems(shot,assets),[]);
  assert.deepEqual(storyShotProblems({...shot,primaryReferenceAssetId:'girl'},assets,{imageProtocol:'comfy'}),[]);
  assert.match(storyShotProblems({...shot,primaryReferenceAssetId:'removed'},assets,{imageProtocol:'comfy'}).join(''),/主参考/);
  assert.equal(storyPrimaryReferenceId({assetIds:['garden'],primaryReferenceAssetId:'removed'}),'garden');
  assert.deepEqual(storyShotProblems({assetIds:['garden']},assets,{imageProtocol:'comfy'}),[]);
  assert.deepEqual(storyShotProblems({...shot,selectedImageId:'confirmed-frame'},assets,{video:true,imageProtocol:'comfy'}),[]);
  assert.equal(createStoryShot().primaryReferenceAssetId,'');
});

function flowFixture(){
 const candidate=id=>({id,status:'ready'}),asset=(id,selected=true)=>({id,name:id,kind:'character',images:[candidate(id+'-image')],selectedImageId:selected?id+'-image':''});
 const shot=(id,ids)=>({id,assetIds:ids,images:[],videos:[],selectedImageId:'',selectedVideoId:''});
 const story={assets:[asset('shared'),asset('scene-1',false),asset('scene-2')],episodes:[{id:'e1',shots:[shot('s1',['shared','scene-1']),shot('s2',['shared'])],resultId:''},{id:'e2',shots:[shot('s3',['shared','scene-2'])],resultId:''}]};
 return {story,episode:story.episodes[0],candidate};
}

test('当前集资产进度只计算去重引用，待办定位具体资产，不改共享数据',async()=>{
 const {storyEpisodeProgress,storyEpisodeAssets}=await import('../src/story-ui.mjs'),{story,episode}=flowFixture(),before=structuredClone(story);
 assert.deepEqual(storyEpisodeAssets(story,episode).map(item=>item.id),['shared','scene-1']);const progress=storyEpisodeProgress(story,episode);
 assert.deepEqual(progress.counts,{shots:2,assets:2,assetsReady:1,framesReady:0,videosReady:0});assert.equal(progress.next.stage,'assets');assert.equal(progress.next.target.assetId,'scene-1');assert.equal(progress.next.target.episodeId,'e1');assert.match(progress.next.reason,/已有图片候选/);assert.deepEqual(story,before);
 assert.equal(storyEpisodeProgress(story,story.episodes[1]).counts.assetsReady,2);
});

test('未绑定或引用缺失资产优先定位镜头，来源变化使阶段回退',async()=>{
 const {storyEpisodeProgress}=await import('../src/story-ui.mjs'),{story,episode}=flowFixture();episode.shots[0].assetIds=['missing'];let progress=storyEpisodeProgress(story,episode);assert.equal(progress.next.target.shotId,'s1');assert.equal(progress.next.target.section,'bindings');
 episode.shots[0].assetIds=[];assert.equal(storyEpisodeProgress(story,episode).next.target.shotId,'s1');progress=storyEpisodeProgress(story,episode,{sourceChanged:true});assert.equal(progress.next.target.section,'source');assert(progress.stages.every(item=>!item.done));
 assert.equal(storyEpisodeProgress(story,null).next.target.section,'source');assert.equal(storyEpisodeProgress(story,{id:'empty',shots:[]}).next.target.section,'episode');
});

test('首帧视频的生成候选不当作确认，过期或缺素材不计完成',async()=>{
 const {storyEpisodeProgress,storySelectedCandidate}=await import('../src/story-ui.mjs'),{story,episode,candidate}=flowFixture();story.assets[1].selectedImageId='scene-1-image';const first=episode.shots[0],second=episode.shots[1];first.images=[candidate('f1')];let progress=storyEpisodeProgress(story,episode);assert.equal(progress.next.stage,'frames');assert.equal(progress.counts.framesReady,0);assert.match(progress.next.reason,/已有候选/);
 first.selectedImageId='f1';second.images=[candidate('f2')];second.selectedImageId='f2';progress=storyEpisodeProgress(story,episode);assert.equal(progress.next.stage,'videos');assert.equal(progress.counts.framesReady,2);first.videos=[candidate('v1')];first.selectedVideoId='v1';second.videos=[{id:'v2',status:'stale'}];second.selectedVideoId='v2';assert.equal(storyEpisodeProgress(story,episode).counts.videosReady,1);assert(!storySelectedCandidate(second,'video'));assert(!storySelectedCandidate(first,'image',[]));assert(storySelectedCandidate(first,'image',[{id:'f1',type:'image'}]));
 second.videos[0].status='ready';assert.equal(storyEpisodeProgress(story,episode,{narrationMissing:true}).next.label,'选择本集旁白');assert.equal(storyEpisodeProgress(story,episode).next.label,'前往合成当前集');episode.resultId='result';assert.equal(storyEpisodeProgress(story,episode).next.label,'检查当前集成片');
});

test('Z-Image绑定参考在提交前给出阻断，版本冲突与网络失败分开',async()=>{
 const {storyShotProblems,storyVersionConflict}=await import('../src/story-ui.mjs'),assets=[{id:'one',name:'人物',selectedImageId:'image'}],shot={assetIds:['one']};assert.match(storyShotProblems(shot,assets,{imageProtocol:'comfy',imageArchitecture:'z-image-turbo'}).join(),/Z-Image.*不能使用/);assert.deepEqual(storyShotProblems(shot,assets,{imageProtocol:'compatible',imageArchitecture:'z-image-turbo'}),[]);
 assert(storyVersionConflict(Error('创作内容已更新，请刷新后再保存，未覆盖新结果')));for(const error of ['fetch failed','无法连接模型服务','请选择资产图片','已恢复上次尚未保存的编辑'])assert(!storyVersionConflict(error));
});

async function componentFixture(options={}){
 const fs=require('node:fs'),path=require('node:path'),vue=require('vue'),sfc=require('@vue/compiler-sfc'),helpers={...await import('../src/story-ui.mjs'),...await import('../server/shot-localization-view.mjs')},filename=path.resolve(__dirname,'../src/components/StoryStudio.vue'),{descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename}),{story}=flowFixture();
 Object.assign(story,{revision:1,sourceMode:'custom',sourceText:'本集测试剧本',episodeCount:2,episodeDuration:10,narrationMode:'none'});story.episodesSourceHash=await helpers.storyEpisodeFingerprint(story);for(const ep of story.episodes)for(const shot of ep.shots)Object.assign(shot,{duration:5,visual:'测试画面'});
 helpers.storyUiDrafts.delete('task');
 const draft=vue.ref({id:'task',story,voice:{audioId:''}}),state=vue.ref({drafts:[draft.value],assets:story.assets.flatMap(item=>item.images.map(image=>({id:image.id,type:'image'}))),runs:[],settings:{provider:{}}}),calls=[],navigation=[],notices=[];
 const studio={state,draft,busy:vue.ref(''),workflowLocked:vue.ref(false),act:async(_,work)=>work(),refresh:async()=>{},notify:(...args)=>notices.push(args),navigate:value=>navigation.push(value),registerDraftFlusher:()=>()=>{}};
 const call=async(action,payload)=>{calls.push({action,payload});return options.call?options.call(action,payload,{draft,state}):{story:structuredClone(JSON.parse(JSON.stringify(draft.value.story)))};};
 const compiled=sfc.compileScript(descriptor,{id:'story-ui-test'}).content.replace(/^import .*;\r?\n/gm,'').replace('export default','return'),scope=vue.effectScope();
 const names=['computed','inject','nextTick','onBeforeUnmount','ref','watch','I','AssetPicker','Modal','StoryModelSettings','CreativePresets','call','mediaUrl','setTimeout','clearTimeout',...Object.keys(helpers)],values=[vue.computed,()=>studio,vue.nextTick,()=>{},vue.ref,vue.watch,{},{},{},{},{},call,id=>id,()=>1,()=>{},...Object.values(helpers)];
 const component=new Function(...names,compiled)(...values),vm=scope.run(()=>component.setup({}, {expose(){}}));await vue.nextTick();vm.inputFingerprint.value=await helpers.storyEpisodeFingerprint(vm.story.value);await vue.nextTick();return {vm,draft,state,calls,navigation,notices,dispose:()=>scope.stop(),descriptor,sfc,filename};
}

test('真实组件模板可编译，视频页就地绑定，错误恢复仅版本冲突提供',async()=>{
 const f=await componentFixture();try{assert.deepEqual(f.sfc.compileTemplate({id:'story-ui-test',source:f.descriptor.template.content,filename:f.filename}).errors,[]);assert.match(f.descriptor.template.content,/aria-label="视频页本地构图主参考"/);assert.match(f.descriptor.template.content,/v-if="versionConflict"[^>]*@click="loadServer"/);f.vm.error.value='fetch failed';assert.equal(f.vm.versionConflict.value,false);const before=JSON.stringify(f.vm.story.value);f.vm.loadServer();assert.equal(JSON.stringify(f.vm.story.value),before);f.vm.error.value='创作内容已更新，请刷新后再保存，未覆盖新结果';assert.equal(f.vm.versionConflict.value,true);}finally{f.dispose();}
});

test('具体待办只导航本集资产或镜头，不调用生成确认，网络错误不丢编辑',async()=>{
 const f=await componentFixture();try{assert.equal(f.vm.assetScope.value,'episode');await f.vm.goTo(f.vm.progress.value.next.target);assert.equal(f.vm.tab.value,'assets');assert.equal(f.vm.asset.value.id,'scene-1');assert.equal(f.calls.length,0);await f.vm.goTo({tab:'videos',episodeId:'e2',shotId:'s3',section:'bindings'});assert.equal(f.vm.episode.value.id,'e2');assert.equal(f.vm.shot.value.id,'s3');assert.equal(f.calls.length,0);f.vm.setBinding('scene-1',true);assert(f.vm.shot.value.assetIds.includes('scene-1'));f.vm.primaryReference.value='scene-1';assert.equal(f.vm.shot.value.primaryReferenceAssetId,'scene-1');assert.equal(f.draft.value.story.episodes[1].shots[0].primaryReferenceAssetId,undefined);f.vm.error.value='fetch failed';f.vm.loadServer();assert(f.vm.shot.value.assetIds.includes('scene-1'));assert.equal(f.calls.length,0);}finally{f.dispose();}
});

test('组件网络失败只提交一次并保留旧稿，unknown任务阻止导航生成',async()=>{
 const f=await componentFixture({call:async()=>{throw Error('fetch failed');}});try{const before=JSON.stringify(f.vm.story.value);await f.vm.run('generateStoryImage',{assetId:'scene-1'},'生成资产图片');assert.equal(f.calls.length,1);assert.equal(f.vm.error.value,'fetch failed');assert.equal(f.vm.versionConflict.value,false);assert.equal(JSON.stringify(f.vm.story.value),before);f.state.value.runs.push({id:'unknown',draftId:'task',type:'story-image',status:'unknown'});await f.vm.run('generateStoryImage',{assetId:'scene-1'});await f.vm.goTo({tab:'videos',episodeId:'e2'});assert.equal(f.calls.length,1);assert.equal(f.vm.tab.value,'episodes');assert.equal(f.vm.episode.value.id,'e1');}finally{f.dispose();}
});

test('批量纯函数只提交可见交集，待生成项跳过选用图和有效候选',async()=>{
 const {storyScopedSelection,storyAssetNeedsGeneration}=await import('../src/story-ui.mjs');assert.deepEqual(storyScopedSelection(['hidden','b','a','a'],[{id:'a'},{id:'b'}]),['a','b']);assert(storyAssetNeedsGeneration({images:[]}));assert(storyAssetNeedsGeneration({images:[{id:'old',status:'stale'}]}));assert(!storyAssetNeedsGeneration({selectedImageId:'selected',images:[]}));assert(!storyAssetNeedsGeneration({images:[{id:'ready',status:'ready'}]}));
});

test('批量状态采用parameters实时项目，结束采用output，停止和未知不伪装成功',async()=>{
 const {storyBatchSummary,storyBatchStatusLabel}=await import('../src/story-ui.mjs');const batch={status:'running',parameters:{batchAssetIds:['a','b','c'],batchItems:[{assetId:'a',status:'succeeded'},{assetId:'b',status:'running'},{assetId:'c',status:'queued'}]}};let summary=storyBatchSummary(batch);assert.equal(summary.active,true);assert.equal(summary.counts.succeeded,1);assert.equal(summary.counts.finished,1);assert.equal(summary.counts.total,3);
 batch.status='unknown';batch.parameters.batchItems[1].status='unknown';batch.parameters.batchItems[2].status='skipped';summary=storyBatchSummary(batch);assert.equal(summary.uncertain,true);assert.equal(summary.active,false);assert.equal(summary.counts.unknown,1);assert.equal(summary.counts.skipped,1);assert.match(storyBatchStatusLabel('unknown'),/请查原任务/);assert.equal(storyBatchStatusLabel('new-status'),'new-status');
 batch.status='cancelled';batch.output={items:[{assetId:'a',status:'succeeded'},{assetId:'b',status:'cancelled'},{assetId:'c',status:'skipped'}]};summary=storyBatchSummary(batch);assert.equal(summary.uncertain,false);assert.equal(summary.counts.cancelled,1);assert.equal(summary.counts.failed,0);assert.equal(storyBatchStatusLabel('cancelled'),'已停止');
});

test('单镜头、勾选镜头、整集提取发送准确范围，换集清勾选',async()=>{
 const f=await componentFixture();try{f.vm.shotId.value='s2';await f.vm.extractAssets('current');assert.deepEqual(f.calls[0],{action:'extractStoryAssets',payload:{id:'task',episodeId:'e1',shotId:'s2'}});f.vm.checkShot('s1',true);assert.equal(f.vm.shot.value.id,'s2');await f.vm.extractAssets('selected');assert.deepEqual(f.calls[1],{action:'extractStoryAssets',payload:{id:'task',episodeId:'e1',shotIds:['s1']}});await f.vm.extractAssets();assert.deepEqual(f.calls[2].payload,{id:'task',episodeId:'e1'});f.vm.selectShots(true);assert.deepEqual(f.vm.selectedShotIds.value,['s1','s2']);f.vm.episodeId.value='e2';assert.deepEqual(f.vm.selectedShotIds.value,[]);assert.deepEqual(f.vm.checkedShots.value,[]);assert.equal(f.calls.length,3);}finally{f.dispose();}
});

test('资产查看与勾选独立，筛选裁剪勾选，批量携带各自要求且不确认图片',async()=>{
 const f=await componentFixture();try{f.vm.tab.value='assets';f.vm.assetId.value='shared';f.vm.checkAsset('scene-1',true);assert.equal(f.vm.asset.value.id,'shared');f.vm.assetId.value='scene-1';assert.deepEqual(f.vm.selectedAssetIds.value,['scene-1']);f.vm.assetScope.value='all';f.vm.selectAssets('all');assert.deepEqual(f.vm.selectedAssetIds.value,['shared','scene-1','scene-2']);f.vm.assetScope.value='episode';assert.deepEqual(f.vm.checkedAssets.value,['shared','scene-1']);f.vm.instructions.value={shared:'保留外观优化材质','scene-1':'光线自然些','scene-2':'不应发送'};const before=f.vm.story.value.assets.map(item=>item.selectedImageId);await f.vm.generateCheckedAssets();assert.deepEqual(f.calls[0],{action:'generateStoryAssetImages',payload:{id:'task',assetIds:['shared','scene-1'],instructions:{shared:'保留外观优化材质','scene-1':'光线自然些'}}});assert.deepEqual(f.vm.story.value.assets.map(item=>item.selectedImageId),before);assert(f.calls.every(item=>!item.action.startsWith('selectStory')));f.vm.selectAssets('missing');assert.deepEqual(f.vm.selectedAssetIds.value,[]);f.vm.story.value.assets.find(item=>item.id==='scene-1').images=[];f.vm.selectAssets('missing');assert.deepEqual(f.vm.selectedAssetIds.value,['scene-1']);f.vm.kind.value='scene';assert.deepEqual(f.vm.selectedAssetIds.value,[]);}finally{f.dispose();}
});

test('停止只取消当前外层批量ID并等待真实状态，unknown只显示查询不重交',async()=>{
 const f=await componentFixture();try{f.state.value.runs=[{id:'batch-outer',draftId:'task',type:'story-image',status:'running',parameters:{batchAssetIds:['shared','scene-1'],batchItems:[{assetId:'shared',status:'running'},{assetId:'scene-1',status:'queued'}]}}];assert.equal(f.vm.batchSummary.value.active,true);await f.vm.stopBatch();assert.deepEqual(f.calls,[{action:'cancelRun',payload:{id:'batch-outer'}}]);assert.equal(f.vm.batchStopRunId.value,'batch-outer');assert.equal(f.state.value.runs[0].status,'running');await f.vm.stopBatch();assert.equal(f.calls.length,1);f.state.value.runs[0].status='unknown';f.state.value.runs[0].parameters.batchItems[0].status='unknown';f.state.value.runs[0].parameters.batchItems[1].status='skipped';assert.equal(f.vm.batchSummary.value.uncertain,true);assert.equal(f.vm.batchSummary.value.active,false);f.vm.checkedAssets.value=['shared'];await f.vm.generateCheckedAssets();assert.equal(f.calls.length,1);assert.match(f.descriptor.template.content,/停止批量生成/);assert.match(f.descriptor.template.content,/存在结果待确认的原任务/);}finally{f.dispose();}
});

test('窄窗口查看资产定位详情，宽窗口保留位置，均不改变批量勾选或提交生成',async()=>{
 const f=await componentFixture();try{
  const movements=[];let width=720;
  f.vm.rootElement.value={getBoundingClientRect:()=>({width}),querySelector:selector=>{assert.equal(selector,'[data-story-section="asset"]');return{scrollIntoView:options=>movements.push(['scroll',options]),focus:options=>movements.push(['focus',options])};}};
  f.vm.checkAsset('shared',true);await f.vm.viewAsset('scene-1');assert.equal(f.vm.asset.value.id,'scene-1');assert.deepEqual(f.vm.selectedAssetIds.value,['shared']);assert.deepEqual(movements,[['scroll',{block:'start',behavior:'auto'}],['focus',{preventScroll:true}]]);
  width=1000;await f.vm.viewAsset('shared');assert.equal(f.vm.asset.value.id,'shared');assert.equal(movements.length,2);assert.equal(f.calls.length,0);
 }finally{f.dispose();}
});

test('首尾控制前端校验支持零种子且云端不静默忽略',async()=>{
 const {storyVideoControlProblems}=await import('../src/story-ui.mjs');assert.deepEqual(storyVideoControlProblems({videoSeed:0}),[]);assert.deepEqual(storyVideoControlProblems({videoSeed:null},'bridge'),[]);assert.match(storyVideoControlProblems({videoSeed:-1}).join(''),/种子/);assert.match(storyVideoControlProblems({lastFrameId:'last'},'bridge').join(''),/仅支持本地/);
 const fs=require('node:fs'),source=fs.readFileSync(require('node:path').join(__dirname,'../src/components/StoryStudio.vue'),'utf8');assert.match(source,/choice\.draftId===draft\.value\.id&&choice\.episodeId===episode\.value\?\.id&&choice\.shotId===shot\.value\?\.id/);assert.match(source,/复用此种子对照/);assert.match(source,/清除尾帧/);
});
