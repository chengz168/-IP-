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
