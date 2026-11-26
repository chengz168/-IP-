const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {StoryStudio}=require('../server/story-studio.cjs');
const {StoryGenerator,PROMPT_COMPILER_VERSION}=require('../server/story-generator.cjs');
const {Runtime}=require('../server/runtime.cjs');
const {createStory,hash,assetInput,shotInput,videoInput}=require('../server/story-contract.cjs');

async function unknownBatch(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-batch-version-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const draft={id:'draft',confirmed:true,finalText:'介绍扒炉板面。'};
 const story=createStory(draft);story.instructions='保持商品完整，只有画外旁白。';
 story.assets=['a','b'].map(id=>({id,kind:'prop',name:'道具'+id,description:'独立金属道具',prompt:'金属道具静物',images:[],selectedImageId:''}));
 draft.story=story;
 const store={data:{runs:[],settings:{provider:{storyImageProtocol:'compatible'}}},draft:()=>draft,outputDir:()=>root,save(){}};
 const generator=new StoryGenerator(store,{},{}),runtime=new Runtime(store);
 const studio=new StoryStudio({store,generator,runtime});
 // 隔离正式工作区与上下游校验，批量执行、冻结、未知态和恢复仍走真实实现。
 studio.ready=()=>structuredClone(draft.story);studio.requireFacts=()=>null;studio.referenceFacts=()=>null;
 studio.assertMutable=()=>{};studio.sourceCurrent=()=>true;studio.write=(_id,value)=>{draft.story=value;return value;};
 let submissions=0;
 // 仅替换网络服务出口，不联网、不调用本地模型，保留真实生成器的提示编译和版本标记。
 generator.cloudImage=async(input,_prompt,_refs,_directory,ctx)=>{
  submissions++;ctx.remote('original-task',{kind:'story-compatible-image-v1',input,submissionState:'submitting'});
  throw Object.assign(Error('测试服务结果待确认'),{unknown:true});
 };
 await assert.rejects(studio.generateAssetImages({id:'draft',assetIds:['a','b']}),/结果待确认/);
 const run=store.data.runs.find(run=>run.type==='story-image');
 assert.equal(run.status,'unknown');assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['unknown','skipped']);
 return {draft,store,generator,studio,run,submissions:()=>submissions};
}

test('新批量任务在冻结前记录编译版本，计划、批次和远程凭据输入完全一致',async t=>{
 const f=await unknownBatch(t),input=f.run.parameters.input;
 assert.equal(input.promptCompilerVersion,PROMPT_COMPILER_VERSION);
 assert.equal(hash(input),hash(f.run.parameters.batchItems[0].input));
 assert.equal(hash(input),hash(f.run.remote.input));
 assert.equal(f.run.parameters.batchItems[1].input.promptCompilerVersion,PROMPT_COMPILER_VERSION);
 assert.equal(f.submissions(),1);
});

test('新版本批量未知结果能恢复原任务，只附着当前资产且不续交后续项目',async t=>{
 const f=await unknownBatch(t);let queried=0;
 f.generator.recover=async original=>{
  queried++;assert.equal(original.id,f.run.id);assert.equal(original.remoteId,'original-task');
  assert.equal(hash(original.parameters.input),hash(original.remote.input));
  return {id:'recovered-image',type:'image'};
 };
 const result=await f.studio.recover({runId:f.run.id});
 assert.equal(queried,1);assert.equal(result.status,'succeeded');assert.equal(f.run.status,'succeeded');
 assert.deepEqual(f.run.parameters.batchItems.map(item=>item.status),['succeeded','skipped']);
 assert.deepEqual(f.draft.story.assets[0].images.map(image=>image.id),['recovered-image']);
 assert.equal(f.draft.story.assets[1].images.length,0);assert.equal(f.submissions(),1);
});

test('新版本批量任务可确认原任务丢失并解除防重，不自动重提或续批',async t=>{
 const f=await unknownBatch(t);let queried=0;
 f.generator.confirmLost=async original=>{
  queried++;assert.equal(original.id,f.run.id);assert.equal(hash(original.parameters.input),hash(original.remote.input));
  return {status:'lost'};
 };
 const result=await f.studio.confirmLost({runId:f.run.id});
 assert.equal(queried,1);assert.equal(result.status,'lost');assert.equal(f.run.status,'failed');
 assert.equal(f.run.lostConfirmed,true);assert.deepEqual(f.run.parameters.batchItems.map(item=>item.status),['failed','skipped']);
 assert.doesNotThrow(()=>f.studio.imagePending('draft',{kind:'asset',assetId:'a'}));
 assert(f.draft.story.assets.every(asset=>asset.images.length===0));assert.equal(f.submissions(),1);
});

test('编译版本一致也不能忽略额外字段篡改，恢复与确认丢失均在查询前拒绝',async t=>{
 const f=await unknownBatch(t);f.run.remote.input.unrecognizedConstraint='未经冻结的新约束';
 const before=structuredClone(f.run);let queried=0;
 f.generator.recover=f.generator.confirmLost=async()=>{queried++;throw Error('不得查询');};
 await assert.rejects(f.studio.recover({runId:f.run.id}),/不一致/);
 await assert.rejects(f.studio.confirmLost({runId:f.run.id}),/不一致/);
 assert.equal(queried,0);assert.deepEqual(f.run,before);
});

test('无编译版本的历史冻结输入仍可恢复或确认丢失，查询过程不能补签版本',async t=>{
 for(const operation of ['recover','confirmLost']){
  const f=await unknownBatch(t);
  // 模拟版本字段引入前已落盘的历史任务，三份输入原本完全一致。
  for(const input of [f.run.parameters.input,f.run.parameters.batchItems[0].input,f.run.parameters.batchItems[1].input,f.run.remote.input])delete input.promptCompilerVersion;
  f.generator[operation]=async original=>{
   assert(!Object.hasOwn(original.parameters.input,'promptCompilerVersion'));
   assert(!Object.hasOwn(original.remote.input,'promptCompilerVersion'));
   return operation==='recover'?{id:'legacy-image',type:'image'}:{status:'lost'};
  };
  await f.studio[operation]({runId:f.run.id});
  for(const input of [f.run.parameters.input,f.run.parameters.batchItems[0].input,f.run.remote.input])assert(!Object.hasOwn(input,'promptCompilerVersion'));
  assert.equal(f.submissions(),1);
 }
});

test('新计划版本不改变旧候选摘要或重选资格，也不会给旧素材补签新规则',async()=>{
 const draft={id:'draft',confirmed:true,finalText:'清洁扒炉板面。'},story=createStory(draft);
 const asset={id:'asset',kind:'prop',name:'扒炉',description:'金属板面',prompt:'金属扒炉',images:[],selectedImageId:'legacy-asset'};
 const shot={id:'shot',text:draft.finalText,visual:'工作台上的扒炉',action:'清理板面',camera:'近景固定',sound:'自然环境声',duration:5,imagePrompt:'扒炉近景',videoPrompt:'清理板面',assetIds:[],selectedImageId:'legacy-frame',selectedVideoId:'legacy-video',images:[],videos:[]};
 story.assets=[asset];story.episodes=[{id:'episode',text:draft.finalText,shots:[shot]}];draft.story=story;
 const assetHash=hash(assetInput(story,asset)),shotHash=hash(shotInput(story,shot)),videoHash=hash(videoInput(story,shot));
 asset.images=[{id:'legacy-asset',status:'ready',inputHash:assetHash}];
 shot.images=[{id:'legacy-frame',status:'ready',inputHash:shotHash}];shot.videos=[{id:'legacy-video',status:'ready',inputHash:videoHash}];
 const histories=structuredClone({asset:asset.images,images:shot.images,videos:shot.videos});
 const store={data:{runs:[]},draft:()=>draft,save(){},asset:id=>({id,type:id==='legacy-video'?'video':'image'})};
 let submitted;const studio=new StoryStudio({store,runtime:new Runtime(store),generator:{video:async input=>{submitted=input;return {id:'new-video',type:'video'};}}});
 studio.ready=()=>structuredClone(draft.story);studio.requireFacts=()=>null;studio.referenceFacts=()=>null;studio.assertMutable=()=>{};studio.sourceCurrent=()=>true;studio.write=(_id,value)=>{draft.story=value;return value;};
 assert.equal(studio.imagePlan(story,{id:'draft',assetId:'asset'}).inputHash,assetHash);
 assert.equal(studio.videoHash(story,shot),videoHash);
 await studio.selectImage({id:'draft',assetId:'asset',imageId:'legacy-asset'});
 await studio.selectImage({id:'draft',episodeId:'episode',shotId:'shot',imageId:'legacy-frame'});
 await studio.selectVideo({id:'draft',episodeId:'episode',shotId:'shot',videoId:'legacy-video'});
 const current=draft.story.episodes[0].shots[0];
 assert.deepEqual({asset:draft.story.assets[0].images,images:current.images,videos:current.videos},histories);
 await studio.generateVideo({id:'draft',episodeId:'episode',shotId:'shot'});
 assert.equal(submitted.promptCompilerVersion,PROMPT_COMPILER_VERSION);assert.equal(submitted.inputHash,videoHash);
 assert.equal(store.data.runs[0].parameters.input.promptCompilerVersion,PROMPT_COMPILER_VERSION);
 assert(!Object.hasOwn(draft.story.episodes[0].shots[0].videos[0],'promptCompilerVersion'));
 assert.equal(draft.story.episodes[0].shots[0].selectedVideoId,'legacy-video');
});
