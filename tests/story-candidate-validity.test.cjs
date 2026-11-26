const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {StoryStudio}=require('../server/story-studio.cjs');
const {createStory,hash,assetInput,shotInput}=require('../server/story-contract.cjs');
const {resolveCreativePreset}=require('../server/creative-presets.mjs');

function fixture(t,{old=true,legacy=false,mode='assets'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-candidate-validity-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const draft={id:'d',confirmed:true,finalText:'故事中的师傅展示金属板。',voice:{},video:{},edit:{},cover:{},publish:{},artifacts:{}};
 const story=createStory(draft);story.episodeDuration=4;
 const asset={id:'a',kind:'prop',name:'金属板',description:'一块金属板',prompt:'一块金属板',images:[],selectedImageId:'asset-image'};
 const shot={id:'s',text:draft.finalText,visual:'金属板放在工作台',action:'保持静止',camera:'中景固定',sound:'室内环境声',duration:4,assetIds:['a'],referenceMode:mode,imagePrompt:'金属板',videoPrompt:'金属板',images:[],videos:[],selectedImageId:mode==='assets'?'':'frame',selectedVideoId:'video'};
 const episode={id:'e',title:'测试集',text:draft.finalText,shots:[shot],resultId:''};story.assets=[asset];story.episodes=[episode];story.episodesSourceHash=hash([story.sourceText,story.episodeCount,story.episodeDuration]);draft.story=story;
 const assets=new Map();for(const [id,type] of [['asset-image','image'],['frame','image'],['video','video']]){const file=path.join(root,id);fs.writeFileSync(file,'独立测试素材 '+id);assets.set(id,{id,type,path:file,duration:4});}
 let saves=0;const store={data:{runs:[],workflowJobs:[],assets:[...assets.values()]},draft:()=>draft,asset(id){const a=assets.get(id);if(!a)throw Error('素材不存在');return a;},save(){saves++;}};
 const studio=new StoryStudio({store});
 const preset=kind=>{const value=resolveCreativePreset(draft,kind);if(old)value.contentProfile.version='2026-11-22.2';return value;};
 const candidate=(id,inputHash,kind)=>({id,status:'ready',inputHash,...(legacy?{}:{creativePreset:preset(kind)})});
 asset.images=[candidate('asset-image',hash(assetInput(story,asset)),'image')];shot.images=[candidate('frame',hash(shotInput(story,shot)),'image')];shot.videos=[candidate('video',studio.videoHash(story,shot),'video')];
 return {draft,story,asset,shot,episode,studio,store,assets,saves:()=>saves};
}

test('旧画像视频的前端确认与后端重选、合成一致拒绝，历史记录不变',async t=>{
 const f=fixture(t),ui=await import('../src/story-ui.mjs'),before=structuredClone(f.draft),presets=ui.storyCandidatePresets(f.draft,f.story),media=[...f.assets.values()];
 assert.equal(ui.storySelectedCandidate(f.shot,'video',media,presets),false);
 const progress=ui.storyEpisodeProgress(f.story,f.episode,{media,presets});assert.equal(progress.counts.videosReady,0);assert.match(progress.next.reason,/当前预设/);
 assert.match(ui.storyCandidateDescription(f.shot.videos[0],{kind:'video',presets,selected:true}),/创作预设已变化/);
 await assert.rejects(f.studio.selectVideo({id:'d',episodeId:'e',shotId:'s',videoId:'video'}),/过期/);
 assert.throws(()=>f.studio.composition(f.story,'e','d'),/过期/);
 assert.deepEqual(f.draft,before);assert.equal(f.saves(),0);
});

test('旧画像已选资产仍可做参考，重选拒绝且不补签旧图片',async t=>{
 const f=fixture(t),ui=await import('../src/story-ui.mjs'),before=structuredClone(f.draft),presets=ui.storyCandidatePresets(f.draft,f.story);
 assert.equal(ui.storyCandidateAvailable(f.asset.images[0],'image',presets),false);
 assert.equal(ui.storySelectedCandidate(f.asset,'image',[...f.assets.values()],presets,'reference'),true);
 assert.match(ui.storyCandidateDescription(f.asset.images[0],{presets,selected:true}),/历史参考可用/);
 assert.equal(ui.storyAssetNeedsGeneration(f.asset,presets),false);
 assert.equal(f.studio.videoReferences(f.story,f.shot)[0].assetId,'asset-image');
 const progress=ui.storyEpisodeProgress(f.story,f.episode,{media:[...f.assets.values()],presets});assert.equal(progress.counts.assetsReady,1);assert.equal(progress.counts.framesReady,1);
 await assert.rejects(f.studio.selectImage({id:'d',assetId:'a',imageId:'asset-image'}),/过期/);
 assert.deepEqual(f.draft,before);assert.equal(f.saves(),0);
});

test('旧画像首帧继续作为既有参考，不因画像升级清空首帧或重写凭据',async t=>{
 const f=fixture(t,{mode:'first-frame'}),ui=await import('../src/story-ui.mjs'),presets=ui.storyCandidatePresets(f.draft,f.story),before=structuredClone(f.draft);
 assert.equal(ui.storySelectedCandidate(f.shot,'image',[...f.assets.values()],presets,'reference'),true);
 assert.equal(ui.storyEpisodeProgress(f.story,f.episode,{media:[...f.assets.values()],presets}).counts.framesReady,1);
 await assert.rejects(f.studio.selectImage({id:'d',episodeId:'e',shotId:'s',imageId:'frame'}),/过期/);
 assert.deepEqual(f.draft,before);
});

test('无预设快照的历史视频和当前快照视频保留重选与合成资格',async t=>{
 for(const options of [{legacy:true},{old:false}]){
  const f=fixture(t,options),ui=await import('../src/story-ui.mjs'),presets=ui.storyCandidatePresets(f.draft,f.story);
  assert.equal(ui.storySelectedCandidate(f.shot,'video',[...f.assets.values()],presets),true);
  assert.equal(ui.storyEpisodeProgress(f.story,f.episode,{media:[...f.assets.values()],presets}).counts.videosReady,1);
  assert.equal(f.studio.composition(f.story,'e','d').shots[0].assetId,'video');
  await f.studio.selectVideo({id:'d',episodeId:'e',shotId:'s',videoId:'video'});assert.equal(f.draft.story.episodes[0].shots[0].selectedVideoId,'video');
  if(options.legacy)assert.equal(f.draft.story.episodes[0].shots[0].videos[0].creativePreset,undefined);
 }
});

test('即使预设匹配，状态、输入或媒体缺失仍不能计为确认',async t=>{
 const f=fixture(t,{old:false}),ui=await import('../src/story-ui.mjs'),{storyCandidateIssue}=await import('../server/story-candidate-validity.mjs'),presets=ui.storyCandidatePresets(f.draft,f.story),candidate=f.shot.videos[0];
 assert.equal(ui.storySelectedCandidate(f.shot,'video',[],presets),false);
 assert.equal(storyCandidateIssue(candidate,{inputHash:'不同输入',preset:presets.video}),'input');
 candidate.status='stale';assert.equal(ui.storySelectedCandidate(f.shot,'video',[...f.assets.values()],presets),false);
 assert.equal(storyCandidateIssue(candidate,{purpose:'reference',requireReady:true}),'stale');
 f.asset.images[0].status='stale';assert.throws(()=>f.studio.videoReferences(f.story,f.shot),/未确认或已过期/);
});

test('未选用的旧画像图片不会被当作可用候选阻止待生成筛选',async t=>{
 const f=fixture(t),ui=await import('../src/story-ui.mjs'),presets=ui.storyCandidatePresets(f.draft,f.story);f.asset.selectedImageId='';
 assert.equal(ui.storyAssetNeedsGeneration(f.asset,presets),true);
 assert.equal(ui.storyCandidateDescription(f.asset.images[0],{presets}), '创作预设已变化，请重新生成');
});

test('商品导入原图可以显式重新确认，旧生成图和非商品原图不获得例外',async()=>{
 const ui=await import('../src/story-ui.mjs'),presets={image:{version:'new'},productIntroduction:true};
 const imported={id:'original',status:'stale',imported:true};
 assert.equal(ui.storyCandidateSelectable(imported,'image',presets),true);
 assert.equal(ui.storyCandidateAvailable(imported,'image',presets),false);
 assert.match(ui.storyCandidateDescription(imported,{presets}),/原图待重新确认/);
 assert.equal(ui.storyCandidateSelectable({...imported,imported:false},'image',presets),false);
 assert.equal(ui.storyCandidateSelectable(imported,'image',{...presets,productIntroduction:false}),false);
 assert.equal(ui.storyCandidateSelectable(imported,'video',presets),false);
});

test('实际视频候选模板按视频预设禁用历史选用，合成栏采用有效确认计数',async t=>{
 const f=fixture(t),ui=await import('../src/story-ui.mjs'),vue=require('vue'),{parse,compileTemplate}=require('@vue/compiler-sfc'),{compile}=require('@vue/compiler-dom'),{renderToString}=require('@vue/server-renderer');
 const filename=path.resolve(__dirname,'../src/components/StoryStudio.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'));
 assert.deepEqual(compileTemplate({id:'candidate-validity',filename,source:descriptor.template.content}).errors,[]);
 const fragment=descriptor.template.content.match(/<div v-if="shot.videos.length" class="story-video-candidates">[\s\S]*?<\/article><\/div>/)?.[0];assert(fragment);
 const presets=ui.storyCandidatePresets(f.draft,f.story),render=new Function('Vue',compile(fragment,{mode:'function',prefixIdentifiers:true}).code)(vue);
 const html=await renderToString(vue.createSSRApp({render,setup:()=>({shot:f.shot,locked:false,localVideo:false,mediaUrl:id=>id,candidateSeed:()=>undefined,candidateReady:(item,kind)=>ui.storyCandidateAvailable(item,kind,presets),describeCandidate:(item,kind)=>ui.storyCandidateDescription(item,{kind,presets,selected:true})})}));
 assert.match(html,/创作预设已变化/);assert.match(html,/<button disabled>历史版本<\/button>/);assert.doesNotMatch(html,/已选用/);
 assert.match(descriptor.template.content,/progress.counts.videosReady[\s\S]*?镜头已确认可合成/);
});
