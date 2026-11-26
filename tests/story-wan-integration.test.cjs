const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {StoryGenerator}=require('../server/story-generator.cjs');
const {WAN_DEFAULTS,wanGraph}=require('../server/story-wan.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const {createService}=require('./support/licensed-service.cjs');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const input=()=>({prompt:'A metal griddle remains rigid while the camera moves slightly left. No dialogue or voiceover.',duration:4,aspect:'16:9',image:{assetId:'first'},seed:315,inputHash:'frozen-design',revision:1});
function info(){return {UNETLoader:{input:{required:{unet_name:[[WAN_DEFAULTS.storyWanModel]],weight_dtype:[['default']]}}},CLIPLoader:{input:{required:{clip_name:[[WAN_DEFAULTS.storyWanClip]],type:[['wan']],device:[['default']]}}},VAELoader:{input:{required:{vae_name:[[WAN_DEFAULTS.storyWanVae]]}}},KSampler:{input:{required:{sampler_name:[['uni_pc']],scheduler:[['simple']]}}},SaveVideo:{input:{required:{format:[['auto']],'format.codec':[['auto']]}}},Wan22ImageToVideoLatent:{input:{optional:{start_image:['IMAGE']}}},...Object.fromEntries(['LoadImage','CLIPTextEncode','ModelSamplingSD3','VAEDecode','CreateVideo'].map(name=>[name,{}]))};}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-wan-integration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store={data:{assets:[],settings:{provider:{storyVideoProtocol:'comfy-wan22',...WAN_DEFAULTS}}},outputDir:()=>root,asset(id){const asset=this.data.assets.find(row=>row.id===id);if(!asset)throw Error('素材不存在');return asset;},save(){},addAsset(file,extra){const asset={id:'result-'+this.data.assets.length,type:'video',path:path.join(root,'result-'+this.data.assets.length+'.mp4'),...extra};fs.copyFileSync(file,asset.path);this.data.assets.push(asset);return asset;}};const media=new Media(store),generator=new StoryGenerator(store,media,{});return {root,store,media,generator};}
async function imageFixture(f){const file=path.join(f.root,'first.png');await runProcess(f.media.binaries().ffmpeg,['-v','error','-y','-f','lavfi','-i','color=c=gray:size=640x360','-frames:v','1','-update','1',file]);f.store.data.assets.push({id:'first',path:file,type:'image'});return file;}

test('Wan设置独立保存且拒绝远程Comfy地址，不覆盖H3模型与原稿',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wan-setting-')),before=new Set(process.listeners('exit')),service=createService(root);t.after(()=>{for(const listener of process.listeners('exit'))if(!before.has(listener))process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const provider={storyImageProtocol:'comfy',storyImageBaseUrl:'http://127.0.0.1:8188',storyImageModel:'sd_xl_base_1.0.safetensors',storyVideoProtocol:'comfy-wan22',storyVideoBaseUrl:'http://127.0.0.1:8188',storyVideoModel:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',...WAN_DEFAULTS},drafts=JSON.stringify(service.store.data.drafts);
 await service.invoke('saveStoryModels',{provider});assert.equal(service.store.data.settings.provider.storyVideoModel,provider.storyVideoModel);assert.equal(service.store.data.settings.provider.storyWanModel,WAN_DEFAULTS.storyWanModel);assert.equal(JSON.stringify(service.store.data.drafts),drafts);
 const settings=JSON.stringify(service.store.data.settings);await assert.rejects(service.invoke('saveStoryModels',{provider:{...provider,storyVideoBaseUrl:'https://remote.test'}}),/本机HTTP/);assert.equal(JSON.stringify(service.store.data.settings),settings);
});

test('Wan界面允许固定种子，禁止尾帧和资产模式，云桥门禁保留',async()=>{
 const {storyVideoControlProblems}=await import('../src/story-ui.mjs');assert.deepEqual(storyVideoControlProblems({videoSeed:42},'comfy-wan22'),[]);assert.match(storyVideoControlProblems({lastFrameId:'last'},'comfy-wan22').join(),/不支持尾帧/);assert.match(storyVideoControlProblems({referenceMode:'assets'},'comfy-wan22').join(),/仅支持本地H3/);assert.match(storyVideoControlProblems({videoSeed:42},'bridge').join(),/请清除/);
});

test('Wan经真实等比首帧准备再提交，冻结正确图、配方、种子和来源',async t=>{
 const f=fixture(t),file=await imageFixture(f),source=sha(file);let submits=0,uploaded;
 f.generator.comfy.json=async()=>info();f.generator.comfy.upload=async(_base,prepared)=>{const data=await f.generator.probe(prepared);uploaded={width:data.streams[0].width,height:data.streams[0].height};return {name:'first.png',subfolder:'test'};};f.generator.executeComfy=async remote=>{submits++;assert.equal(remote.kind,'story-comfy-video-v1');assert.equal(remote.engine,'wan22-ti2v-5b');assert.equal(remote.videoProtocol,'comfy-wan22');assert.equal(remote.outputNode,'16');assert.equal(remote.graph['9'].inputs.seed,315);assert.equal(remote.frameLength,97);assert.equal(remote.references[0].sha256,source);assert.equal(remote.nativeSize.outputHeight,720);return remote;};
 const wanRecipe={architecture:'wan22-ti2v-5b',model:WAN_DEFAULTS.storyWanModel,clip:WAN_DEFAULTS.storyWanClip,vae:WAN_DEFAULTS.storyWanVae};
 await f.generator.video({...input(),firstFrameSha256:source,wanRecipe});assert.equal(submits,1);assert.deepEqual(uploaded,{width:1280,height:704});assert.equal(sha(file),source);
});

test('Wan能力不符、冻结首帧/配方变化与上传中换图均不提交GPU',async t=>{
 const f=fixture(t),file=await imageFixture(f);let uploads=0,submits=0;f.generator.comfy.json=async()=>info();f.generator.comfy.upload=async()=>{uploads++;fs.appendFileSync(file,'changed');return {name:'x',subfolder:'test'};};f.generator.executeComfy=async()=>{submits++;};
 for(const extra of [{lastFrame:{assetId:'first'}},{referenceMode:'assets'},{firstFrameSha256:'wrong'},{wanRecipe:{model:'changed'}}])await assert.rejects(f.generator.video({...input(),...extra}));assert.equal(uploads,0);
 await assert.rejects(f.generator.video(input()),/上传期间已变化/);assert.equal(uploads,1);assert.equal(submits,0);
});

test('Wan真实静音媒体收取补边为标准画幅，不误标H3或伪造声音',async t=>{
 const f=fixture(t),file=await imageFixture(f),source=path.join(f.root,'generated.mp4');await runProcess(f.media.binaries().ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=1280x704:rate=24','-t','4.05','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source]);
 const planned=input(),weights={architecture:'wan22-ti2v-5b',model:WAN_DEFAULTS.storyWanModel,clip:WAN_DEFAULTS.storyWanClip,vae:WAN_DEFAULTS.storyWanVae},remote={kind:'story-comfy-video-v1',engine:'wan22-ti2v-5b',videoProtocol:'comfy-wan22',mediaKind:'video',input:planned,model:weights.model,weights,architecture:weights.architecture,recipeVersion:1,frameLength:97,nativeSize:{width:1280,height:704,outputWidth:1280,outputHeight:720},graph:wanGraph({input:planned,image:'first.png',weights,seed:315}),references:[{assetId:'first',sha256:sha(file)}]};
 f.generator.comfy.request=async()=>new Response(fs.readFileSync(source));const result=await f.generator.collectComfy({filename:'generated.mp4',type:'output'},'original-remote',remote);const probe=await f.generator.probe(result.path);
 assert.equal(result.storyGeneration.protocol,'comfy-wan22');assert.equal(result.storyGeneration.engine,'wan22-ti2v-5b');assert.equal(result.storyGeneration.seed,315);assert.equal(result.storyGeneration.qualityAccepted,false);assert.match(result.storyGeneration.frameGridPolicy,/Wan-4k\+1/);assert.equal(probe.streams[0].width,1280);assert.equal(probe.streams[0].height,720);assert.equal(probe.streams.filter(s=>s.codec_type==='audio').length,0);assert(Math.abs(Number(probe.format.duration)-4)<.06);
});

test('Wan恢复沿冻结原图和任务，不因当前模型配置变为H3而重提交',async t=>{
 const f=fixture(t),frozen={kind:'story-comfy-video-v1',engine:'wan22-ti2v-5b',input:input(),graph:{'9':{class_type:'KSampler',inputs:{seed:315}}},clientId:'original-client'};let submitted=0;f.store.data.settings.provider.storyVideoProtocol='comfy-h3';f.generator.comfy.submit=async()=>{submitted++;};f.generator.executeComfy=async(remote,_ctx,existingId)=>{assert.equal(remote.engine,'wan22-ti2v-5b');assert.equal(remote.graph['9'].inputs.seed,315);assert.equal(existingId,'original-remote');return {id:'same-result'};};const result=await f.generator.recover({remoteId:'original-remote',remote:frozen});assert.equal(result.id,'same-result');assert.equal(submitted,0);
});
