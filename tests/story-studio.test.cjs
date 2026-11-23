const {test}=require('node:test'),assert=require('node:assert/strict');
const {StoryStudio}=require('../server/story-studio.cjs');const {Runtime}=require('../server/runtime.cjs');const {createStory}=require('../server/story-contract.cjs');
function fixture(){const d={id:'draft',confirmed:true,finalText:'小明走进花园。他拿起水壶浇花。',voice:{audioId:'narration'},video:{assetId:'old'},edit:{sourceId:'old',captions:[{start:0,end:1,text:'原视频字幕'}]},cover:{assetId:'cover'},publish:{videoId:'old'},artifacts:{}},assets=new Map([['narration',{id:'narration',type:'audio',duration:4}]]),calls=[],responses=[];let seq=0;
 const store={data:{runs:[]},draft:id=>{assert.equal(id,'draft');return d;},save(){},asset:id=>{if(!assets.has(id))throw Error('素材不存在');return assets.get(id);}};
 const providers={text:async(system,user,ctx,options)=>{calls.push({kind:'text',system,user,options});const next=responses.shift();return {text:typeof next==='string'?next:JSON.stringify(next),requestId:'mock-contract'};}};
 const generator=Object.fromEntries(['image','video','compose'].map(kind=>[kind,async(input,ctx)=>{calls.push({kind,input});const item={id:kind+'-'+(++seq),type:kind==='image'?'image':'video',duration:input.duration||4};assets.set(item.id,item);return item;}]));
 const studio=new StoryStudio({store,providers,runtime:new Runtime(store),media:{},generator});return {studio,d,store,calls,responses,assets,generator};}
async function oneEpisode(f){const initial=createStory(f.d);initial.episodeDuration=4;await f.studio.save({id:'draft',story:initial,revision:0});await f.studio.splitEpisodes({id:'draft'});const episode=f.d.story.episodes[0];f.responses.push({shots:[{endUnit:require('../server/story-text-ranges.cjs').sourceUnits(episode.text).length,visual:'一人花园浇花',action:'拿起水壶',camera:'中景固定',sound:'环境声',duration:4,imagePrompt:'花园中的小明',videoPrompt:'小明拿起水壶'}]});await f.studio.splitShots({id:'draft',episodeId:episode.id});return {episodeId:episode.id,shotId:f.d.story.episodes[0].shots[0].id};}
async function imageAndVideo(f,target){const image=await f.studio.generateImage({id:'draft',...target});await f.studio.selectImage({id:'draft',...target,imageId:image.material.id});const video=await f.studio.generateVideo({id:'draft',...target});await f.studio.selectVideo({id:'draft',...target,videoId:video.material.id});return video;}

test('视频生成完整传入当前镜头画面动作运镜声音，高级提示词不覆盖当前编辑',async()=>{
 const f=fixture(),target=await oneEpisode(f);let s=structuredClone(f.d.story),shot=s.episodes[0].shots[0];
 Object.assign(shot,{visual:'狸花猫坐在窗边',action:'猫咪自然眨眼',camera:'中近景固定机位',sound:'室内低环境声，无音乐',videoPrompt:'Earlier advanced prompt'});await f.studio.save({id:'draft',story:s,revision:s.revision});
 await imageAndVideo(f,target);const input=f.calls.find(item=>item.kind==='video').input;
 for(const value of ['Earlier advanced prompt','Scene: 狸花猫坐在窗边','Action: 猫咪自然眨眼','Camera: 中近景固定机位','Sound: 室内低环境声，无音乐','take precedence'])assert(input.prompt.includes(value));
 assert.equal(f.d.story.episodes[0].shots[0].videoPrompt,'Earlier advanced prompt');assert.equal(input.duration,4);
});
test('当前集交接归档旧标题封面发布正文，无旁白默认不识别环境音，保存失败完整回滚',async()=>{
 const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});
 f.d.edit.title='旧集标题';f.d.edit.subtitle='旧集副标题';f.d.edit.subtitlesEnabled=true;f.d.cover={title:'旧封面',subtitle:'旧副标题',backgroundId:'old-image',assetId:'cover',scene:{layers:[{id:'main',text:'旧封面',binding:'title'}]}};f.d.publish={title:'旧发布标题',description:'旧集发布信息',tags:['旧集'],videoId:'old'};
 const prior=structuredClone(f.d),save=f.store.save;f.store.save=()=>{throw Error('磁盘保存失败');};await assert.rejects(f.studio.useEpisode({id:'draft',episodeId:target.episodeId}),/保存失败/);assert.deepEqual(f.d,prior);f.store.save=save;
 await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});assert.equal(f.d.video.mode,'story');assert.equal(f.d.step,4);assert.equal(f.d.edit.title,'');assert.equal(f.d.edit.subtitlesEnabled,false);assert.equal(f.d.cover.backgroundId,'');assert.equal(f.d.cover.scene.layers[0].text,'');assert.equal(f.d.publish.title,'');assert.deepEqual(f.d.publish.tags,[]);assert.equal(f.d.artifacts.storyHandoffs[0].publish.description,'旧集发布信息');assert.equal(f.d.finalText,prior.finalText);
});
test('镜头主参考纳入版本指纹，换主参考使已选图和视频过期',async()=>{
 const f=fixture(),target=await oneEpisode(f);let s=structuredClone(f.d.story);s.assets=[{id:'prop-a',kind:'prop',name:'红船',description:'红色纸船',prompt:'red boat',images:[],selectedImageId:''},{id:'scene-a',kind:'scene',name:'溪流',description:'溪流',prompt:'stream',images:[],selectedImageId:''}];s.episodes[0].shots[0].assetIds=['prop-a','scene-a'];s.episodes[0].shots[0].primaryReferenceAssetId='prop-a';await f.studio.save({id:'draft',story:s,revision:s.revision});
 for(const assetId of ['prop-a','scene-a']){const r=await f.studio.generateImage({id:'draft',assetId});await f.studio.selectImage({id:'draft',assetId,imageId:r.material.id});}await imageAndVideo(f,target);assert(f.d.story.episodes[0].shots[0].selectedVideoId);
 s=structuredClone(f.d.story);s.episodes[0].shots[0].primaryReferenceAssetId='scene-a';await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.story.episodes[0].shots[0].selectedImageId,'');assert.equal(f.d.story.episodes[0].shots[0].selectedVideoId,'');
 s=structuredClone(f.d.story);s.episodes[0].shots[0].primaryReferenceAssetId='unbound';await assert.rejects(f.studio.save({id:'draft',story:s,revision:s.revision}),/主参考/);
});
test('单集直接保留全部原文不调用模型，多集引用边界且校验完整覆盖',async()=>{const f=fixture();assert.equal(createStory(f.d).sourceMode,'upstream');await f.studio.splitEpisodes({id:'draft'});assert.equal(f.d.story.episodes[0].text,f.d.finalText);assert.equal(f.calls.length,0);assert.equal(f.store.data.runs[0].output.modelExecuted,false);
 let s=structuredClone(f.d.story);s.episodeCount=2;await f.studio.save({id:'draft',story:s,revision:s.revision});const before=structuredClone(f.d.story.episodes);
 f.responses.push({episodes:[{title:'一',endUnit:1}]});await assert.rejects(f.studio.splitEpisodes({id:'draft'}),/指定集数/);assert.deepEqual(f.d.story.episodes,before);
 const invalid={episodes:[{title:'一',endUnit:1},{title:'二',endUnit:1}]};f.responses.push(invalid);await assert.rejects(f.studio.splitEpisodes({id:'draft'}),/边界无效/);assert.deepEqual(f.d.story.episodes,before);assert.equal(f.store.data.runs[0].failureOutput.rawText,JSON.stringify(invalid));
 f.responses.push({episodes:[{title:'一',endUnit:1},{title:'二',endUnit:2}]});await f.studio.splitEpisodes({id:'draft'});assert.equal(f.d.story.episodes.length,2);assert.equal(f.d.story.episodes.map(e=>e.text).join(''),f.d.finalText);assert.equal(f.calls.at(-1).options.schema.properties.episodes.maxItems,2);
});

test('单集长文不依赖模型重抄，包含结尾与首尾空白，且不会自动提取资产',async()=>{const f=fixture();f.d.finalText='\n  '+('这是保留原文的长段落。\n'.repeat(1000))+'最后两段必须留下。\n\n结尾🐈。\r\n';f.studio.providers.text=async()=>{throw Error('单集不应访问模型');};const result=await f.studio.splitEpisodes({id:'draft'});assert.equal(result.origin,'local-source-ranges');assert.equal(f.d.story.episodes[0].text,f.d.finalText);assert.deepEqual(f.d.story.assets,[]);assert.deepEqual(f.d.story.episodes[0].shots,[]);assert.equal(f.store.data.runs.length,1);});

test('分镜边界规划后分批设计，完整原文和总时长由程序保持',async()=>{
 const f=fixture();f.d.finalText='\n一。二。三。四。五。六。七。\r\n';const s=createStory(f.d);s.episodeDuration=61;await f.studio.save({id:'draft',story:s,revision:0});await f.studio.splitEpisodes({id:'draft'});const e=f.d.story.episodes[0];
 f.responses.push({shots:Array.from({length:7},(_,i)=>({endUnit:i+1}))});
 const design=endUnit=>({endUnit,text:'模型试图改写原文',duration:999,visual:'同一只猫在室内第'+endUnit+'处',action:'抬头',camera:'固定',sound:'雨声',imagePrompt:'One cat by a window',videoPrompt:'The cat looks up'});
 f.responses.push(...[1,2,3,4,5,6,7].map(n=>({shots:[design(n)]})));
 const result=await f.studio.splitShots({id:'draft',episodeId:e.id}),shots=f.d.story.episodes[0].shots;
 assert.equal(shots.length,7);assert.equal(shots.map(sh=>sh.text).join(''),f.d.finalText);assert.equal(shots.reduce((sum,sh)=>sum+Math.round(sh.duration*100),0),6100);assert(shots.every(sh=>sh.duration>=4&&sh.duration<=15));assert.equal(result.batches.length,8);assert.equal(f.calls.length,8);
});

test('后批分镜失败保持旧镜头和已完成模型证据，不提交半套结果',async()=>{
 const f=fixture(),target=await oneEpisode(f);const s=structuredClone(f.d.story);s.episodeDuration=40;s.sourceText=f.d.finalText='一。二。三。四。';await f.studio.save({id:'draft',story:s,revision:s.revision});await f.studio.splitEpisodes({id:'draft'});const e=f.d.story.episodes[0],before=structuredClone(e.shots);
 f.responses.push({shots:[1,2,3,4].map(endUnit=>({endUnit}))},{shots:[{endUnit:1,visual:'花园',action:'浇花',camera:'中景',sound:'鸟鸣',imagePrompt:'One person in a garden',videoPrompt:'The person waters flowers'}]},{shots:[{endUnit:3}]});
 await assert.rejects(f.studio.splitShots({id:'draft',episodeId:e.id}),/映射不完整/);assert.deepEqual(f.d.story.episodes[0].shots,before);assert.equal(f.store.data.runs[0].failureOutput.completedBatches.length,3);
});

test('真实观察过的重复画面和分屏设计被拒绝，不写入不合格分镜',async()=>{
 for(const mode of ['重复','分屏']){
  const f=fixture();f.d.finalText='第一段。第二段。';const s=createStory(f.d);s.episodeDuration=20;await f.studio.save({id:'draft',story:s,revision:0});await f.studio.splitEpisodes({id:'draft'});const e=f.d.story.episodes[0],design={visual:mode==='分屏'?'分屏对比两种材质':'猫在砂盆行走',action:'猫走向边缘',camera:'固定',sound:'环境声',imagePrompt:'One cat in a room',videoPrompt:'The cat walks'};
  f.responses.push({shots:[{endUnit:1},{endUnit:2}]},{shots:[{endUnit:1,...design}]},{shots:[{endUnit:2,...design}]});
  await assert.rejects(f.studio.splitShots({id:'draft',episodeId:e.id}),mode==='分屏'?/分屏或拼贴/:/重复了已有镜头/);assert.deepEqual(f.d.story.episodes[0].shots,[]);assert(f.store.data.runs[0].failureOutput.completedBatches.length>=2);
 }
});

test('多次模型调用中途停止不登记半套镜头，迟到响应保留为取消证据',async()=>{
 const f=fixture();f.d.finalText='第一段。第二段。';const s=createStory(f.d);s.episodeDuration=20;await f.studio.save({id:'draft',story:s,revision:0});await f.studio.splitEpisodes({id:'draft'});const e=f.d.story.episodes[0];let finish,calls=0;
 const design=endUnit=>({endUnit,visual:'画面'+endUnit,action:'自然动作',camera:'固定',sound:'环境声',imagePrompt:'One subject',videoPrompt:'A natural motion'});
 f.studio.providers.text=async()=>{calls++;if(calls===1)return {text:JSON.stringify({shots:[{endUnit:1},{endUnit:2}]})};if(calls===2)return {text:JSON.stringify({shots:[design(1)]})};return new Promise(resolve=>finish=resolve);};
 const pending=f.studio.splitShots({id:'draft',episodeId:e.id});await new Promise(resolve=>setImmediate(resolve));const run=f.store.data.runs[0];assert.equal(calls,3);f.studio.runtime.cancel(run.id);finish({text:JSON.stringify({shots:[design(2)]})});await assert.rejects(pending,/abort|取消/i);assert.equal(run.status,'cancelled');assert.deepEqual(f.d.story.episodes[0].shots,[]);assert.equal(run.failureOutput.completedBatches.length,3);
});

test('资产提取使用唯一key到ID映射，非法绑定失败保留旧镜头',async()=>{const f=fixture(),target=await oneEpisode(f);f.responses.push({assets:[{key:'person',kind:'character',name:'小明',description:'花园里的人',prompt:'小明外观'}],bindings:[{shotId:target.shotId,assetKeys:['missing']}]});await assert.rejects(f.studio.extractAssets({id:'draft'}),/无效ID/);assert.deepEqual(f.d.story.assets,[]);
 f.responses.push({assets:[{key:'person',kind:'character',name:'小明',description:'花园里的人',prompt:'小明外观'}],bindings:[{shotId:target.shotId,assetKeys:['person']}]});await f.studio.extractAssets({id:'draft'});const a=f.d.story.assets[0];assert.notEqual(a.id,'person');assert.deepEqual(f.d.story.episodes[0].shots[0].assetIds,[a.id]);
});

test('重复提取必须明确复用原资产ID，不能新建同名资产或错配旧ID',async()=>{
 const f=fixture(),target=await oneEpisode(f),s=structuredClone(f.d.story);s.assets=[{id:'same-person',kind:'character',name:'小明',description:'花园里的人',prompt:'A person',images:[],selectedImageId:''}];await f.studio.save({id:'draft',story:s,revision:s.revision});const before=structuredClone(f.d.story);
 for(const asset of [{key:'new-person',kind:'character',name:'小明'},{key:'same-person',kind:'prop',name:'水壶'}]){f.responses.push({assets:[{...asset,description:'不应覆盖的描述',prompt:'A kettle'}],bindings:[{shotId:target.shotId,assetKeys:[asset.key]}]});await assert.rejects(f.studio.extractAssets({id:'draft'}),/同名资产|不一致/);assert.deepEqual(f.d.story,before);}
 f.responses.push({assets:[{key:'same-person',kind:'character',name:'小明',description:'本次修订后的实体描述',prompt:'Another description'}],bindings:[{shotId:target.shotId,assetKeys:['same-person']}]});await f.studio.extractAssets({id:'draft'});assert.equal(f.d.story.assets.length,1);assert.equal(f.d.story.assets[0].description,'本次修订后的实体描述');assert.deepEqual(f.d.story.episodes[0].shots[0].assetIds,['same-person']);
});

test('零资产不再标成功，唯一纠正仍为空时保留旧资产绑定与已选媒体',async()=>{
 const f=fixture(),target=await oneEpisode(f);f.responses.push({assets:[{key:'person',kind:'character',name:'小明',description:'花园里的人',prompt:'A person'}],bindings:[{shotId:target.shotId,assetKeys:['person']}]});await f.studio.extractAssets({id:'draft'});
 const assetId=f.d.story.assets[0].id,image=await f.studio.generateImage({id:'draft',assetId});await f.studio.selectImage({id:'draft',assetId,imageId:image.material.id});await imageAndVideo(f,target);
 const before=structuredClone(f.d.story),calls=f.calls.length,empty={assets:[],bindings:[{shotId:target.shotId,assetKeys:[]}]};f.responses.push(empty,empty,{assets:[]});
 await assert.rejects(f.studio.extractAssets({id:'draft'}),/未提取到具体实体资产/);assert.deepEqual(f.d.story,before);assert.equal(f.calls.length-calls,2);assert.equal(f.responses.length,1);
 const run=f.store.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.failureOutput.assetExtraction.attempts.length,2);for(const attempt of run.failureOutput.assetExtraction.attempts){assert.equal(attempt.modelResult.text,JSON.stringify(empty));assert.equal(attempt.validation.status,'failed');assert.equal(attempt.schema.properties.assets.minItems,1);assert.equal(attempt.schema.properties.bindings.items.properties.assetKeys.minItems,1);}
 assert.match(run.failureOutput.assetExtraction.attempts[1].user,/唯一一次纠正机会/);
});

test('空资产有界纠正后新实体临时key分配真实ID，完整审计随成功结果保存',async()=>{
 const f=fixture(),target=await oneEpisode(f);f.responses.push({assets:[],bindings:[{shotId:target.shotId,assetKeys:[]}]},{assets:[{key:'new_person',kind:'character',name:'小明',description:'花园里的人',prompt:'A person'}],bindings:[{shotId:target.shotId,assetKeys:['new_person']}]});
 const calls=f.calls.length,result=await f.studio.extractAssets({id:'draft'});assert.equal(f.calls.length-calls,2);assert.equal(f.d.story.assets.length,1);assert.notEqual(f.d.story.assets[0].id,'new_person');assert.deepEqual(f.d.story.episodes[0].shots[0].assetIds,[f.d.story.assets[0].id]);assert.deepEqual(result.assetExtraction.attempts.map(a=>a.validation.status),['failed','passed']);assert.equal(f.store.data.runs[0].status,'succeeded');
 assert.match(f.calls.at(-1).user,/新实体允许唯一临时key/);
});

test('部分镜头空绑定也整套失败，旧绑定保留且不追加首项新资产',async()=>{
 const f=await batchFixture(),s=structuredClone(f.d.story),original=s.episodes[0].shots[0];original.assetIds=[f.assetIds[0]];s.episodes[0].shots.push({...structuredClone(original),id:'second-shot'});await f.studio.save({id:'draft',story:s,revision:s.revision});const before=structuredClone(f.d.story),old=f.d.story.assets[0],response={assets:[{key:old.id,kind:old.kind,name:old.name,description:old.description,prompt:old.prompt},{key:'new_kettle',kind:'prop',name:'水壶',description:'金属水壶',prompt:'A metal kettle'}],bindings:[{shotId:f.shotId,assetKeys:[old.id,'new_kettle']},{shotId:'second-shot',assetKeys:[]}]};
 f.responses.push(response,response);await assert.rejects(f.studio.extractAssets({id:'draft'}),/second-shot/);assert.deepEqual(f.d.story,before);const audit=f.store.data.runs[0].failureOutput.assetExtraction;assert.equal(audit.attempts.length,2);assert(audit.attempts.every(a=>/second-shot/.test(a.validation.error)));
});

test('纠正响应异常不进行第三次请求，保存首轮空结果与第二轮请求证据',async()=>{
 const f=fixture(),target=await oneEpisode(f),before=structuredClone(f.d.story);let calls=0;f.studio.providers.text=async()=>{if(++calls===1)return {text:JSON.stringify({assets:[],bindings:[{shotId:target.shotId,assetKeys:[]}]})};throw Error('纠正请求网络失败');};
 await assert.rejects(f.studio.extractAssets({id:'draft'}),/网络失败/);assert.equal(calls,2);assert.deepEqual(f.d.story,before);const audit=f.store.data.runs[0].failureOutput.assetExtraction;assert.equal(audit.attempts.length,2);assert.equal(audit.attempts[0].validation.status,'failed');assert.equal(audit.attempts[1].phase,'correction');assert.match(audit.attempts[1].user,/输入资料/);assert.match(audit.attempts[1].validation.error,/网络失败/);
});

test('空结果后取消保留两轮证据，不落盘迟到纠正结果',async()=>{
 const f=fixture(),target=await oneEpisode(f),before=structuredClone(f.d.story);let calls=0,finish,notify;const ready=new Promise(resolve=>notify=resolve);f.studio.providers.text=async()=>{if(++calls===1)return {text:JSON.stringify({assets:[],bindings:[{shotId:target.shotId,assetKeys:[]}]})};notify();return new Promise(resolve=>finish=resolve);};
 const pending=f.studio.extractAssets({id:'draft'});await ready;const run=f.store.data.runs[0];f.studio.runtime.cancel(run.id);finish({text:JSON.stringify({assets:[{key:'new_person',kind:'character',name:'小明',description:'花园中的人',prompt:'A person'}],bindings:[{shotId:target.shotId,assetKeys:['new_person']}]})});
 await assert.rejects(pending,/abort|取消/i);assert.equal(calls,2);assert.equal(run.status,'cancelled');assert.deepEqual(f.d.story,before);assert.equal(run.failureOutput.assetExtraction.attempts.length,2);assert.match(run.failureOutput.assetExtraction.attempts[1].modelResult.text,/new_person/);
});
test('镜头图片传递全部确认资产引用，重新生成不自动替换选择，支持导入图片',async()=>{const f=fixture(),target=await oneEpisode(f),s=structuredClone(f.d.story);s.assets=[{id:'char',kind:'character',name:'小明',description:'一人',prompt:'青年',images:[],selectedImageId:''},{id:'scene',kind:'scene',name:'花园',description:'院落',prompt:'绿植',images:[],selectedImageId:''}];s.episodes[0].shots[0].assetIds=['char','scene'];await f.studio.save({id:'draft',story:s,revision:s.revision});await assert.rejects(f.studio.generateImage({id:'draft',...target}),/确认镜头引用资产/);
 for(const assetId of ['char','scene']){const r=await f.studio.generateImage({id:'draft',assetId});assert.equal(f.d.story.assets.find(a=>a.id===assetId).selectedImageId,'');await f.studio.selectImage({id:'draft',assetId,imageId:r.material.id});}
 const r=await f.studio.generateImage({id:'draft',...target});assert.equal(f.calls.at(-1).input.references.length,2);await f.studio.selectImage({id:'draft',...target,imageId:r.material.id});await f.studio.generateImage({id:'draft',...target,instruction:'光线柔和'});assert.equal(f.d.story.episodes[0].shots[0].selectedImageId,r.material.id);f.assets.set('imported',{id:'imported',type:'image'});await f.studio.selectImage({id:'draft',...target,imageId:'imported'});assert.equal(f.d.story.episodes[0].shots[0].selectedImageId,'imported');
});
test('共享资产修改仅使引用镜头失效并保留候选历史，镜头重排ID不变',async()=>{const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);let s=structuredClone(f.d.story);s.assets=[{id:'char',kind:'character',name:'小明',description:'青年',prompt:'青年',images:[],selectedImageId:''}];const first=s.episodes[0].shots[0];const second=structuredClone(first);second.id='second';second.assetIds=[];s.episodes[0].shots.push(second);first.assetIds=['char'];await f.studio.save({id:'draft',story:s,revision:s.revision});
 await imageAndVideo(f,{episodeId:target.episodeId,shotId:'second'});const untouched=f.d.story.episodes[0].shots[1].selectedVideoId;assert(untouched);s=structuredClone(f.d.story);s.assets[0].description='中年';s.episodes[0].shots.reverse();await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.story.episodes[0].shots[0].id,'second');assert.equal(f.d.story.episodes[0].shots[0].selectedVideoId,untouched);assert.equal(f.d.story.episodes[0].shots[1].selectedVideoId,'');assert(f.d.story.episodes[0].shots[1].videos.length);assert.equal(f.d.story.episodes[0].shots[1].videos[0].status,'stale');
});
test('异步图片迟到存为过期候选，不能覆盖修改或被选用',async()=>{const f=fixture(),target=await oneEpisode(f);let finish;f.generator.image=()=>new Promise(r=>finish=r);const pending=f.studio.generateImage({id:'draft',...target});await new Promise(r=>setImmediate(r));const s=structuredClone(f.d.story);s.episodes[0].shots[0].visual='用户新编辑';await f.studio.save({id:'draft',story:s,revision:s.revision});f.assets.set('late',{id:'late',type:'image'});finish(f.assets.get('late'));const r=await pending;assert(r.stale);assert.equal(f.d.story.episodes[0].shots[0].visual,'用户新编辑');assert.equal(f.d.story.episodes[0].shots[0].images[0].status,'stale');await assert.rejects(f.studio.selectImage({id:'draft',...target,imageId:'late'}),/过期/);});
test('模型异步文本返回不能覆盖用户当前分集编辑',async()=>{const f=fixture();const start=createStory(f.d);start.episodeCount=2;await f.studio.save({id:'draft',story:start,revision:0});let finish;f.studio.providers.text=()=>new Promise(r=>finish=r);const pending=f.studio.splitEpisodes({id:'draft'});await new Promise(r=>setImmediate(r));let s=f.studio.story('draft');s.episodes=[{id:'manual',title:'人工分集',text:s.sourceText,shots:[],resultId:''}];await f.studio.save({id:'draft',story:s,revision:s.revision});finish({text:JSON.stringify({episodes:[{title:'模型一',endUnit:1},{title:'模型二',endUnit:2}]})});const r=await pending;assert(r.stale);assert.equal(f.d.story.episodes[0].id,'manual');});
test('上游文案变化阻止旧分镜生成，独立稿模式可保存后重新拆分',async()=>{const f=fixture(),target=await oneEpisode(f);f.d.finalText='修改后的上游';await assert.rejects(f.studio.generateImage({id:'draft',...target}),/上游文案已变化/);let s=structuredClone(f.d.story);s.sourceMode='custom';s.sourceText='独立剧本';await f.studio.save({id:'draft',story:s,revision:s.revision});await assert.rejects(f.studio.generateImage({id:'draft',...target}),/重新拆集/);await f.studio.splitEpisodes({id:'draft'});assert.equal(f.d.story.sourceKind,'custom');});

test('保存和同步剧本时重新建立画像，不复用草稿或客户端旧画像',async()=>{
 const f=fixture(),{detectContentProfile}=await import('../server/content-types.mjs');
 f.d.contentProfile=detectContentProfile({sourceKind:'product-page',text:'商品详情'});f.d.tab='product';
 const s=createStory(f.d);s.sourceMode='custom';s.sourceText='科普光的原理与知识。';s.contentProfile=structuredClone(f.d.contentProfile);
 await f.studio.save({id:'draft',story:s,revision:0});assert.equal(f.d.story.contentProfile.type,'knowledge');assert.equal(f.d.story.contentProfile.sourceKind,'text');
 const next=structuredClone(f.d.story);next.sourceText='故事剧情中的角色对白。';await f.studio.save({id:'draft',story:next,revision:next.revision});assert.equal(f.d.story.contentProfile.type,'story-drama');
 next.sourceMode='upstream';f.d.finalText='安装教程的设置步骤。';await f.studio.save({id:'draft',story:next,revision:f.d.story.revision});assert.equal(f.d.story.contentProfile.type,'tutorial');
});

test('已选镜头的预设变化后禁止合成或交接旧画像生成的视频',async()=>{
 const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});
 f.d.creativePreset={mode:'manual',presetId:'review',instruction:''};const calls=f.calls.length;
 await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:target.episodeId}),/已过期/);
 await assert.rejects(f.studio.useEpisode({id:'draft',episodeId:target.episodeId}),/已过期/);assert.equal(f.calls.length,calls);
});
test('当前集严格选用视频合成并交接剪辑，字幕历史归原视频且不改声音配置',async()=>{const f=fixture(),target=await oneEpisode(f);await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:target.episodeId}),/未确认/);await imageAndVideo(f,target);const result=await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});const call=f.calls.at(-1);assert.equal(call.kind,'compose');assert.equal(call.input.shots.length,1);assert.equal(call.input.shots[0].duration,4);assert.equal(call.input.narration,null);await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});assert.equal(f.d.video.assetId,result.material.id);assert.equal(f.d.edit.sourceId,result.material.id);assert.equal(f.d.step,4);assert.equal(f.d.voice.audioId,'narration');assert.equal(f.d.edit.captions.length,0);assert.equal(f.d.artifacts.captionHistory[0].sourceId,'old');});
test('单集可绑定上游旁白，多集不能静默切整条声音',async()=>{const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);let s=structuredClone(f.d.story);s.narrationMode='upstream';await f.studio.save({id:'draft',story:s,revision:s.revision});await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});assert.equal(f.calls.at(-1).input.narration.assetId,'narration');s=structuredClone(f.d.story);s.episodes.push({id:'episode-two',title:'第二集',text:'二',shots:[],resultId:''});await f.studio.save({id:'draft',story:s,revision:s.revision});await assert.rejects(f.studio.composeEpisode({id:'draft',episodeId:target.episodeId}),/逐集选择音频/);});

test('图片失败和运行取消保留上一选择，取消后不登记迟到候选',async()=>{const f=fixture(),target=await oneEpisode(f);const first=await f.studio.generateImage({id:'draft',...target});await f.studio.selectImage({id:'draft',...target,imageId:first.material.id});f.generator.image=async()=>{throw Error('明确模型失败');};await assert.rejects(f.studio.generateImage({id:'draft',...target}),/明确模型失败/);assert.equal(f.d.story.episodes[0].shots[0].selectedImageId,first.material.id);let finish;f.generator.image=()=>new Promise(r=>finish=r);const pending=f.studio.generateImage({id:'draft',...target});await new Promise(r=>setImmediate(r));const run=f.store.data.runs[0];f.studio.runtime.cancel(run.id);finish({id:'cancelled-output',type:'image'});await assert.rejects(pending,/abort|取消/i);assert.equal(run.status,'cancelled');assert.equal(f.d.story.episodes[0].shots[0].images.length,1);});
test('镜头参考时长小于H3最低秒数时在提交前拒绝',async()=>{const f=fixture(),target=await oneEpisode(f);const s=structuredClone(f.d.story);s.episodeDuration=3;await f.studio.save({id:'draft',story:s,revision:s.revision});await f.studio.splitEpisodes({id:'draft'});const episode=f.d.story.episodes[0],count=f.calls.length;await assert.rejects(f.studio.splitShots({id:'draft',episodeId:episode.id}),/至少需要4秒/);assert.equal(f.calls.length,count);assert.deepEqual(f.d.story.episodes[0].shots,[]);});

test('远程结果未知时阻止同目标重交，只查询原任务并保留人工确认',async()=>{const f=fixture(),target=await oneEpisode(f);f.generator.image=async()=>{const error=Error('远程结果尚未确认');error.unknown=true;throw error;};await assert.rejects(f.studio.generateImage({id:'draft',...target}),/尚未确认/);const run=f.store.data.runs[0];assert.equal(run.status,'unknown');await assert.rejects(f.studio.generateImage({id:'draft',...target}),/不能直接重交/);let recovered;f.generator.recover=async original=>{recovered=original.id;const asset={id:'recovered-image',type:'image'};f.assets.set(asset.id,asset);return asset;};const result=await f.studio.recover({runId:run.id});assert.equal(recovered,run.id);assert.equal(result.status,'succeeded');assert.equal(result.stale,false);assert.equal(f.d.story.episodes[0].shots[0].images[0].recoveredFrom,run.id);assert.equal(f.d.story.episodes[0].shots[0].selectedImageId,'');assert.equal(run.status,'succeeded');});

test('修改已交接当前集镜头会清理旧成片引用，其他集不误清',async()=>{const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});const before=f.d.video.assetId;assert(before);let s=structuredClone(f.d.story);s.episodes.push({id:'other-episode',title:'其他集',text:'其他',shots:[],resultId:''});await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.video.assetId,before);s=structuredClone(f.d.story);s.episodes[0].shots[0].action='新的动作';await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.video.assetId,'');assert.equal(f.d.edit.sourceId,'');assert.equal(f.d.story.episodes[0].resultId,'');});

test('发布或自动流程执行中拒绝专用保存、选择、切集与新模型提交',async()=>{
 for(const lock of [{kind:'publish',status:'running'},{kind:'publish',status:'queued'},{kind:'workflow',status:'queued'},{kind:'workflow',status:'running'},{kind:'workflow',status:'stopping'}]){
  const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});const before=structuredClone(f.d),count=f.calls.length;
  if(lock.kind==='publish')f.store.data.runs.unshift({id:'publish-lock',draftId:'draft',type:'publish',status:lock.status});else f.store.data.workflowJobs=[{id:'workflow-lock',draftId:'draft',status:lock.status}];
  for(const action of [()=>f.studio.save({id:'draft',story:structuredClone(f.d.story),revision:f.d.story.revision}),()=>f.studio.splitEpisodes({id:'draft'}),()=>f.studio.splitShots({id:'draft',episodeId:target.episodeId}),()=>f.studio.extractAssets({id:'draft'}),()=>f.studio.generateImage({id:'draft',...target}),()=>f.studio.generateVideo({id:'draft',...target}),()=>f.studio.composeEpisode({id:'draft',episodeId:target.episodeId}),()=>f.studio.useEpisode({id:'draft',episodeId:target.episodeId}),()=>f.studio.selectImage({id:'draft',...target,imageId:f.d.story.episodes[0].shots[0].selectedImageId}),()=>f.studio.selectVideo({id:'draft',...target,videoId:f.d.story.episodes[0].shots[0].selectedVideoId})])await assert.rejects(action(),/正在执行/);
  assert.deepEqual(f.d,before);assert.equal(f.calls.length,count);
 }
});
test('执行中新增锁时，迟到文本保留rawText且不写入story',async()=>{const f=fixture();const start=createStory(f.d);start.episodeCount=2;await f.studio.save({id:'draft',story:start,revision:0});let finish;f.studio.providers.text=()=>new Promise(r=>finish=r);const pending=f.studio.splitEpisodes({id:'draft'});await new Promise(r=>setImmediate(r));const before=structuredClone(f.d);f.store.data.workflowJobs=[{id:'new-job',draftId:'draft',status:'running'}];const text=JSON.stringify({episodes:[{title:'第一集',endUnit:1},{title:'第二集',endUnit:2}]});finish({text});await assert.rejects(pending,/自动流程正在执行/);assert.deepEqual(f.d,before);assert.equal(f.store.data.runs[0].failureOutput.rawText,text);});
test('迟到图片、视频和合成遇新锁时保留素材与输入证据，不附着或丢弃产物',async()=>{
 for(const kind of ['image','video','compose']){const f=fixture(),target=await oneEpisode(f);if(kind==='video'){const image=await f.studio.generateImage({id:'draft',...target});await f.studio.selectImage({id:'draft',...target,imageId:image.material.id});}else if(kind==='compose')await imageAndVideo(f,target);
  let finish;f.generator[kind]=(input,ctx)=>{ctx.remote('known-completed-'+kind,{kind:'story-comfy-v1',submissionState:'submitted'});return new Promise(r=>finish=r);};const operation=kind==='image'?f.studio.generateImage({id:'draft',...target}):kind==='video'?f.studio.generateVideo({id:'draft',...target}):f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});await new Promise(r=>setImmediate(r));const before=structuredClone(f.d);f.store.data.runs.unshift({id:'new-publish',draftId:'draft',type:'publish',status:'running'});const material={id:'late-'+kind,type:kind==='image'?'image':'video',duration:4};f.assets.set(material.id,material);finish(material);await assert.rejects(operation,/发布正在执行/);assert.deepEqual(f.d,before);assert.equal(f.assets.get(material.id),material);const run=f.store.data.runs.find(r=>r.type==='story-'+kind);assert.equal(run.status,'failed');assert.equal(run.remoteId,'known-completed-'+kind);assert.equal(run.failureOutput.material.id,material.id);assert.equal(run.failureOutput.deferred,true);assert.equal(run.failureOutput.storyAttached,false);assert(run.failureOutput.input);assert(run.failureOutput.candidate);}
});
test('当前集失效同时清旧封面视频ID，已结束发布或unknown不扩大Store锁状态',async()=>{const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});f.d.cover.videoId='old-cover-video';f.store.data.runs.push({id:'historical-publish',draftId:'draft',type:'publish',status:'succeeded'});const s=structuredClone(f.d.story);s.episodes[0].shots[0].action='变更动作';await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.cover.videoId,'');f.store.data.runs.push({id:'unknown-publish',draftId:'draft',type:'publish',status:'unknown'});f.store.data.workflowJobs=[{id:'old-job',draftId:'draft',status:'failed'}];assert.doesNotThrow(()=>f.studio.assertMutable('draft'));});

test('切无旁白保留所选音频但不混音，无旁白下更换未启用音频不误清已合成结果',async()=>{const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);let s=structuredClone(f.d.story);s.narrationMode='upstream';s.episodes[0].narrationAssetId='narration';await f.studio.save({id:'draft',story:s,revision:s.revision});await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});assert.equal(f.calls.at(-1).input.narration.assetId,'narration');s=structuredClone(f.d.story);s.narrationMode='none';await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.story.episodes[0].resultId,'');assert.equal(f.d.story.episodes[0].narrationAssetId,'narration');await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});assert.equal(f.calls.at(-1).input.narration,null);assert.equal(f.d.story.episodes[0].resultNarrationAssetId,'');await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});assert.equal(require('../server/story-source.mjs').activeStoryEpisode(f.d).id,target.episodeId);const result=f.d.story.episodes[0].resultId;s=structuredClone(f.d.story);s.episodes[0].narrationAssetId='inactive-selection';await f.studio.save({id:'draft',story:s,revision:s.revision});assert.equal(f.d.story.episodes[0].resultId,result);assert.equal(f.d.video.assetId,result);assert.equal(require('../server/story-source.mjs').activeStoryEpisode(f.d).id,target.episodeId);});

async function batchFixture(count=3){const f=fixture(),target=await oneEpisode(f),s=structuredClone(f.d.story);s.assets=Array.from({length:count},(_,index)=>({id:'asset-'+index,kind:'prop',name:'道具'+index,description:'独立道具'+index,prompt:'A unique prop '+index,images:[],selectedImageId:''}));await f.studio.save({id:'draft',story:s,revision:s.revision});return {...f,...target,assetIds:s.assets.map(asset=>asset.id)};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('单镜头与勾选镜头提取只提交目标范围，保留共享资产及未选镜头候选',async()=>{
 const f=await batchFixture(),s=structuredClone(f.d.story),first=s.episodes[0].shots[0];first.assetIds=[f.assetIds[0]];
 for(const id of ['shot-two','shot-three'])s.episodes[0].shots.push({...structuredClone(first),id});await f.studio.save({id:'draft',story:s,revision:s.revision});
 const shared=await f.studio.generateImage({id:'draft',assetId:f.assetIds[0]});await f.studio.selectImage({id:'draft',assetId:f.assetIds[0],imageId:shared.material.id});await imageAndVideo(f,{episodeId:f.episodeId,shotId:'shot-three'});
 const untouched=structuredClone(f.d.story.episodes[0].shots[2]),sharedBefore=structuredClone(f.d.story.assets[0]);
 const response=ids=>({assets:[{key:f.assetIds[1],kind:'prop',name:'道具1',description:'不会改写旧值',prompt:'Unused rewrite'}],bindings:ids.map(shotId=>({shotId,assetKeys:[f.assetIds[1]]}))});
 f.responses.push(response([f.shotId]));await f.studio.extractAssets({id:'draft',shotId:f.shotId});let model=JSON.parse(f.calls.at(-1).user.split('输入资料：')[1]);assert.deepEqual(model.shots.map(shot=>shot.id),[f.shotId]);assert.deepEqual(f.d.story.episodes[0].shots[0].assetIds,[f.assetIds[1]]);assert.deepEqual(f.d.story.episodes[0].shots[2],untouched);assert.deepEqual(f.d.story.assets[0],sharedBefore);
 f.responses.push(response([f.shotId,'shot-two']));await f.studio.extractAssets({id:'draft',episodeId:f.episodeId,shotIds:[f.shotId,'shot-two']});model=JSON.parse(f.calls.at(-1).user.split('输入资料：')[1]);assert.deepEqual(model.shots.map(shot=>shot.id),[f.shotId,'shot-two']);assert.deepEqual(f.d.story.episodes[0].shots[2],untouched);assert.deepEqual(f.d.story.assets[0],sharedBefore);
});

test('显式提取范围拒绝空、重复、未知、跨集或相互冲突ID，模型前失败',async()=>{
 const f=await batchFixture(),s=structuredClone(f.d.story);s.episodes.push({...structuredClone(s.episodes[0]),id:'other-episode',shots:[{...structuredClone(s.episodes[0].shots[0]),id:'other-shot'}]});await f.studio.save({id:'draft',story:s,revision:s.revision});const runs=f.store.data.runs.length,calls=f.calls.length;
 for(const scope of [{shotId:''},{shotIds:[]},{shotIds:[f.shotId,f.shotId]},{shotIds:['missing']},{shotIds:[f.shotId,'other-shot']},{episodeId:f.episodeId,shotId:'other-shot'},{shotId:f.shotId,shotIds:[f.shotId]},{episodeId:'missing'}])await assert.rejects(f.studio.extractAssets({id:'draft',...scope}),/镜头|分集|范围/);
 assert.equal(f.store.data.runs.length,runs);assert.equal(f.calls.length,calls);
});

test('提取期间选中镜头被删除时返回过期结果，不落入其他镜头绑定',async()=>{
 const f=await batchFixture();let finish;f.studio.providers.text=()=>new Promise(resolve=>finish=resolve);const pending=f.studio.extractAssets({id:'draft',shotIds:[f.shotId]});await tick();const input=f.store.data.runs[0].parameters.input;assert.deepEqual(input.scope.shotIds,[f.shotId]);
 const s=structuredClone(f.d.story);s.episodes[0].shots[0].id='replacement';await f.studio.save({id:'draft',story:s,revision:s.revision});finish({text:JSON.stringify({assets:[{key:'new-prop',kind:'prop',name:'新道具',description:'新道具',prompt:'A new prop'}],bindings:[{shotId:f.shotId,assetKeys:['new-prop']}]})});const result=await pending;assert.equal(result.stale,true);assert.equal(f.d.story.assets.length,3);assert.deepEqual(f.d.story.episodes[0].shots[0].assetIds,[]);
});

test('批量生图完整预检全部资产和要求，不创建半个任务或提前生成',async()=>{
 const f=await batchFixture(),runs=f.store.data.runs.length,calls=f.calls.length;
 for(const args of [{assetIds:[]},{assetIds:Array(101).fill(f.assetIds[0])},{assetIds:[f.assetIds[0],f.assetIds[0]]},{assetIds:[f.assetIds[0],'missing']},{assetIds:[f.assetIds[0]],instructions:[]},{assetIds:[f.assetIds[0]],instructions:{missing:'新要求'}},{assetIds:[f.assetIds[0]],instructions:{[f.assetIds[0]]:42}}])await assert.rejects(f.studio.generateAssetImages({id:'draft',...args}),/资产|要求/);
 const s=structuredClone(f.d.story);s.assets[1].prompt='';s.assets[1].description='';await f.studio.save({id:'draft',story:s,revision:s.revision});await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/图片提示词/);assert.equal(f.store.data.runs.length,runs);assert.equal(f.calls.length,calls);
});

test('批量生图一个Runtime串行执行、逐项持久化并保留人工选用',async()=>{
 const f=await batchFixture(),generated=[],snapshots=[];let finish;const original=f.generator.image;f.generator.image=(input,ctx)=>{generated.push(input.target.assetId);return new Promise(resolve=>finish=async()=>resolve(await original(input,ctx)));};f.store.save=()=>snapshots.push(structuredClone(f.store.data.runs));
 const pending=f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds,instructions:{[f.assetIds[1]]:'柔和自然光'}});await tick();const run=f.store.data.runs[0];assert.equal(run.type,'story-image');assert.equal(run.parameters.itemIndex,0);assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['running','queued','queued']);
 for(let index=0;index<3;index++){assert.equal(generated.length,index+1);await finish();await tick();}
 const result=await pending;assert.deepEqual(generated,f.assetIds);assert.equal(f.store.data.runs.filter(run=>run.type==='story-image').length,1);assert.equal(run.status,'succeeded');assert.equal(result.counts.succeeded,3);assert.deepEqual(result.items.map(item=>item.status),['succeeded','succeeded','succeeded']);assert.equal(result.items[1].input.instruction,'柔和自然光');assert.equal(run.parameters.input.target.assetId,f.assetIds[2]);assert.equal(run.remoteId,'');assert.equal(run.remote,undefined);assert(f.d.story.assets.every(asset=>asset.images.length===1&&!asset.selectedImageId));assert(snapshots.some(runs=>runs[0]?.parameters.batchItems?.map(item=>item.status).join(',')==='succeeded,running,queued'));
});

test('批量普通失败继续后项，已确认失败和成功的远程凭据不会串到下一项',async()=>{
 const f=await batchFixture(),original=f.generator.image,seen=[];f.generator.image=async(input,ctx)=>{const run=f.store.data.runs[0];seen.push({assetId:input.target.assetId,remoteId:run.remoteId,remote:run.remote});ctx.remote('remote-'+input.target.assetId,{kind:'story-comfy-image-v1',input,submissionState:'accepted'});if(input.target.assetId===f.assetIds[1]){const error=Error('模型确认本次失败');error.remoteConfirmed=true;throw error;}return original(input,ctx);};const result=await f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds});assert.deepEqual(result.items.map(item=>item.status),['succeeded','failed','succeeded']);assert.equal(result.counts.failed,1);assert.equal(result.counts.succeeded,2);assert(seen.every(item=>item.remoteId===''&&item.remote===undefined));assert.equal(result.items[1].remoteId,'remote-'+f.assetIds[1]);assert.equal(f.store.data.runs[0].status,'succeeded');
});

test('公共环境失败只尝试首项，剩余资产标记未提交而非重复失败',async()=>{
 const f=await batchFixture();let calls=0;f.generator.image=async()=>{calls++;throw Object.assign(Error('ComfyUI 环境不可用'),{stopBatch:true,environmentFailure:true});};
 await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/环境不可用/);
 const run=f.store.data.runs[0];assert.equal(calls,1);assert.equal(run.status,'failed');assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['failed','skipped','skipped']);assert(run.parameters.batchItems.slice(1).every(item=>/公共模型环境不可用/.test(item.error)));assert(!run.remoteId);assert(f.d.story.assets.every(asset=>asset.images.length===0));
});

test('批量unknown停止后项，锁住当前目标，原凭据恢复只附着对应资产',async()=>{
 const f=await batchFixture(),original=f.generator.image,generated=[];f.generator.image=async(input,ctx)=>{generated.push(input.target.assetId);ctx.remote('remote-'+input.target.assetId,{kind:'story-comfy-image-v1',input,clientId:'client-'+input.target.assetId,submissionState:'accepted'});if(input.target.assetId===f.assetIds[1])throw Object.assign(Error('结果尚未确认'),{unknown:true});return original(input,ctx);};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/尚未确认/);const run=f.store.data.runs[0];assert.equal(run.status,'unknown');assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['succeeded','unknown','skipped']);assert.deepEqual(generated,f.assetIds.slice(0,2));assert.equal(run.parameters.input.target.assetId,f.assetIds[1]);assert.deepEqual(run.remote.input,run.parameters.input);assert.equal(run.remoteId,'remote-'+f.assetIds[1]);assert.equal(f.d.story.assets[0].images.length,1);
 await assert.rejects(f.studio.generateImage({id:'draft',assetId:f.assetIds[1]}),/不能直接重交/);await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:[f.assetIds[1]]}),/不能直接重交/);let recovered;f.generator.recover=async originalRun=>{recovered=originalRun;return {id:'recovered-batch-image',type:'image'};};const result=await f.studio.recover({runId:run.id});assert.equal(recovered.id,run.id);assert.equal(recovered.remote.input.target.assetId,f.assetIds[1]);assert.deepEqual(result.items.map(item=>item.status),['succeeded','succeeded','skipped']);assert.equal(result.counts.skipped,1);assert.equal(run.output.counts.succeeded,2);assert.equal(f.d.story.assets[1].images[0].id,'recovered-batch-image');assert.equal(f.d.story.assets[1].selectedImageId,'');assert.equal(f.d.story.assets[2].images.length,0);assert.equal(generated.length,2);
});

test('批量恢复前校验原目标和remote输入，错配时不查询不附着',async()=>{
 const f=await batchFixture();f.generator.image=async(input,ctx)=>{ctx.remote('retained-id',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});throw Object.assign(Error('未知'),{unknown:true});};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/未知/);const run=f.store.data.runs[0];run.remote.input.target.assetId=f.assetIds[2];let called=false;f.generator.recover=async()=>{called=true;return {id:'wrong',type:'image'};};await assert.rejects(f.studio.recover({runId:run.id}),/不一致/);assert.equal(called,false);assert(f.d.story.assets.every(asset=>asset.images.length===0));assert.equal(run.status,'unknown');
});

test('确认原任务丢失解除批量锁，当前项失败且后续未提交项保持跳过',async()=>{
 const f=await batchFixture(3),s=f.d.story,input=f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[1]});
 const run={id:'lost-batch',draftId:'draft',type:'story-image',status:'unknown',parameters:{batchId:'lost',batchAssetIds:f.assetIds,itemIndex:1,input,batchItems:[
  {assetId:f.assetIds[0],status:'succeeded',input:f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[0]})},
  {assetId:f.assetIds[1],status:'unknown',input},
  {assetId:f.assetIds[2],status:'skipped',input:f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[2]}),error:'前项结果待确认，未继续提交'}
 ]},remoteId:'missing-id',remote:{kind:'story-comfy-image-v1',baseUrl:'http://127.0.0.1:8188',input,submissionState:'accepted'}};
 f.store.data.runs.unshift(run);let called=0;f.generator.confirmLost=async original=>{called++;assert.equal(original.id,run.id);return {status:'lost'};};
 const result=await f.studio.confirmLost({runId:run.id});
 assert.equal(called,1);assert.equal(run.status,'failed');assert.equal(run.terminalConfirmed,true);assert.equal(run.lostConfirmed,true);assert.equal(run.parameters.batchItems[1].status,'failed');assert.equal(run.parameters.batchItems[2].status,'skipped');assert.equal(result.status,'lost');
 assert.equal(f.store.data.runs.filter(item=>item.id===run.id).length,1);
});

test('原任务未确认丢失时不解除批量锁',async()=>{
 const f=await batchFixture(2),s=f.d.story,input=f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[0]}),run={id:'still-there',draftId:'draft',type:'story-image',status:'unknown',parameters:{itemIndex:0,input,batchItems:[{assetId:f.assetIds[0],status:'unknown',input},{assetId:f.assetIds[1],status:'skipped',input:f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[1]})}]},remoteId:'queued-id',remote:{kind:'story-comfy-image-v1',baseUrl:'http://127.0.0.1:8188',input,submissionState:'accepted'}};
 f.store.data.runs.unshift(run);f.generator.confirmLost=async()=>{throw Error('原任务仍在本地队列中，请先查询原任务结果');};
 await assert.rejects(f.studio.confirmLost({runId:run.id}),/仍在本地队列/);assert.equal(run.status,'unknown');assert.equal(run.parameters.batchItems[0].status,'unknown');
});

test('批量取消分别处理未提交与已提交目标，保留此前成功且不附着迟到候选',async()=>{
 for(const submitted of [false,true]){const f=await batchFixture(),original=f.generator.image;let finish;const seen=[];f.generator.image=async(input,ctx)=>{seen.push(input.target.assetId);if(seen.length===1){ctx.remote('previous-id',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});return original(input,ctx);}if(submitted)ctx.remote('active-id',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});return new Promise(resolve=>finish=()=>resolve({id:'too-late',type:'image'}));};const pending=f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds});await tick();const run=f.store.data.runs[0];f.studio.runtime.cancel(run.id);finish();await assert.rejects(pending,/abort|取消/i);assert.equal(run.status,submitted?'unknown':'cancelled');assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['succeeded',submitted?'unknown':'skipped','skipped']);assert.equal(run.remoteId,submitted?'active-id':'');assert.equal(run.remote?.input?.target?.assetId,submitted?f.assetIds[1]:undefined);assert.equal(f.d.story.assets[0].images.length,1);assert.equal(f.d.story.assets[1].images.length,0);assert.equal(seen.length,2);}
});

test('批量与单张共享锁，排队的未执行资产不能被并发重复提交',async()=>{
 const f=await batchFixture();let finish;f.generator.image=()=>new Promise(resolve=>finish=resolve);const pending=f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds});await tick();await assert.rejects(f.studio.generateImage({id:'draft',assetId:f.assetIds[2]}),/不能直接重交|正在执行/);await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:[f.assetIds[2]]}),/不能直接重交|正在执行/);f.studio.runtime.cancel(f.store.data.runs[0].id);finish({id:'late',type:'image'});await assert.rejects(pending,/abort|取消/i);
});

test('批量单项候选保存失败中止整批，不继续提交且保留已生成素材证据',async()=>{
 const f=await batchFixture();let calls=0,failed=false;const original=f.generator.image;f.generator.image=async(...args)=>{calls++;return original(...args);};f.store.save=()=>{if(!failed&&f.d.story.assets[0].images.length){failed=true;throw Error('候选落盘失败');}};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/落盘失败/);const run=f.store.data.runs[0];assert.equal(calls,1);assert.equal(run.status,'failed');assert.deepEqual(run.parameters.batchItems.map(item=>item.status),['failed','skipped','skipped']);assert.equal(f.d.story.assets[0].images.length,0);assert.equal(run.failureOutput.material.id,'image-1');assert.equal(run.failureOutput.storyAttached,false);assert(f.assets.has('image-1'));
});

test('批量ctx进度落盘失败时立即停止，未提交后项',async()=>{
 const f=await batchFixture();let fail=false,calls=0;f.store.save=()=>{if(fail){fail=false;throw Error('进度记录保存失败');}};f.generator.image=async(input,ctx)=>{calls++;fail=true;ctx.progress(10,'进度');return {id:'never',type:'image'};};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/保存失败/);assert.equal(calls,1);assert.deepEqual(f.store.data.runs[0].parameters.batchItems.map(item=>item.status),['failed','skipped','skipped']);
});

test('批量排队期间编辑资产将返回过期候选，原用户要求与选择不被覆盖',async()=>{
 const f=await batchFixture(1);let finish;f.generator.image=()=>new Promise(resolve=>finish=resolve);const pending=f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds});await tick();const s=structuredClone(f.d.story);s.assets[0].prompt='用户最新外观';await f.studio.save({id:'draft',story:s,revision:s.revision});finish({id:'old-snapshot',type:'image'});const result=await pending;assert.equal(result.counts.stale,1);assert.equal(result.items[0].candidate.status,'stale');assert.equal(f.d.story.assets[0].prompt,'用户最新外观');assert.equal(f.d.story.assets[0].selectedImageId,'');
});

test('重启把当前活动项规范成unknown并跳过余项，原参数可直接恢复',async()=>{
 const f=await batchFixture(),s=f.d.story,input=f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[1]}),run={id:'crashed-batch',draftId:'draft',type:'story-image',status:'running',parameters:{batchId:'crashed',batchAssetIds:f.assetIds,itemIndex:1,input,batchItems:[{assetId:f.assetIds[0],status:'succeeded',input:f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[0]})},{assetId:f.assetIds[1],status:'running',input},{assetId:f.assetIds[2],status:'queued',input:f.studio.imagePlan(s,{id:'draft',assetId:f.assetIds[2]})}]},remoteId:'remote-before-exit',remote:{kind:'story-comfy-image-v1',input,submissionState:'accepted'}};f.store.data.runs.unshift(run);
 require('../server/store.cjs').Store.prototype.recover.call(f.store);assert.equal(run.status,'unknown');let queries=0;f.generator.recover=async original=>{queries++;assert.equal(original.remoteId,'remote-before-exit');assert.equal(original.parameters.input.target.assetId,f.assetIds[1]);return {id:'found-after-restart',type:'image'};};const result=await f.studio.recover({runId:run.id});assert.equal(queries,1);assert.deepEqual(result.items.map(item=>item.status),['succeeded','succeeded','skipped']);assert.equal(f.d.story.assets[1].images.length,1);
 const interrupted={id:'not-submitted',draftId:'draft',type:'story-image',status:'interrupted',parameters:{itemIndex:0,batchItems:[{assetId:'x',status:'running'},{assetId:'y',status:'queued'}]}};f.store.data.runs.push(interrupted);f.studio.normalizeBatchRuns('draft');assert.deepEqual(interrupted.parameters.batchItems.map(item=>item.status),['skipped','skipped']);
});

test('真实service批量动作映射及模型互斥锁生效，未调用模型和用户数据',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'story-batch-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const service=require('../server/service.cjs').createService(root);let received;service.stories.generateAssetImages=async args=>{received=args;return {story:{},items:[],counts:{total:0}};};const input={id:service.store.draft().id,assetIds:['one','two'],instructions:{one:'自然光'}};
 assert.equal((await service.invoke('generateStoryAssetImages',input)).counts.total,0);assert.deepEqual(received,input);
 for(const type of ['avatar-optimize','avatar-background','voice-design']){service.store.data.runs.push({id:type,draftId:input.id,type,status:'running'});await assert.rejects(service.invoke('generateStoryAssetImages',input),/正在|生成/);service.store.data.runs.pop();}
 service.store.data.workflowJobs=[{id:'workflow',draftId:input.id,status:'running'}];await assert.rejects(service.invoke('generateStoryAssetImages',input),/自动流程/);
});

test('恢复确认原目标失败或取消后解除unknown，只更新该项且不续发',async()=>{
 for(const status of ['failed','cancelled']){const f=await batchFixture();let submissions=0;f.generator.image=async(input,ctx)=>{submissions++;ctx.remote('only-original',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});throw Object.assign(Error('结果待确认'),{unknown:true});};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/待确认/);const run=f.store.data.runs[0];f.generator.recover=async()=>{throw Object.assign(Error('服务端确认'+status),{remoteConfirmed:true,remoteStatus:status});};await assert.rejects(f.studio.recover({runId:run.id}),/服务端确认/);assert.equal(run.status,status);assert.equal(run.terminalConfirmed,true);assert.deepEqual(run.parameters.batchItems.map(item=>item.status),[status,'skipped','skipped']);assert.equal(run.output.counts[status],1);assert.equal(run.remoteId,'only-original');assert.equal(submissions,1);assert.doesNotThrow(()=>f.studio.imagePending('draft',{kind:'asset',assetId:f.assetIds[0]}));assert(f.d.story.assets.every(asset=>asset.images.length===0));}
});

test('查询连接失败或结果仍未知不改变原unknown目标，不解除防重',async()=>{
 for(const details of [{},{unknown:true},{remoteConfirmed:true,unknown:true}]){const f=await batchFixture();f.generator.image=async(input,ctx)=>{ctx.remote('keep-original',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});throw Object.assign(Error('结果待确认'),{unknown:true});};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/待确认/);const run=f.store.data.runs[0],before=structuredClone(run);f.generator.recover=async()=>{throw Object.assign(Error('查询连接失败'),details);};await assert.rejects(f.studio.recover({runId:run.id}),/连接失败/);assert.deepEqual(run,before);await assert.rejects(f.studio.generateImage({id:'draft',assetId:f.assetIds[0]}),/不能直接重交/);}
});

test('恢复终态落盘失败回滚原unknown记录，不能在未保存时解除防重',async()=>{
 const f=await batchFixture();f.generator.image=async(input,ctx)=>{ctx.remote('keep-original',{kind:'story-comfy-image-v1',input,submissionState:'accepted'});throw Object.assign(Error('待确认'),{unknown:true});};await assert.rejects(f.studio.generateAssetImages({id:'draft',assetIds:f.assetIds}),/待确认/);const run=f.store.data.runs[0],before=structuredClone(run);f.generator.recover=async()=>{throw Object.assign(Error('服务端确认失败'),{remoteConfirmed:true});};let fail=false;f.store.save=()=>{if(!fail&&run.status==='failed'){fail=true;throw Error('终态保存失败');}};await assert.rejects(f.studio.recover({runId:run.id}),/保存失败/);assert.deepEqual(run,before);await assert.rejects(f.studio.generateImage({id:'draft',assetId:f.assetIds[0]}),/不能直接重交/);
});


test('参考实体核对贯穿分镜、资产、图片、视频输入，未确认或改版阻止提交并保留旧候选',async()=>{
 const f=fixture();let review={revision:1,reviewSha256:'facts1',facts:[{name:'接砂盒',color:'米白色',structure:'光滑无筛孔',use:'接取结块'}]};f.d.referenceSelection={sourceRunId:'reference',visualFactsRequired:true};f.studio.service={references:{selectionFacts:()=>{if(!review)throw Error('事实尚未确认');return structuredClone(review);}}};
 const initial=createStory(f.d);initial.episodeDuration=4;await f.studio.save({id:'draft',story:initial,revision:0});await f.studio.splitEpisodes({id:'draft'});const e=f.d.story.episodes[0];f.responses.push({shots:[{endUnit:2,visual:'接砂盒',action:'放下盒子',camera:'近景固定',sound:'环境声',imagePrompt:'米白接砂盒',videoPrompt:'放下盒子'}]});await f.studio.splitShots({id:'draft',episodeId:e.id});const target={episodeId:e.id,shotId:f.d.story.episodes[0].shots[0].id};assert.match(f.calls.at(-1).user,/光滑无筛孔/);
 f.responses.push({assets:[{key:'box',kind:'prop',name:'接砂盒',description:'米白光滑盒内无孔',prompt:'接砂盒'}],bindings:[{shotId:target.shotId,assetKeys:['box']}]});const extracted=await f.studio.extractAssets({id:'draft'});assert.equal(extracted.stale,false);assert.match(f.calls.at(-1).user,/光滑无筛孔/);const assetId=f.d.story.assets[0].id;
 const a=await f.studio.generateImage({id:'draft',assetId});assert.match(f.calls.at(-1).input.prompt,/光滑无筛孔/);await f.studio.selectImage({id:'draft',assetId,imageId:a.material.id});await imageAndVideo(f,target);assert.match(f.calls.find(call=>call.kind==='video').input.prompt,/光滑无筛孔/);
 const history=structuredClone(f.d.story),count=f.calls.length;review={...review,revision:2,reviewSha256:'facts2',facts:[{...review.facts[0],color:'浅米白'}]};await assert.rejects(f.studio.generateImage({id:'draft',assetId}),/重新提取资产/);await assert.rejects(f.studio.generateVideo({id:'draft',...target}),/重新提取资产/);assert.equal(f.calls.length,count);assert.deepEqual(f.d.story,history);
 f.responses.push({assets:[{key:assetId,kind:'prop',name:'接砂盒',description:'保留原设定',prompt:'接砂盒'}],bindings:[{shotId:target.shotId,assetKeys:[assetId]}]});await f.studio.extractAssets({id:'draft'});assert.equal(f.d.story.assets[0].selectedImageId,'');assert.equal(f.d.story.assets[0].images.length,history.assets[0].images.length);assert.equal(f.d.story.episodes[0].shots[0].selectedVideoId,'');assert.equal(f.d.story.episodes[0].shots[0].videos.length,history.episodes[0].shots[0].videos.length);
 review=null;await assert.rejects(f.studio.extractAssets({id:'draft'}),/尚未确认/);assert.equal(f.d.story.episodes[0].shots[0].videos.length,history.episodes[0].shots[0].videos.length);
});
test('参考事实在图片生成途中修改时只附着过期候选，不能覆盖当前选用',async()=>{
 const f=fixture(),target=await oneEpisode(f);let review={reviewSha256:'one',facts:[{name:'水壶',color:'红色',structure:'带壶嘴',use:'浇花'}]};f.d.referenceSelection={sourceRunId:'ref',visualFactsRequired:true};f.studio.service={references:{selectionFacts:()=>structuredClone(review)}};f.responses.push({assets:[{key:'a',kind:'prop',name:'水壶',description:'红色',prompt:'红壶'}],bindings:[{shotId:target.shotId,assetKeys:['a']}]});await f.studio.extractAssets({id:'draft'});const assetId=f.d.story.assets[0].id;let finish;f.generator.image=()=>new Promise(resolve=>finish=resolve);const pending=f.studio.generateImage({id:'draft',assetId});while(!finish)await new Promise(resolve=>setImmediate(resolve));review={...review,reviewSha256:'two'};finish({id:'late',type:'image'});const out=await pending;assert.equal(out.stale,true);assert.equal(out.candidate.status,'stale');assert.equal(f.d.story.assets[0].selectedImageId,'');assert.equal(f.d.story.assets[0].images.at(-1).id,'late');
});


test('重新提取复用实体会更新错误描述并撤销旧候选，保留ID与媒体历史',async()=>{
 const f=fixture(),target=await oneEpisode(f);f.responses.push({assets:[{key:'box',kind:'prop',name:'接砂盒',description:'黑色有筛孔盒',prompt:'黑色有孔盒'}],bindings:[{shotId:target.shotId,assetKeys:['box']}]});await f.studio.extractAssets({id:'draft'});
 const assetId=f.d.story.assets[0].id,image=await f.studio.generateImage({id:'draft',assetId});await f.studio.selectImage({id:'draft',assetId,imageId:image.material.id});await imageAndVideo(f,target);
 const history=structuredClone(f.d.story);f.responses.push({assets:[{key:assetId,kind:'prop',name:'接砂盒',description:'米白色，盒内壁光滑无孔',prompt:'米白色内壁光滑无孔接砂盒'}],bindings:[{shotId:target.shotId,assetKeys:[assetId]}]});const result=await f.studio.extractAssets({id:'draft'});
 assert.equal(result.stale,false);const asset=f.d.story.assets[0],shot=f.d.story.episodes[0].shots[0];assert.equal(asset.id,assetId);assert.equal(asset.description,'米白色，盒内壁光滑无孔');assert.match(asset.prompt,/无孔/);assert.equal(asset.selectedImageId,'');assert.equal(asset.images.length,history.assets[0].images.length);assert(asset.images.every(c=>c.status==='stale'));assert.equal(shot.selectedVideoId,'');assert.equal(shot.videos.length,history.episodes[0].shots[0].videos.length);assert(shot.videos.every(c=>c.status==='stale'));
});


test('修改已交接集稿后撤销旧成片的可信字幕来源，历史视频保留',async()=>{
 const f=fixture(),target=await oneEpisode(f);await imageAndVideo(f,target);await f.studio.composeEpisode({id:'draft',episodeId:target.episodeId});await f.studio.useEpisode({id:'draft',episodeId:target.episodeId});const {trustedSubtitleReference}=require('../server/subtitle-reference.mjs'),sha=require('../server/subtitle-proofread.cjs').hash;
 assert.equal(trustedSubtitleReference(f.d,[],sha).kind,'story-episode');const before=structuredClone(f.d.story),next=structuredClone(before);next.episodes[0].text+='补充说明。';await f.studio.save({id:'draft',story:next,revision:next.revision});assert.equal(trustedSubtitleReference(f.d,[],sha),null);assert.equal(f.d.video.assetId,'');assert.equal(f.d.edit.sourceId,'');assert.deepEqual(f.d.story.episodes[0].results,before.episodes[0].results);
});
