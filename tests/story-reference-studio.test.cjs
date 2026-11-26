const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {StoryStudio}=require('../server/story-studio.cjs'),{Runtime}=require('../server/runtime.cjs'),{createStory}=require('../server/story-contract.cjs');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function fixture(t,{mode='assets'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-reference-studio-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const draft={id:'draft',confirmed:true,finalText:'师傅展示扒炉。随后擦拭台面。',voice:{},video:{},edit:{captions:[]},cover:{},publish:{},artifacts:{}},assets=new Map(),calls=[],responses=[];let sequence=0;
 const store={data:{runs:[],settings:{provider:{}}},draft(id){assert.equal(id,'draft');return draft;},save(){},asset(id){const asset=assets.get(id);if(!asset)throw Error('素材不存在');return asset;}};
 const providers={text:async()=>({text:JSON.stringify(responses.shift()),requestId:'isolated-test'})};
 const generator=Object.fromEntries(['image','video','compose'].map(kind=>[kind,async input=>{calls.push({kind,input});const id=kind+'-'+(++sequence),file=path.join(root,id+(kind==='image'?'.png':'.mp4'));fs.writeFileSync(file,kind+'独立测试文件'+sequence);const asset={id,path:file,type:kind==='image'?'image':'video',duration:input.duration||4};assets.set(id,asset);return asset;}]));
 const studio=new StoryStudio({store,providers,runtime:new Runtime(store),media:{},generator}),initial=createStory(draft);initial.episodeDuration=4;await studio.save({id:'draft',story:initial,revision:0});await studio.splitEpisodes({id:'draft'});const episodeId=draft.story.episodes[0].id;
 responses.push({shots:[{endUnit:2,visual:'同一扒炉放在厨房台面上',action:'师傅擦拭台面',camera:'固定中近景',sound:'室内环境声',duration:4,imagePrompt:'厨房扒炉',videoPrompt:'展示扒炉并清理台面'}]});await studio.splitShots({id:'draft',episodeId});
 const story=structuredClone(draft.story);story.assets=[{id:'stove',kind:'prop',name:'扒炉',description:'不锈钢扒炉，三个旋钮',prompt:'同一台不锈钢扒炉',images:[],selectedImageId:''},{id:'room',kind:'scene',name:'厨房',description:'明亮干净的工作厨房',prompt:'厨房工作台',images:[],selectedImageId:''}];const shot=story.episodes[0].shots[0];shot.assetIds=['stove','room'];shot.referenceMode=mode;
 await studio.save({id:'draft',story,revision:story.revision});
 const target={id:'draft',episodeId,shotId:shot.id};
 for(const assetId of ['stove','room']){const image=await studio.generateImage({id:'draft',assetId});await studio.selectImage({id:'draft',assetId,imageId:image.material.id});}
 return {root,store,draft,assets,calls,studio,generator,target,shot:()=>draft.story.episodes[0].shots[0],story:()=>draft.story};
}
async function videoSelected(f){const generated=await f.studio.generateVideo(f.target);assert.equal(generated.stale,false);await f.studio.selectVideo({...f.target,videoId:generated.material.id});return generated;}

test('资产参考镜头无需构图首帧，经生成选用后进入真实合成输入并完成集交接',async t=>{
 const f=await fixture(t);assert.equal(f.shot().selectedImageId,'');const generated=await videoSelected(f),input=f.calls.find(row=>row.kind==='video').input;
 assert.equal(input.referenceMode,'assets');assert.equal(input.image,undefined);assert.equal(input.lastFrame,undefined);assert.deepEqual(input.references.map(ref=>ref.storyAssetId),['stove','room']);assert.equal(input.references.length,2);for(const ref of input.references)assert.equal(ref.sha256,digest(f.assets.get(ref.assetId).path));
 assert.match(input.prompt,/不固定首帧或尾帧/);assert.doesNotMatch(input.prompt,/参考图是实际首帧|从实际首帧出发/);
 const composed=await f.studio.composeEpisode({id:'draft',episodeId:f.target.episodeId}),composition=f.calls.find(row=>row.kind==='compose').input;
 assert.equal(composition.shots[0].assetId,generated.material.id);assert.equal(composition.shots[0].sha256,digest(generated.material.path));assert.equal(composition.shots[0].duration,4);assert.equal(f.story().episodes[0].resultId,composed.material.id);
 await f.studio.useEpisode({id:'draft',episodeId:f.target.episodeId});assert.equal(f.draft.video.mode,'story');assert.equal(f.draft.edit.sourceId,composed.material.id);assert.equal(f.draft.step,4);
});

test('更改资产定义使资产确认与旧视频候选失效，不能选用或合成',async t=>{
 const f=await fixture(t),old=await videoSelected(f),next=structuredClone(f.story());next.assets[0].description='新的四旋钮扒炉';await f.studio.save({id:'draft',story:next,revision:next.revision});
 assert.equal(f.story().assets[0].selectedImageId,'');assert.equal(f.shot().selectedVideoId,'');assert.equal(f.shot().videos.find(row=>row.id===old.material.id).status,'stale');await assert.rejects(f.studio.selectVideo({...f.target,videoId:old.material.id}),/过期/);await assert.rejects(f.studio.generateVideo(f.target),/未确认|过期/);await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:f.target.episodeId}),/未确认|过期/);
});

test('换用新资产图使旧候选拒绝，再生成时传递新图片与新hash',async t=>{
 const f=await fixture(t),old=await videoSelected(f),before=f.calls.find(row=>row.kind==='video').input.references[0],replacement=await f.studio.generateImage({id:'draft',assetId:'stove'});await f.studio.selectImage({id:'draft',assetId:'stove',imageId:replacement.material.id});
 assert.equal(f.shot().selectedVideoId,'');await assert.rejects(f.studio.selectVideo({...f.target,videoId:old.material.id}),/过期/);await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:f.target.episodeId}),/未确认|过期/);
 await videoSelected(f);const after=f.calls.filter(row=>row.kind==='video').at(-1).input.references[0];assert.notEqual(after.assetId,before.assetId);assert.notEqual(after.sha256,before.sha256);assert.equal(after.assetId,replacement.material.id);
});

test('同素材ID和路径下实际参考字节被替换，旧候选与旧成片交接都拒绝',async t=>{
 const f=await fixture(t),old=await videoSelected(f);await f.studio.composeEpisode({id:'draft',episodeId:f.target.episodeId});const reference=f.story().assets[0].selectedImageId;fs.writeFileSync(f.assets.get(reference).path,'原素材编号中的参考图被替换');
 await assert.rejects(f.studio.selectVideo({...f.target,videoId:old.material.id}),/过期/);await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:f.target.episodeId}),/过期/);await assert.rejects(f.studio.useEpisode({id:'draft',episodeId:f.target.episodeId}),/过期|匹配|确认/);
});

test('参考图片在生成期间被替换只登记过期候选，不自动选用',async t=>{
 const f=await fixture(t),generate=f.generator.video;f.generator.video=async input=>{const result=await generate(input);fs.writeFileSync(f.assets.get(input.references[0].assetId).path,'生成期间字节被替换');return result;};const result=await f.studio.generateVideo(f.target);assert.equal(result.stale,true);assert.equal(result.candidate.status,'stale');assert.equal(f.shot().selectedVideoId,'');await assert.rejects(f.studio.selectVideo({...f.target,videoId:result.material.id}),/过期/);
});

test('缺失图、失效图、无绑定、缺失资产和重复图片绑定拒绝且不调用生成器',async t=>{
 const cases=[
  f=>{f.story().assets[0].selectedImageId='';},
  f=>{const a=f.story().assets[0];a.images.find(row=>row.id===a.selectedImageId).status='stale';},
  f=>{f.shot().assetIds=[];},
  f=>{f.shot().assetIds=['missing'];},
  f=>{const a=f.story().assets[0],b=f.story().assets[1],candidate=b.images.find(row=>row.id===b.selectedImageId);b.selectedImageId=a.selectedImageId;candidate.id=a.selectedImageId;},
  f=>{f.assets.get(f.story().assets[0].selectedImageId).type='video';}
 ];
 for(const mutate of cases){const f=await fixture(t);mutate(f);await assert.rejects(f.studio.generateVideo(f.target),/参考|绑定|资产|图片/);assert.equal(f.calls.filter(row=>row.kind==='video').length,0);}
});

test('保存缺失或重复资产绑定以及资产模式尾帧均拒绝，草稿不发生半保存',async t=>{
 const f=await fixture(t),prior=structuredClone(f.story());
 for(const change of [shot=>{shot.assetIds=['stove','stove'];},shot=>{shot.assetIds=['missing'];},shot=>{shot.lastFrameId='tail';}]){const next=structuredClone(f.story());change(next.episodes[0].shots[0]);await assert.rejects(f.studio.save({id:'draft',story:next,revision:next.revision}),/缺失|重复|尾帧/);assert.deepEqual(f.story(),prior);}
});

test('旧首帧模式仍要求构图确认并传入image，不被切成资产参考',async t=>{
 const f=await fixture(t,{mode:'first-frame'});await assert.rejects(f.studio.generateVideo(f.target),/先确认镜头构图/);const image=await f.studio.generateImage(f.target);await f.studio.selectImage({...f.target,imageId:image.material.id});await videoSelected(f);const input=f.calls.find(row=>row.kind==='video').input;assert.equal(input.image.assetId,image.material.id);assert.equal(input.referenceMode,undefined);assert.equal(input.references,undefined);assert.match(input.prompt,/参考图是实际首帧/);assert.equal(f.shot().selectedImageId,image.material.id);assert.doesNotThrow(()=>f.studio.composition(f.story(),f.target.episodeId,'draft'));
});

test('资产模式切换首帧模式使旧视频候选过期，不能绕过首帧确认',async t=>{
 const f=await fixture(t),old=await videoSelected(f),next=structuredClone(f.story());next.episodes[0].shots[0].referenceMode='first-frame';await f.studio.save({id:'draft',story:next,revision:next.revision});assert.equal(f.shot().selectedVideoId,'');await assert.rejects(f.studio.selectVideo({...f.target,videoId:old.material.id}),/过期/);await assert.rejects(f.studio.generateVideo(f.target),/构图图片/);
});
