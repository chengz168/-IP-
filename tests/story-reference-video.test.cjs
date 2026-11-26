const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {StoryGenerator,referenceVideoGraph,inspectReferenceVideoModels,DEFAULT_REFERENCE_H3,DEFAULT_H3,REFERENCE_H3_LORA}=require('../server/story-generator.cjs');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function info(){return {
 ...Object.fromEntries(['MiniMaxH3SigmaShift','VAEDecodeAudio','CreateVideo','SaveVideo','BasicGuider','SamplerCustomAdvanced','RandomNoise','VAEDecode','LoadImage'].map(name=>[name,{}])),
 UNETLoader:{input:{required:{unet_name:[[DEFAULT_REFERENCE_H3,DEFAULT_H3]]}}},
 CLIPLoader:{input:{required:{clip_name:[['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']],type:[['minimax']]}}},
 VAELoader:{input:{required:{vae_name:[['minimax_h3_video_vae_int8_convrot.safetensors','minimax_h3_audio_vae_fp32.safetensors']]}}},
 LoraLoaderModelOnly:{input:{required:{lora_name:[[REFERENCE_H3_LORA]]}}},
 KSamplerSelect:{input:{required:{sampler_name:[['res_multistep']]}}},BasicScheduler:{input:{required:{scheduler:[['simple']]}}},
 MiniMaxH3ReferenceToVideo:{input:{required:{ref_image_size:[['match','max']]},optional:{vae:['VAE'],audio_vae:['VAE'],ref_images:['COMFY_AUTOGROW_V3',{template:{prefix:'ref_image_',min:0,max:9}}]}}}
};}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-reference-video-')),assets=['product','room'].map(id=>{const file=path.join(root,id+'.png');fs.writeFileSync(file,'独立参考夹具:'+id);return {id,type:'image',path:file};});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store={data:{assets,settings:{provider:{storyVideoProtocol:'comfy-h3',storyVideoModel:DEFAULT_H3}}},outputDir:()=>root,asset(id){const value=assets.find(asset=>asset.id===id);if(!value)throw Error('素材不存在');return value;}};
 const generator=new StoryGenerator(store,{},{});generator.comfy.json=async()=>info();generator.probe=async()=>({streams:[{codec_type:'video',width:768,height:1344}]});generator.comfy.upload=async(_base,file)=>({subfolder:'references',name:path.basename(file)});
 return {root,store,generator,assets};
}
const input=()=>({prompt:'厨房场景里介绍扒炉，展示完整商品及清理动作。',aspect:'9:16',duration:5,seed:0,referenceMode:'assets',references:[{assetId:'product',storyAssetId:'stove',kind:'prop',name:'扒炉'},{assetId:'room',storyAssetId:'kitchen',kind:'scene',name:'厨房'}]});

test('REF2VA图使用独立权重和4步LoRA，9张图逐张编码，固定零种子不丢失',()=>{
 const data={...input(),references:Array.from({length:9},(_,i)=>({assetId:'ref'+i,name:'参考'+i}))},images=data.references.map((_,i)=>'inputs/'+i+'.png'),graph=referenceVideoGraph({input:data,images,seed:0});
 assert.equal(graph['1'].inputs.unet_name,DEFAULT_REFERENCE_H3);assert.equal(graph['5'].inputs.lora_name,REFERENCE_H3_LORA);assert.equal(graph['10'].inputs.steps,4);assert.equal(graph['8'].inputs.noise_seed,0);assert.equal(graph['6'].class_type,'MiniMaxH3ReferenceToVideo');assert.equal(graph['6'].inputs.ref_image_size,'match');assert.equal(graph['6'].inputs.length%17,5);
 assert.deepEqual(graph['6'].inputs.vae,['3',0]);assert.deepEqual(graph['6'].inputs.audio_vae,['4',0]);assert(!('first_frame'in graph['6'].inputs));assert(!('last_frame'in graph['6'].inputs));
 for(let i=0;i<9;i++){assert.equal(graph[String(17+i)].inputs.image,images[i]);assert.deepEqual(graph['6'].inputs['ref_images.ref_image_'+i],[String(17+i),0]);assert(graph['6'].inputs.prompt.includes('<Picture '+(i+1)+'>.'));assert(graph['6'].inputs.prompt.includes('<Subject '+(i+1)+'>'));}
 assert.match(graph['6'].inputs.prompt,/subject_definitions:[\s\S]*summary: \[reference generation\][\s\S]*retention_analysis:[\s\S]*detailed_description:[\s\S]*overall_soundscape:[\s\S]*non_diegetic_music:/);
 assert.match(graph['6'].inputs.prompt,/visual assets, not fixed first or last frames/);assert.match(graph['6'].inputs.prompt,/5\.00 seconds/);assert(!Object.values(graph).some(row=>row.class_type==='MiniMaxH3ImageToVideo'));
});

test('参考图工作流拒绝空图、超过9张、绑定数量不符、尾帧和混用FL2VA',()=>{
 for(const images of [[],Array(10).fill('x.png'),['']])assert.throws(()=>referenceVideoGraph({input:input(),images}),/1至9张/);
 assert.throws(()=>referenceVideoGraph({input:input(),images:['a.png']}),/数量不一致/);
 assert.throws(()=>referenceVideoGraph({input:{...input(),lastFrame:{assetId:'last'}},images:['a.png','b.png']}),/不支持尾帧/);
 assert.throws(()=>referenceVideoGraph({input:input(),images:['a.png','b.png'],model:DEFAULT_H3}),/REF2VA/);
});

test('参考模式只读预检核对独立权重、采样器、动态引用接口和VAE，不声称推理已验',()=>{
 const checked=inspectReferenceVideoModels(info());assert(checked.ready);assert.equal(checked.selected,DEFAULT_REFERENCE_H3);assert.equal(checked.referenceMode,'assets');assert.equal(checked.generationVerified,false);assert.equal(checked.supportsLastFrame,false);assert.equal(checked.maxReferences,9);
 const broken=info();delete broken.LoadImage;broken.LoraLoaderModelOnly.input.required.lora_name=[[]];delete broken.MiniMaxH3ReferenceToVideo.input.optional.vae;delete broken.MiniMaxH3ReferenceToVideo.input.optional.ref_images[1].template.max;broken.KSamplerSelect.input.required.sampler_name=[['euler']];const rejected=inspectReferenceVideoModels(broken,{storyReferenceVideoModel:DEFAULT_H3});assert(!rejected.ready);assert.deepEqual(rejected.missingNodes,['LoadImage']);assert.deepEqual(rejected.missingModels,[REFERENCE_H3_LORA]);assert.match(rejected.invalidOptions.join(),/storyReferenceVideoModel/);assert.match(rejected.invalidOptions.join(),/ref_images/);assert.match(rejected.invalidOptions.join(),/res_multistep/);assert.match(rejected.invalidOptions.join(),/\.vae/);
});

test('兼容本机真实V3 COMBO选项格式，不把已支持的采样器误报缺失',()=>{
 const liveShape=info();for(const [name,field]of [['KSamplerSelect','sampler_name'],['BasicScheduler','scheduler'],['MiniMaxH3ReferenceToVideo','ref_image_size']]){const old=liveShape[name].input.required[field];liveShape[name].input.required[field]=['COMBO',{options:old[0],multiselect:false}];}assert.equal(inspectReferenceVideoModels(liveShape).ready,true);
 liveShape.BasicScheduler.input.required.scheduler[1].options=['beta'];assert.equal(inspectReferenceVideoModels(liveShape).ready,false);
});

test('无首帧合法，所有原始参考真实上传并保留来源ID、摘要与引用顺序',async t=>{
 const {generator,store}=fixture(t),before=JSON.stringify(store.data.settings),uploads=[];generator.comfy.upload=async(_base,file)=>{uploads.push(path.basename(file));return {subfolder:'refs',name:path.basename(file)};};let submitted=0;
 generator.executeComfy=async remote=>{submitted++;assert.equal(remote.referenceMode,'assets');assert.equal(remote.model,DEFAULT_REFERENCE_H3);assert.equal(remote.input.image,undefined);assert.deepEqual(remote.usedReferenceAssetIds,['product','room']);assert.deepEqual(remote.usedStoryAssetIds,['stove','kitchen']);assert.deepEqual(remote.unusedVisualReferenceAssetIds,[]);assert.deepEqual(remote.references.map(ref=>ref.assetId),['product','room']);for(const ref of remote.references){assert.equal(ref.path,undefined);assert.equal(ref.sha256,digest(store.asset(ref.assetId).path));}assert.equal(remote.graph['17'].inputs.image,'refs/product.png');assert.equal(remote.graph['18'].inputs.image,'refs/room.png');return {id:'candidate'};};
 assert.equal((await generator.video(input())).id,'candidate');assert.equal(submitted,1);assert.deepEqual(uploads,['product.png','room.png']);assert.equal(JSON.stringify(store.data.settings),before);
});

test('本地模型检查分别报告FL2VA与REF2VA，不因FL2VA未装误判参考模式',async t=>{
 const {generator}=fixture(t),report=await generator.check();assert.equal(report.video.ready,false);assert.equal(report.video.reference.ready,true);assert.equal(report.video.reference.selected,DEFAULT_REFERENCE_H3);
});

test('错误资产、重复引用、冻结摘要冲突、云协议、首尾帧和非法种子都在上传前拒绝',async t=>{
 const {generator,store}=fixture(t);let uploads=0,submits=0;generator.comfy.upload=async()=>{uploads++;};generator.executeComfy=async()=>{submits++;};
 for(const references of [[],Array(10).fill({assetId:'product'}),[{assetId:''}],[{assetId:'product'},{assetId:'product'}],[{assetId:'missing'}],[{assetId:'product',sha256:'wrong'}]])await assert.rejects(generator.video({...input(),references}),/参考|素材不存在/);
 store.data.assets[0].type='video';await assert.rejects(generator.video(input()),/必须为已确认图片/);store.data.assets[0].type='image';
 for(const extra of [{image:{assetId:'product'}},{lastFrame:{assetId:'room'}},{seed:-1}])await assert.rejects(generator.video({...input(),...extra}),/首帧|尾帧|种子/);
 store.data.settings.provider.storyVideoProtocol='bridge';await assert.rejects(generator.video(input()),/仅支持本地H3/);assert.equal(uploads,0);assert.equal(submits,0);
});

test('缺少REF2VA配套权重在上传和任务登记之前拒绝，不回退FL2VA',async t=>{
 const {generator}=fixture(t);let uploads=0,submits=0;generator.comfy.json=async()=>{const result=info();result.UNETLoader.input.required.unet_name=[[DEFAULT_H3]];return result;};generator.comfy.upload=async()=>{uploads++;};generator.executeComfy=async()=>{submits++;};
 await assert.rejects(generator.video(input()),error=>error.stopBatch===true&&error.environmentFailure===true&&error.message.includes(DEFAULT_REFERENCE_H3));assert.equal(uploads,0);assert.equal(submits,0);
});

test('资产参考模式沿用普通单镜4至15秒边界，不用填帧或循环放宽限制',async t=>{
 const {generator}=fixture(t);let checked=0;generator.comfy.json=async()=>{checked++;return info();};generator.executeComfy=async remote=>({duration:remote.input.duration});
 for(const duration of [0,3.99,15.01,NaN,'5'])await assert.rejects(generator.video({...input(),duration}),/4至15/);assert.equal(checked,0);
 assert.equal((await generator.video({...input(),duration:4})).duration,4);assert.equal((await generator.video({...input(),duration:15})).duration,15);
});

test('参考文件在探测或后续图片上传期间变化，拒绝整批提交',async t=>{
 const {generator,store}=fixture(t);let submits=0;generator.executeComfy=async()=>{submits++;};generator.probe=async file=>{fs.writeFileSync(file,'探测后被替换');return {streams:[{codec_type:'video',width:768,height:1344}]};};await assert.rejects(generator.video(input()),/检查期间已变化/);assert.equal(submits,0);
 generator.probe=async()=>({streams:[{codec_type:'video',width:768,height:1344}]});generator.comfy.upload=async(_base,file)=>{if(file===store.asset('room').path)fs.writeFileSync(store.asset('product').path,'第二图上传期间首图替换');return {subfolder:'refs',name:path.basename(file)};};await assert.rejects(generator.video(input()),/上传期间已变化/);assert.equal(submits,0);
});

test('观察器建立期间参考变化在提交前再次复核，不写提交凭据',async t=>{
 const {generator,store}=fixture(t);let submits=0,records=0,closed=0;generator.comfy.observe=async()=>{fs.writeFileSync(store.asset('product').path,'建立连接期间被替换');return {close(){closed++;}};};generator.comfy.submit=async()=>{submits++;};await assert.rejects(generator.video(input(),{remote(){records++;}}),/参考图片在生成期间已变化/);assert.equal(submits,0);assert.equal(records,0);assert.equal(closed,1);
});

test('已取消的资产参考任务不上传，上传期间取消不提交',async t=>{
 const {generator}=fixture(t),controller=new AbortController();controller.abort();let uploads=0,submits=0;generator.comfy.upload=async()=>{uploads++;};generator.executeComfy=async()=>{submits++;};await assert.rejects(generator.video(input(),{signal:controller.signal}));assert.equal(uploads,0);assert.equal(submits,0);
 const active=new AbortController();generator.comfy.upload=async()=>{uploads++;active.abort();return {subfolder:'refs',name:'a.png'};};await assert.rejects(generator.video(input(),{signal:active.signal}));assert.equal(uploads,1);assert.equal(submits,0);
});

test('参考模式提交回包丢失保留完整引用凭据，恢复只查询原图不重交',async t=>{
 const {generator}=fixture(t),events=[];let submits=0;generator.comfy.observe=async()=>({bind(){},close(){}});generator.comfy.submit=async()=>{submits++;throw Object.assign(Error('回包丢失'),{unknown:true});};await assert.rejects(generator.video(input(),{remote:(id,details)=>events.push({id,details})}),error=>error.unknown===true);assert.equal(submits,1);assert.equal(events.length,1);assert.equal(events[0].details.referenceMode,'assets');assert.equal(events[0].details.references.length,2);assert.equal(events[0].details.graph['6'].class_type,'MiniMaxH3ReferenceToVideo');
 generator.comfy.discover=async remote=>{assert.equal(remote.graphSha256,events[0].details.graphSha256);return 'original-ref-task';};generator.waitComfy=async(id,remote)=>{assert.equal(id,'original-ref-task');assert.equal(remote.usedReferenceAssetIds.length,2);return {id:'recovered'};};assert.equal((await generator.recover({remote:events[0].details})).id,'recovered');assert.equal(submits,1);
});

test('参考模式取消只定向当前任务且保留待查询状态',async t=>{
 const {generator}=fixture(t),controller=new AbortController(),requests=[];generator.comfy.observe=async()=>({bind(){},close(){}});generator.comfy.submit=async()=> 'only-ref-task';generator.waitComfy=async()=>{controller.abort();controller.signal.throwIfAborted();};const query=generator.comfy.json;generator.comfy.json=async(base,route,options)=>{if(route==='/object_info')return query();requests.push([route,JSON.parse(options.body)]);return {};};await assert.rejects(generator.video(input(),{signal:controller.signal}),error=>error.unknown===true);assert.deepEqual(requests,[['/queue',{delete:['only-ref-task']}],['/interrupt',{prompt_id:'only-ref-task'}]]);
});
