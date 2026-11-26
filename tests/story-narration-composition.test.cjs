const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../server/store.cjs'),{Runtime}=require('../server/runtime.cjs'),{StoryStudio}=require('../server/story-studio.cjs');
const {createStory,hash}=require('../server/story-contract.cjs');
const {fileHash,validateNarrationTiming,alignNarrationShots}=require('../server/story-narration.cjs');
const {speechRequest,speechContext,speechEvidence}=require('../server/speech-request.cjs');

// 媒体和识别使用隔离契约替身，仅验证凭据与旧结果失效，不代表真实出片质量。
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'narration-composition-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),d=store.draft();d.finalText='小明走进花园。他拿起水壶。';d.confirmed=true;
 const s=createStory(d);s.episodeDuration=11;s.narrationMode='upstream';s.episodesSourceHash=hash([s.sourceText,1,11]);
 s.episodes=[{id:'ep',title:'花园',text:d.finalText,shots:['小明走进花园。','他拿起水壶。'].map((text,i)=>({id:'shot-'+i,text,duration:4,visual:'花园',action:'浇花',camera:'固定',sound:'环境声',imagePrompt:'花园',videoPrompt:'浇花',assetIds:[],images:[],videos:[],selectedImageId:'frame',selectedVideoId:''})),results:[],resultId:''}];d.story=s;
 const voice=path.join(root,'voice.wav');fs.writeFileSync(voice,'测试音频甲');const audio=store.addAsset(voice,{speech:{request:speechEvidence(speechRequest(d,speechContext(store.data)))}});d.voice.audioId=audio.id;
 const generator={compose:async input=>{const file=path.join(root,'composition-'+store.data.assets.length+'.mp4');fs.writeFileSync(file,'隔离合成替身');return store.addAsset(file,{duration:11});}};
 const studio=new StoryStudio({store,runtime:new Runtime(store),providers:{transcribe:async()=>({segments:[{start:0,end:5,text:'小明走进花园。'},{start:5,end:11,text:'他拿起水壶。'}]})},media:{probe:async()=>({format:{duration:11},streams:[{codec_type:'audio'}]})},generator});
 await studio.alignNarration({id:d.id,episodeId:'ep'});
 for(const [i,shot]of d.story.episodes[0].shots.entries()){const file=path.join(root,'shot-'+i+'.mp4');fs.writeFileSync(file,'隔离镜头'+i);const video=store.addAsset(file,{duration:shot.duration});shot.selectedImageId='frame';shot.selectedVideoId=video.id;shot.videos=[{id:video.id,inputHash:studio.videoHash(d.story,shot),status:'ready'}];}
 store.save();return {store,d,studio,audio,generator,episode:()=>d.story.episodes[0],compose:()=>studio.composition(d.story,'ep',d.id)};
}

test('有效对齐凭据进入合成输入，凭据变化使已合成结果不能交接',async t=>{
 const f=await fixture(t),input=f.compose();assert.equal(input.narrationTiming.sha256,hash(f.episode().narrationTiming));assert.equal(input.narrationTiming.audioSha256,fileHash(f.audio.path));
 await f.studio.composeEpisode({id:f.d.id,episodeId:'ep'});const before=f.episode().resultId;f.episode().narrationTiming.requiresReview=false;
 await assert.rejects(f.studio.useEpisode({id:f.d.id,episodeId:'ep'}),/匹配镜头/);assert.equal(f.episode().resultId,before);
});

test('音频同编号同长度替换、声音设置和正文变更均拒绝旧对齐凭据',async t=>{
 for(const change of [f=>fs.writeFileSync(f.audio.path,'测试音频乙'),f=>{f.d.voice.speed=1.3;},f=>{f.d.voice.profile='another';},f=>{f.audio.speech.request.textSha256='forged';},f=>{f.episode().text='小明走进花园。他拿起杯子。';}]){const f=await fixture(t);change(f);assert.throws(f.compose,/旁白对齐凭据已失效/);}
});

test('音频选择、镜头时长和时间轴结构变更均不能复用凭据',async t=>{
 for(const change of [f=>{f.episode().narrationAssetId=f.audio.id;},f=>{f.episode().shots[0].duration=4;},f=>{f.episode().narrationTiming.shots[0].shotId='wrong';},f=>{f.episode().narrationTiming.shots[1].start+=.1;},f=>{f.episode().narrationTiming.timelineDuration+=1;},f=>{f.episode().narrationTiming.version=2;},f=>{f.episode().narrationTiming=null;}]){const f=await fixture(t);change(f);assert.throws(f.compose,/旁白对齐凭据已失效/);}
});

test('实际镜头时长偏离旁白对齐时拒绝合成，即使总时长不变',async t=>{
 const f=await fixture(t),[a,b]=f.episode().shots;f.store.asset(a.selectedVideoId).duration+=1;f.store.asset(b.selectedVideoId).duration-=1;assert.throws(f.compose,/镜头视频与旁白对齐时长不一致/);
});

test('保存同总时长新切点保留失效凭据，重新生成镜头也不能绕过旁白对齐',async t=>{
 const f=await fixture(t),before=structuredClone(f.episode().narrationTiming),s=structuredClone(f.d.story);
 s.episodes[0].shots[0].duration=6;s.episodes[0].shots[1].duration=5;
 await f.studio.save({id:f.d.id,story:s,revision:s.revision});
 assert.deepEqual(f.episode().narrationTiming,{...before,invalidated:true});
 // 模拟新时长镜头已经生成，仅替换隔离候选与媒体元数据，不调用模型。
 for(const shot of f.episode().shots){const asset=f.store.data.assets.find(item=>item.name==='shot-'+(shot.id==='shot-0'?0:1)+'.mp4');asset.duration=shot.duration;shot.selectedImageId='frame';shot.selectedVideoId=asset.id;shot.videos=[{id:asset.id,inputHash:f.studio.videoHash(f.d.story,shot),status:'ready'}];}
 assert.equal(f.episode().shots.reduce((sum,shot)=>sum+shot.duration,0),11);
 assert.throws(f.compose,/旁白对齐凭据已失效/);
});

test('保存正文、单镜台词、时长和旁白选择变化均保留失效凭据',async t=>{
 const changes=[
  s=>{s.sourceMode='custom';s.sourceText+='补充剧本';},
  s=>{s.episodes[0].text=s.episodes[0].text.replace('水壶','杯子');},
  s=>{s.episodes[0].shots[0].text='小明离开花园。';},
  s=>{s.episodes[0].shots[0].duration=6;},
  (s,f)=>{s.episodes[0].narrationAssetId=f.store.addAsset(f.audio.path,{speech:structuredClone(f.audio.speech)}).id;}
 ];
 for(const change of changes){const f=await fixture(t),s=structuredClone(f.d.story),audioHash=f.episode().narrationTiming.audioSha256;change(s,f);await f.studio.save({id:f.d.id,story:s,revision:s.revision});assert.equal(f.episode().narrationTiming.invalidated,true);assert.equal(f.episode().narrationTiming.audioSha256,audioHash);assert.throws(f.compose,/旁白对齐凭据已失效/);}
});

test('上游确认稿改变后同步保存保留对齐失效历史',async t=>{
 const f=await fixture(t),next=structuredClone(f.d);next.finalText+='新的结尾。';f.store.updateDraft(next);const s=structuredClone(f.store.draft(f.d.id).story);
 await f.studio.save({id:f.d.id,story:s,revision:s.revision});
 assert.equal(f.store.draft(f.d.id).story.episodes[0].narrationTiming.invalidated,true);
 assert.throws(()=>validateNarrationTiming(f.store,f.store.draft(f.d.id),f.store.draft(f.d.id).story,f.store.draft(f.d.id).story.episodes[0]),/旁白对齐凭据已失效/);
});

test('普通保存不能删除或伪造失效状态，真正重新对齐才解除',async t=>{
 const f=await fixture(t),s=structuredClone(f.d.story);s.episodes[0].shots[0].duration=6;await f.studio.save({id:f.d.id,story:s,revision:s.revision});
 for(const alter of [timing=>{delete timing.invalidated;},timing=>{timing.invalidated=false;}]){const forged=structuredClone(f.d.story);alter(forged.episodes[0].narrationTiming);await assert.rejects(f.studio.save({id:f.d.id,story:forged,revision:forged.revision}),/服务端维护/);}
 const omitted=structuredClone(f.d.story);delete omitted.episodes[0].narrationTiming;await assert.rejects(f.studio.save({id:f.d.id,story:omitted,revision:omitted.revision}),/服务端维护/);
 const forgedDraft=structuredClone(f.d);delete forgedDraft.story.episodes[0].narrationTiming;f.store.updateDraft(forgedDraft);
 assert.equal(f.store.draft(f.d.id).story.episodes[0].narrationTiming.invalidated,true);
 const out=await f.studio.alignNarration({id:f.d.id,episodeId:'ep'});
 assert.equal(out.stale,false);assert.equal(out.story.episodes[0].narrationTiming.invalidated,undefined);
 assert.deepEqual(out.story.episodes[0].shots.map(shot=>shot.duration),[5,6]);
 assert(validateNarrationTiming(f.store,f.store.draft(f.d.id),out.story,out.story.episodes[0]));
});

test('切无旁白模式可合成，切回上游仍须重新对齐',async t=>{
 const f=await fixture(t),s=structuredClone(f.d.story);s.narrationMode='none';await f.studio.save({id:f.d.id,story:s,revision:s.revision});
 assert.equal(f.episode().narrationTiming.invalidated,true);assert.equal(f.compose().narration,null);assert(!Object.hasOwn(f.compose(),'narrationTiming'));
 const returned=structuredClone(f.d.story);returned.narrationMode='upstream';await f.studio.save({id:f.d.id,story:returned,revision:returned.revision});assert.throws(f.compose,/旁白对齐凭据已失效/);
});

test('旧无凭据音频和视频旁白保持兼容，无旁白不生成新凭据字段',async t=>{
 const f=await fixture(t);delete f.episode().narrationTiming;assert.equal(validateNarrationTiming(f.store,f.d,f.d.story,f.episode()),null);assert(!Object.hasOwn(f.compose(),'narrationTiming'));
 f.audio.type='video';assert(!Object.hasOwn(f.compose(),'narrationTiming'));f.d.story.narrationMode='none';assert.equal(f.compose().narration,null);
});

test('商品专用凭据仍由原流程校验，不混入普通旁白对齐校验',async t=>{
 const f=await fixture(t),s=f.d.story;f.d.product={title:'花园工具'};f.episode().narrationAssetId=f.audio.id;s.productIntroduction={version:1,productHash:hash(f.d.product),audioId:f.audio.id,audioSha256:fileHash(f.audio.path),images:[],captions:[]};f.episode().narrationTiming={version:999};
 for(const shot of f.episode().shots)shot.videos[0].inputHash=f.studio.videoHash(s,shot);
 const input=f.compose();assert(!Object.hasOwn(input,'narrationTiming'));assert.equal(input.productIntroduction.audioSha256,fileHash(f.audio.path));
});

test('合成执行中切声音设置仅保留过期产物，不登记当前成片',async t=>{
 const f=await fixture(t),compose=f.generator.compose;f.generator.compose=async input=>{const material=await compose(input);f.d.voice.speed=1.3;return material;};
 const out=await f.studio.composeEpisode({id:f.d.id,episodeId:'ep'});assert.equal(out.stale,true);assert.equal(f.episode().resultId,'');assert.equal(f.store.asset(out.material.id).type,'video');
});

test('可信稿映射只接受显式布尔许可，严格文字匹配仍保持真实边界方法',async t=>{
 const f=await fixture(t),before=structuredClone(f.d);await assert.rejects(f.studio.alignNarration({id:f.d.id,episodeId:'ep',allowReferenceMapping:'true'}),/布尔值/);assert.deepEqual(f.d,before);
 const out=await f.studio.alignNarration({id:f.d.id,episodeId:'ep',allowReferenceMapping:true});assert.equal(out.timing.method,'asr-exact-text-boundaries');assert.equal(out.stale,false);assert.equal(f.store.data.runs[0].parameters.input.allowReferenceMapping,true);
});

test('ASR文字存在差异时不修正或猜测，未安装映射服务给出明确状态',async t=>{
 const exists=fs.existsSync;t.mock.method(fs,'existsSync',file=>path.resolve(file)===path.resolve(__dirname,'../server/narration-reference.cjs')?false:exists(file));
 const shots=[{id:'shot-1',text:'这是扒炉。'}],recognition={segments:[{start:0,end:4,text:'这是八爐。'}]};
 await assert.rejects(alignNarrationShots(shots,'这是扒炉。',recognition,4,{allowReferenceMapping:true}),/尚未启用可信稿映射/);
 await assert.rejects(alignNarrationShots(shots,'这是扒炉。',recognition,4),/无法逐字匹配/);
});
