const {test}=require('node:test');
const assert=require('node:assert/strict');
const {StoryGenerator,imageReferenceSettings,imageGraph,referenceImageFilter,DEFAULT_CHECKPOINT}=require('../server/story-generator.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const {compileImagePrompt}=require('../server/sdxl-prompt.cjs');
const {createService}=require('./support/licensed-service.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('SDXL参考图设置兼容旧默认值，并拒绝非数字或越界值',()=>{
 assert.deepEqual(imageReferenceSettings({}),{fit:'contain',denoise:.68,language:'original'});
 assert.deepEqual(imageReferenceSettings({storyImageReferenceFit:'cover',storyImageDenoise:.38,storyImagePromptLanguage:'english'}),{fit:'cover',denoise:.38,language:'english'});
 assert.equal(imageReferenceSettings({storyImageReferenceFit:'blur'}).fit,'blur');
 for(const value of ['0.38',NaN,0,.09,1.01])assert.throws(()=>imageReferenceSettings({storyImageDenoise:value}),/设置无效/);
 for(const value of ['stretch',''])assert.throws(()=>imageReferenceSettings({storyImageReferenceFit:value}),/设置无效/);
 for(const value of ['translate','zh'])assert.throws(()=>imageReferenceSettings({storyImagePromptLanguage:value}),/设置无效/);
});

test('SDXL图生图采样强度使用保存值，文生图仍固定完整生成',()=>{
 const reference=imageGraph({prompt:'reference',image:'primary.png',denoise:.38});
 const textOnly=imageGraph({prompt:'text only',denoise:.38});
 assert.equal(reference['5'].inputs.denoise,.38);
 assert.equal(textOnly['5'].inputs.denoise,1);
 assert.match(referenceImageFilter(1152,496,768,1344,'contain'),/force_original_aspect_ratio=decrease,pad=768:1344/);
 assert.match(referenceImageFilter(1152,496,768,1344,'cover'),/force_original_aspect_ratio=increase,crop=768:1344/);
 assert.match(referenceImageFilter(1152,496,768,1344,'blur'),/gblur=sigma=32.*overlay/);
 assert.throws(()=>referenceImageFilter(0,496,768,1344,'cover'),/尺寸无效/);
});

test('设置保存拒绝非法值并保留之前有效配置，包括旧界面省略字段',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-image-reference-settings-'));
 const before=new Set(process.listeners('exit'));
 const service=createService(root);
 t.after(()=>{for(const listener of process.listeners('exit'))if(!before.has(listener))process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});
 const base={storyImageProtocol:'comfy',storyImageBaseUrl:'http://127.0.0.1:8188',storyImageModel:'sd_xl_base_1.0.safetensors',storyImageArchitecture:'sdxl',storyVideoProtocol:'comfy-h3',storyVideoBaseUrl:'http://127.0.0.1:8188',storyVideoModel:'minimax_h3_fl2va_pruned_int8_convrot.safetensors'};
 await service.invoke('saveStoryModels',{provider:{...base,storyImageReferenceFit:'cover',storyImageDenoise:.38,storyImagePromptLanguage:'english'}});
 const saved=service.store.data.settings.provider;
 assert.equal(saved.storyImageReferenceFit,'cover');assert.equal(saved.storyImageDenoise,.38);assert.equal(saved.storyImagePromptLanguage,'english');
 for(const invalid of [{storyImageDenoise:'0.38'},{storyImageDenoise:1.1},{storyImageReferenceFit:'stretch'},{storyImagePromptLanguage:'unknown'}])await assert.rejects(service.invoke('saveStoryModels',{provider:{...base,...invalid}}),/SDXL参考图设置无效/);
 assert.equal(service.store.data.settings.provider.storyImageReferenceFit,'cover');assert.equal(service.store.data.settings.provider.storyImageDenoise,.38);assert.equal(service.store.data.settings.provider.storyImagePromptLanguage,'english');
 await service.invoke('saveStoryModels',{provider:base});
 assert.equal(service.store.data.settings.provider.storyImageDenoise,.38);assert.equal(service.store.data.settings.provider.storyImageReferenceFit,'cover');assert.equal(service.store.data.settings.provider.storyImagePromptLanguage,'english');
});

test('英文指令编译只接受有界英文JSON，保留来源并可取消',async()=>{
 const source='保留一个三旋钮扒炉，银色炉面和右侧按钮结构不变，单一画面，禁止文字。';
 const providers={text:async(system,user,ctx,options)=>{assert.match(system,/不增加人物、物件/);assert.deepEqual(JSON.parse(user),{source});assert.equal(options.temperature,0);return {text:JSON.stringify({prompt:'One stainless steel tabletop grill with three knobs, same right-side controls, single frame, no text.'})};}};
 const result=await compileImagePrompt(providers,source);
 assert.equal(result.source,source);assert.equal(result.qualityAccepted,false);assert.equal(result.version,1);assert.match(result.prompt,/three knobs/);assert.match(result.sourceHash,/^[a-f0-9]{64}$/);
 for(const response of ['not json',JSON.stringify({prompt:'保留三旋钮 grill'}),JSON.stringify({prompt:'grill',extra:'field'})])await assert.rejects(compileImagePrompt({text:async()=>({text:response})},source),/格式无效|180词以内英文/);
 const controller=new AbortController();controller.abort();await assert.rejects(compileImagePrompt(providers,source,{signal:controller.signal}),/abort/i);
});

function generationFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sdxl-compile-submit-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store={data:{settings:{provider:{storyImageProtocol:'comfy',storyImagePromptLanguage:'english',storyImageDenoise:.38,storyImageReferenceFit:'cover'}}},outputDir:()=>root,asset:id=>({id,type:'image',path:path.join(root,'reference.ppm')})};
 const generator=new StoryGenerator(store,new Media(store),{text:async()=>({text:JSON.stringify({prompt:'One silver grill with three control knobs.'})})});
 generator.comfy.json=async()=>({CheckpointLoaderSimple:{input:{required:{ckpt_name:[[DEFAULT_CHECKPOINT]]}}},...Object.fromEntries(['KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage'].map(key=>[key,{}]))});
 return {root,store,generator};
}

test('英文编译失败或翻译期间取消时，不上传参考图或提交Comfy任务',async t=>{
 const {root,generator}=generationFixture(t);fs.writeFileSync(path.join(root,'reference.ppm'),'参考测试夹具');let uploads=0,submissions=0;
 generator.comfy.upload=async()=>{uploads++;};generator.executeComfy=async()=>{submissions++;};generator.preparePrimary=async()=>{throw Error('不应先处理参考图');};
 generator.providers.text=async()=>({text:'invalid'});
 await assert.rejects(generator.image({prompt:'三旋钮扒炉',aspect:'9:16',references:[{assetId:'reference'}]}),/格式无效/);
 const controller=new AbortController();generator.providers.text=async()=>{controller.abort();return {text:JSON.stringify({prompt:'A silver grill.'})};};
 await assert.rejects(generator.image({prompt:'三旋钮扒炉',aspect:'9:16'},{signal:controller.signal}),/abort/i);
 assert.equal(uploads,0);assert.equal(submissions,0);
});

test('实际提交图使用英文编译结果，冻结配置与中文来源；收片登记保留证据',async t=>{
 const {root,store,generator}=generationFixture(t);let remote;
 generator.executeComfy=async value=>{remote=value;return {id:'生成占位'};};
 await generator.image({prompt:'三旋钮扒炉',aspect:'9:16',inputHash:'frozen',revision:3});
 assert.equal(remote.graph['2'].inputs.text,'One silver grill with three control knobs.');
 assert.deepEqual(remote.referenceSettings,{fit:'cover',denoise:.38,language:'english'});assert.match(remote.input.imagePromptCompilation.source,/三旋钮扒炉/);
 store.data.settings.provider.storyImageDenoise=.8;
 generator.comfy.request=async()=>({ok:true,arrayBuffer:async()=>Buffer.from('生成结果夹具')});
 generator.fitImageAndRegister=async(file,input,details)=>{assert(fs.existsSync(file));assert.equal(details.imageReferenceSettings.denoise,.38);assert.equal(details.imagePromptCompilation.sourceHash,remote.input.imagePromptCompilation.sourceHash);assert.equal(input.prompt,'三旋钮扒炉');return details;};
 const details=await generator.collectComfy({filename:'result.png'},'original-task',remote);
 assert.equal(details.promptId,'original-task');assert.equal(details.imagePromptCompilation.qualityAccepted,false);
});

test('真实FFmpeg三种适配策略保留预期画幅及主体范围，原始文件字节保持',async t=>{
 const {root,generator}=generationFixture(t),file=path.join(root,'reference.ppm'),width=120,height=40,pixels=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[(y*width+x)*3+(x<40?0:x<80?1:2)]=255;
 fs.writeFileSync(file,Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),pixels]));
 const digest=()=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256=digest();
 for(const fit of ['contain','cover','blur']){
  const directory=path.join(root,fit);fs.mkdirSync(directory);const result=await generator.preparePrimary({path:file,sha256},directory,'9:16',{},fit),probe=await generator.probe(result);
  const stream=probe.streams.find(row=>row.width);assert.equal(stream.width,768);assert.equal(stream.height,1344);
  const raw=path.join(directory,'pixels.rgb');await runProcess(generator.media.binaries().ffmpeg,['-v','error','-y','-i',result,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',raw]);
  const data=fs.readFileSync(raw),pixel=(x,y)=>Array.from(data.subarray((y*768+x)*3,(y*768+x)*3+3));
  const [topRed,topGreen,topBlue]=pixel(384,10);
  if(fit==='contain')assert.deepEqual([topRed,topGreen,topBlue],[0,0,0]);else assert(topGreen>220&&topRed<20&&topBlue<20,'扩展或铺满的顶部不能留黑边');
  const left=pixel(10,672),right=pixel(758,672);
  if(fit==='cover')assert(left[1]>220&&right[1]>220,'居中铺满会裁去左右色块');else {assert(left[0]>220&&left[1]<20);assert(right[2]>220&&right[1]<20,'完整保留与柔化扩展必须保留两侧主体');}
  const [red,green,blue]=pixel(384,672);assert(green>220&&red<20&&blue<20);assert.equal(digest(),sha256);
 }
});
