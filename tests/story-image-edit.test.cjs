const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {editRegion,editGeometry,maskBytes,prepareEdit,editGraph}=require('../server/story-image-edit.cjs');
const {StoryGenerator,imageGraph,DEFAULT_CHECKPOINT}=require('../server/story-generator.cjs');
const {StoryStudio}=require('../server/story-studio.cjs');
const {createStory}=require('../server/story-contract.cjs');
const {Media,runProcess}=require('../server/media.cjs');
const region={x:.3,y:.1,width:.4,height:.3};

test('局部区域只接受原图内的有限数值，拒绝额外字段和过小区域',()=>{
 assert.deepEqual(editRegion(region),region);
 for(const value of [null,[],{}, {...region,x:-.01},{...region,width:0},{...region,height:.001},{...region,x:'0.3'},{...region,y:NaN},{...region,x:.9},{...region,remote:'untrusted'}])assert.throws(()=>editRegion(value),/区域|框选/);
});

test('框选映射保留横图主体坐标，扩展与补边一致，裁掉区域和小于八像素拒绝',()=>{
 const contain=editGeometry(region,1152,496,768,1344,'contain'),blur=editGeometry(region,1152,496,768,1344,'blur');
 assert.deepEqual(contain.selection,blur.selection);assert.equal(blur.selection.x,230);assert(blur.selection.y>500);assert.equal(blur.denoise,1);
 assert(blur.crop.x<=blur.selection.x&&blur.crop.y<=blur.selection.y);assert(blur.crop.x+blur.crop.width>=blur.selection.x+blur.selection.width);assert(blur.crop.y+blur.crop.height>=blur.selection.y+blur.selection.height);
 assert.throws(()=>editGeometry({x:0,y:0,width:.1,height:.1},1152,496,768,1344,'cover'),/被当前铺满策略裁切/);
 assert.throws(()=>editGeometry({x:0,y:0,width:.01,height:.01},120,40,768,1344,'contain'),/区域过小/);
 assert.throws(()=>editGeometry({x:0,y:0,width:1,height:1},768,1344,768,1344,'contain'),/区域过大/);
});

test('局部合成遮罩严格不向区域外扩散，边缘渐变只作用于内部',()=>{
 const width=20,height=12,value=maskBytes(width,height,{x:5,y:3,width:10,height:6},3),pixels=value.subarray(value.length-width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<5||x>=15||y<3||y>=9)assert.equal(pixels[y*width+x],0);
 assert(pixels[3*width+5]>0&&pixels[3*width+5]<255);assert.equal(pixels[5*width+10],255);
});

test('局部图在独立上下文中重绘，按遮罩回贴原图；不会修改通用图',()=>{
 const original=imageGraph({prompt:'One steak',image:'reference.png',denoise:.38}),before=structuredClone(original),geometry=editGeometry(region,1152,496,768,1344,'blur');
 const graph=editGraph(original,{original:'reference.png',patch:'patch.png',generationMask:'generation-mask.png',compositeMask:'composite-mask.png',geometry});
 assert.deepEqual(original,before);assert.equal(graph['8'].class_type,'VAEEncodeForInpaint');assert.equal(graph['8'].inputs.grow_mask_by,0);assert.equal(graph['5'].inputs.denoise,1);assert.match(graph['3'].inputs.text,/duplicate subject.*rectangular patch/);assert.equal(graph['9'].inputs.image,'patch.png');
 assert.equal(graph['23'].inputs.image,'reference.png');assert.equal(graph['24'].inputs.image,'composite-mask.png');assert.equal(graph['25'].class_type,'ImageCompositeMasked');assert.deepEqual(graph['25'].inputs.destination,['23',0]);assert.deepEqual(graph['7'].inputs.images,['25',0]);
});

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-edit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source.ppm'),w=120,h=40,pixels=Buffer.alloc(w*h*3,70);for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels[(y*w+x)*3]=x;fs.writeFileSync(source,Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),pixels]));const store={data:{settings:{provider:{storyImageProtocol:'comfy',storyImageReferenceFit:'blur'}}},outputDir:()=>root,asset:id=>({id,path:source,type:'image'})},media=new Media(store),generator=new StoryGenerator(store,media,{});return {root,source,store,media,generator};}

test('真实局部准备得到768上下文、黑白生成遮罩和对应尺寸回贴遮罩，原图不变',async t=>{
 const {root,source,generator,media}=fixture(t),digest=()=>crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sha256=digest();
 const base=await generator.preparePrimary({path:source,sha256},root,'9:16',{},'blur'),geometry=editGeometry(region,120,40,768,1344,'blur'),prepared=await prepareEdit(media,base,root,geometry);
 for(const [key,file]of Object.entries(prepared)){const info=await generator.probe(file),stream=info.streams.find(row=>row.width);assert.equal(stream.width,key==='compositeMask'?geometry.crop.width:768);assert.equal(stream.height,key==='compositeMask'?geometry.crop.height:768);}
 const raw=path.join(root,'mask.gray');await runProcess(media.binaries().ffmpeg,['-v','error','-y','-i',prepared.compositeMask,'-frames:v','1','-pix_fmt','gray','-f','rawvideo',raw]);
 const bytes=fs.readFileSync(raw),rowWidth=geometry.crop.width,x0=geometry.selection.x-geometry.crop.x,y0=geometry.selection.y-geometry.crop.y;
 for(let y=0;y<rowWidth;y++)for(let x=0;x<rowWidth;x++)if(x<x0||y<y0||x>=x0+geometry.selection.width||y>=y0+geometry.selection.height)assert.equal(bytes[y*rowWidth+x],0);
 assert.equal(digest(),sha256);
});

test('正式图片计划冻结局部区域，并提前拒绝非法框选，不修改原故事',()=>{
 const draft={id:'draft',confirmed:true,finalText:'介绍扒炉'},story=createStory(draft);draft.story=story;story.assets=[{id:'asset',kind:'prop',name:'扒炉',description:'三旋钮',prompt:'一台扒炉',images:[],selectedImageId:''}];
 const studio=new StoryStudio({store:{data:{runs:[]},draft:()=>draft}});studio.requireFacts=()=>null;
 const before=structuredClone(story),input=studio.imagePlan(story,{id:'draft',assetId:'asset',imageEditRegion:region,instruction:'添加一块牛排'});
 assert.deepEqual(input.imageEditRegion,region);assert.deepEqual(story,before);assert.throws(()=>studio.imagePlan(story,{id:'draft',assetId:'asset',imageEditRegion:{...region,x:2}}),/框选/);
});

test('云端或Z图不能静默忽略局部框选；缺少局部节点时不上传或提交',async t=>{
 const {generator,store}=fixture(t),input={prompt:'一块牛排',aspect:'9:16',references:[{assetId:'reference'}],imageEditRegion:region};let uploads=0,submissions=0;
 generator.comfy.upload=async()=>{uploads++;};generator.executeComfy=async()=>{submissions++;};
 store.data.settings.provider.storyImageProtocol='compatible';await assert.rejects(generator.image(input),/仅支持本地SDXL/);
 store.data.settings.provider={storyImageProtocol:'comfy',storyImageArchitecture:'z-image-turbo'};await assert.rejects(generator.image(input),/仅支持本地SDXL/);
 store.data.settings.provider={};generator.comfy.json=async()=>({CheckpointLoaderSimple:{input:{required:{ckpt_name:[[DEFAULT_CHECKPOINT]]}}},...Object.fromEntries(['KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage'].map(key=>[key,{}]))});
 await assert.rejects(generator.image(input),/局部重绘缺少节点/);assert.equal(uploads,0);assert.equal(submissions,0);
});

test('生成集成上传原图、上下文和两类遮罩，冻结区域后再提交；取消准备不提交',async t=>{
 const {generator,source}=fixture(t),before=fs.readFileSync(source),uploads=[],input={prompt:'一块牛排放在炉面',instruction:'只在炉面新增一块牛排并移除铲子',aspect:'9:16',references:[{assetId:'reference'}],imageEditRegion:region};
 generator.comfy.json=async()=>({CheckpointLoaderSimple:{input:{required:{ckpt_name:[[DEFAULT_CHECKPOINT]]}}},...Object.fromEntries(['KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage','VAEEncodeForInpaint','LoadImageMask','ImageScale','ImageCompositeMasked'].map(key=>[key,{}]))});
 generator.comfy.upload=async(_base,file)=>{assert(fs.statSync(file).size>10);uploads.push(path.basename(file));return {subfolder:'frozen',name:path.basename(file)};};let submitted=0;
 generator.executeComfy=async remote=>{submitted++;assert.deepEqual(remote.input.imageEditRegion,region);assert(remote.graph['2'].inputs.text.startsWith('局部重绘目标：'+input.instruction));assert.equal(remote.imageEditing.policy,'focused-inpaint-composite-outside-selection-preserved');assert.equal(remote.imageEditing.denoise,1);assert.equal(remote.graph['23'].inputs.image,'frozen/primary-reference.png');assert.equal(remote.graph['21'].inputs.image,'frozen/edit-generation-mask.png');assert.equal(remote.graph['25'].inputs.x,remote.imageEditing.crop.x);return {id:'candidate-only'};};
 await generator.image(input);assert.equal(submitted,1);assert.deepEqual(uploads,['primary-reference.png','edit-patch.png','edit-generation-mask.png','edit-composite-mask.png']);assert.deepEqual(fs.readFileSync(source),before);
 const controller=new AbortController();generator.comfy.upload=async()=>{controller.abort();return {subfolder:'cancelled',name:'source.png'};};await assert.rejects(generator.image(input,{signal:controller.signal}),/abort/i);assert.equal(submitted,1);
});
