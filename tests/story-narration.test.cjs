const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {alignNarrationShots,fileHash}=require('../server/story-narration.cjs');
const {StoryStudio}=require('../server/story-studio.cjs');
const {Store}=require('../server/store.cjs');
const {Runtime}=require('../server/runtime.cjs');
const {hash,createStory,shotInput}=require('../server/story-contract.cjs');
const {speechContext,speechRequest,speechEvidence}=require('../server/speech-request.cjs');

// 只验证真实边界和写盘契约；识别与探测为明确替身，不代表声音或视频质量通过。
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-narration-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),d=store.draft(),texts=['小明走进花园。','他拿起水壶。'];d.finalText=texts.join('');d.confirmed=true;
 const s=createStory(d);s.episodeDuration=8;s.narrationMode='upstream';s.episodesSourceHash=hash([s.sourceText,s.episodeCount,s.episodeDuration]);
 s.episodes=[{id:'ep',title:'花园',text:d.finalText,shots:texts.map((text,index)=>({id:'shot-'+index,text,duration:4,visual:'花园场景'+index,action:'自然动作'+index,camera:'固定机位',sound:'环境声',imagePrompt:'花园',videoPrompt:'自然动作',assetIds:[],images:[],videos:[],selectedImageId:'',selectedVideoId:''})),results:[],resultId:''}];d.story=s;
 const file=path.join(root,'voice.wav');fs.writeFileSync(file,'隔离音频契约占位，不代表真实生成音频');const audio=store.addAsset(file,{speech:{request:speechEvidence(speechRequest(d,speechContext(store.data)))}});d.voice.audioId=audio.id;
 const rows=[{start:0,end:5,text:texts[0]},{start:5,end:11,text:texts[1]}];let calls=0;
 const providers={transcribe:async()=>{calls++;return {segments:structuredClone(rows),engine:'明确注入的识别契约替身'};}};
 const media={probe:async()=>({format:{duration:'11'},streams:[{codec_type:'audio'}]})},runtime=new Runtime(store),studio=new StoryStudio({store,providers,media,runtime,generator:{}});
 store.save();return {store,d,s,audio,rows,providers,media,runtime,studio,calls:()=>calls,id:d.id};
}

test('按真实段落边界对齐而非平均时长，并保留正文和真实音频摘要',async t=>{
 const f=fixture(t),before=f.d.story.episodes[0].shots.map(s=>s.text).join(''),out=await f.studio.alignNarration({id:f.id,episodeId:'ep'});
 assert.equal(out.stale,false);assert.equal(out.timing.method,'asr-exact-text-boundaries');assert.deepEqual(out.timing.shots.map(s=>s.duration),[5,6]);assert.equal(out.timing.audioId,f.audio.id);assert.equal(out.timing.audioSha256,fileHash(f.audio.path));assert.equal(out.timing.estimatedBoundaries,0);assert.equal(out.timing.requiresReview,true);assert.equal(out.story.episodes[0].shots.map(s=>s.text).join(''),before);assert.equal(f.calls(),1);assert.equal(f.store.data.runs[0].type,'story-align-narration');assert.equal(f.store.data.runs[0].status,'succeeded');assert.equal(out.qualityAccepted,false);
});

test('真实词级时间保留且严格切点落词尾，词内边界默认拒绝',async()=>{
 const shots=[{id:'a',text:'小明。'},{id:'b',text:'拿水壶。'}],recognition={segments:[{start:0,end:8,text:'小明。拿水壶。',words:[{start:0,end:5,word:'小明。'},{start:5,end:8,word:'拿水壶。'}]}]};
 const timing=await alignNarrationShots(shots,'小明。拿水壶。',recognition,8);assert.equal(timing.shots[0].end,5);assert.equal(timing.shots[0].endMethod,'asr-word-end');assert.equal(timing.wordBoundaryCount,2);
 await assert.rejects(alignNarrationShots([{id:'a',text:'小。'},{id:'b',text:'明拿水壶。'}],'小。明拿水壶。',recognition,8),/词内部/);
});

test('段内估计必须显式同意并标记，不按字数冒充真实词边界',async()=>{
 const shots=[{id:'a',text:'小明。'},{id:'b',text:'拿水壶。'}],recognition={segments:[{start:0,end:10,text:'小明拿水壶。'}]};
 await assert.rejects(alignNarrationShots(shots,'小明。拿水壶。',recognition,10),/明确允许估计/);
 const timing=await alignNarrationShots(shots,'小明。拿水壶。',recognition,10,{allowEstimated:true});assert.equal(timing.method,'asr-boundaries-with-explicit-interpolation');assert.equal(timing.estimatedBoundaries,1);assert.equal(timing.shots[0].endMethod,'asr-segment-interpolation-estimate');assert.equal(timing.requiresReview,true);
 await assert.rejects(alignNarrationShots(shots,'小明。拿水壶。',recognition,10,{allowEstimated:'yes'}),/布尔/);
});

test('同长度错字、数字改写和否定缺失均拒绝，不校正ASR文字凑匹配',async()=>{
 for(const [expected,detected]of [['小明拿水壶。','小红拿水壶。'],['厚度10毫米。','厚度十毫米。'],['不能倾倒。','可以倾倒。']])await assert.rejects(alignNarrationShots([{id:'a',text:expected}],expected,{segments:[{start:0,end:5,text:detected}]},5),/无法逐字匹配/);
});

test('空时间轴、倒序、无效词时间及漏镜正文均拒绝',async()=>{
 const shot=[{id:'a',text:'小明。'}];
 await assert.rejects(alignNarrationShots(shot,'小明。',{segments:[]},5),/没有时间轴/);
 await assert.rejects(alignNarrationShots(shot,'小明。',{segments:[{start:2,end:1,text:'小明。'}]},5),/时间无效/);
 await assert.rejects(alignNarrationShots(shot,'小明。',{segments:[{start:0,end:5,text:'小明。',words:[{start:0,end:6,word:'小明。'}]}]},5),/词级时间轴无效/);
 await assert.rejects(alignNarrationShots(shot,'小明。还有结尾。',{segments:[{start:0,end:5,text:'小明。'}]},5),/没有逐字覆盖/);
});

test('短于4秒与长于15秒保留真实对齐并返回限制，不裁剪音频',async()=>{
 const shots=[{id:'a',text:'短句。'},{id:'b',text:'更长的句子。'}],timing=await alignNarrationShots(shots,'短句。更长的句子。',{segments:[{start:0,end:2,text:'短句。'},{start:2,end:20,text:'更长的句子。'}]},20);
 assert.deepEqual(timing.shots.map(s=>s.duration),[2,18]);assert.equal(timing.timelineDuration,20);assert.equal(timing.limitations.length,2);assert(timing.limitations.every(item=>item.reason.includes('未裁剪旁白')));
});

test('时长变化保留候选历史并撤销选用及已交接旧成片',async t=>{
 const f=fixture(t),episode=f.d.story.episodes[0];
 for(const shot of episode.shots){shot.images=[{id:'img-'+shot.id,status:'ready',inputHash:hash(shotInput(f.d.story,shot))}];shot.videos=[{id:'vid-'+shot.id,status:'ready'}];shot.selectedImageId=shot.images[0].id;shot.selectedVideoId=shot.videos[0].id;}
 episode.resultId='old-result';episode.resultInputHash='old-hash';episode.results=[{id:'old-result',status:'ready'}];f.d.story.activeEpisodeId='ep';f.d.video.assetId='old-result';f.d.edit.sourceId='old-result';f.d.edit.resultId='edited-old';
 const out=await f.studio.alignNarration({id:f.id,episodeId:'ep'}),after=out.story.episodes[0];assert.equal(after.resultId,'');assert.equal(after.results[0].id,'old-result');assert.equal(f.d.video.assetId,'');assert.equal(f.d.edit.sourceId,'');assert.equal(f.d.edit.resultId,'');for(const shot of after.shots){assert.equal(shot.images.length,1);assert.equal(shot.videos.length,1);assert.equal(shot.images[0].status,'stale');assert.equal(shot.videos[0].status,'stale');assert.equal(shot.selectedImageId,'');assert.equal(shot.selectedVideoId,'');}
});

test('音色、正文凭据失配与无speech凭据时识别前拒绝',async t=>{
 for(const change of [f=>{f.d.voice.speed=1.2;},f=>{delete f.audio.speech;},f=>{f.audio.speech.request.textSha256='forged';}]){const f=fixture(t),before=structuredClone(f.d.story);change(f);await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}),/不一致/);assert.deepEqual(f.d.story,before);assert.equal(f.calls(),0);}
});

test('多集不能误用整条第三步音频，明确本集音频按本集正文检查',async t=>{
 const f=fixture(t),first=f.d.story.episodes[0];f.d.story.episodeCount=2;f.d.story.episodes.push({...structuredClone(first),id:'ep-two',shots:first.shots.map(s=>({...s,id:'two-'+s.id}))});f.d.story.episodesSourceHash=hash([f.d.story.sourceText,2,8]);
 await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}),/当前集/);assert.equal(f.calls(),0);
 first.narrationAssetId=f.audio.id;const out=await f.studio.alignNarration({id:f.id,episodeId:'ep'});assert.equal(out.stale,false);assert.deepEqual(f.d.story.episodes[1].shots.map(s=>s.duration),[4,4]);
});

test('识别失败或取消保持旧镜头和候选',async t=>{
 for(const mode of ['failed','cancelled']){const f=fixture(t),before=structuredClone(f.d.story);f.providers.transcribe=async()=>{if(mode==='failed')throw Error('明确注入的识别失败');f.runtime.cancel(f.store.data.runs[0].id);return {segments:f.rows};};await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}));assert.deepEqual(f.d.story,before);assert.equal(f.store.data.runs[0].status,mode);}
});

test('识别期间同编号音频替换、切音色或改镜头返回stale且不覆盖',async t=>{
 for(const change of [f=>fs.writeFileSync(f.audio.path,'不同的音频字节'),f=>{f.d.voice.speed=1.3;},f=>{f.d.story.episodes[0].shots[0].action='识别期间新编辑';}]){const f=fixture(t);f.providers.transcribe=async()=>{change(f);return {segments:f.rows};};const out=await f.studio.alignNarration({id:f.id,episodeId:'ep'});assert.equal(out.stale,true);assert.equal(f.d.story.episodes[0].narrationTiming,undefined);assert.deepEqual(f.d.story.episodes[0].shots.map(s=>s.duration),[4,4]);}
});

test('保存失败回滚整个草稿，凭据不能由普通save伪造或删除',async t=>{
 const f=fixture(t);await f.studio.alignNarration({id:f.id,episodeId:'ep'});let s=structuredClone(f.d.story);s.episodes[0].narrationTiming.audioSha256='forged';await assert.rejects(f.studio.save({id:f.id,story:s,revision:s.revision}),/服务端维护/);
 s=structuredClone(f.d.story);delete s.episodes[0].narrationTiming;await assert.rejects(f.studio.save({id:f.id,story:s,revision:s.revision}),/服务端维护/);
 s=structuredClone(f.d.story);s.episodes[0].shots[0].duration=4;await f.studio.save({id:f.id,story:s,revision:s.revision});assert.equal(f.d.story.episodes[0].narrationTiming.invalidated,true);
 const before=structuredClone(f.d),save=f.store.save.bind(f.store);f.store.save=()=>{if(f.d.story.episodes[0].narrationTiming)throw Error('隔离磁盘保存失败');save();};await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}),/保存失败/);assert.deepEqual(f.d,before);
});

test('无有效音轨、商品专用流程和同目标活动任务不能混入普通对齐',async t=>{
 const f=fixture(t);f.media.probe=async()=>({format:{duration:11},streams:[{codec_type:'video'}]});await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}),/没有有效音轨/);assert.equal(f.calls(),0);
 f.store.data.runs.push({draftId:f.id,type:'story-align-narration',status:'unknown',parameters:{input:{episodeId:'ep'}}});await assert.rejects(f.studio.alignNarration({id:f.id,episodeId:'ep'}),/不能直接重交/);
});
