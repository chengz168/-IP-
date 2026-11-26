const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vue=require('vue'),{parse}=require('@vue/compiler-sfc'),{compile}=require('@vue/compiler-dom'),{renderToString}=require('@vue/server-renderer');
const source=fs.readFileSync(path.resolve(__dirname,'../src/components/StoryStudio.vue'),'utf8'),{descriptor}=parse(source);

async function renderFragment(template,context){
 const {storySelectedCandidate}=await import('../src/story-ui.mjs');
 const compiled=compile(template,{mode:'function',prefixIdentifiers:true}).code,render=new Function('Vue',compiled)(vue);
 return renderToString(vue.createSSRApp({components:{I:{render:()=>vue.h('span')}},setup:()=>({selectedReady:node=>storySelectedCandidate(node,'image',undefined,undefined,'reference'),...context}),render}));
}
const planningBinding=descriptor.template.content.match(/<fieldset class="story-bindings"><legend>绑定本镜头资产<\/legend>[\s\S]*?<\/fieldset>/)?.[0];
const base=()=>({story:{assets:[{id:'stove',kind:'prop',name:'扒炉',selectedImageId:'stove-image'}]},shot:{assetIds:['stove']},locked:false,boundAssets:[{id:'stove',name:'扒炉',kind:'prop'}],storyKindLabel:{prop:'道具'},setBinding(){},primaryReference:'stove',localImage:true,textOnlyImage:true,assetReferenceMode:false});

test('分集绑定区域按当前资产参考模式渲染，不要求改图片模型或确认首帧',async()=>{
 assert(planningBinding);const html=await renderFragment(planningBinding,{...base(),assetReferenceMode:true});assert.match(html,/当前为资产参考模式/);assert.match(html,/直接用于本地 H3 视频生成/);assert.match(html,/不需要单独生成首帧/);assert.match(html,/构图参考限制不影响此模式/);assert.doesNotMatch(html,/首帧模式下|本地构图主参考|可选用已有首帧|切换支持参考的图片模型/);
});

test('首帧模式的Z图限制仍可见，明确限制的是构图图生成',async()=>{
 const html=await renderFragment(planningBinding,base());assert.match(html,/首帧模式下，Z-Image 仅支持文生图/);assert.match(html,/不能使用绑定参考图生成构图图/);assert.match(html,/可选用已有首帧/);assert.doesNotMatch(html,/当前为资产参考模式|本地构图主参考/);
});

test('SDXL与云图片的构图说明不泄漏到资产参考模式',async()=>{
 const sdxl=await renderFragment(planningBinding,{...base(),textOnlyImage:false});assert.match(sdxl,/本地构图主参考/);assert.match(sdxl,/仅主参考图片参与图生图/);
 const cloud=await renderFragment(planningBinding,{...base(),textOnlyImage:false,localImage:false});assert.match(cloud,/首帧模式下，云端兼容图片接口/);assert.doesNotMatch(cloud,/本地构图主参考/);
 const assetCloud=await renderFragment(planningBinding,{...base(),assetReferenceMode:true,textOnlyImage:false,localImage:false});assert.match(assetCloud,/当前为资产参考模式/);assert.doesNotMatch(assetCloud,/云端兼容图片接口|本地构图主参考/);
});

test('无镜头空状态同时解释两种参考方式，不把确认构图设成唯一入口',async()=>{
 const empty=descriptor.template.content.match(/<div v-else class="story-empty card"><I name="Video"[\s\S]*?<\/div>/)?.[0];assert(empty);const html=await renderFragment(empty.replace('<div v-else','<div'),{tab:'videos'});assert.match(html,/首帧模式先确认构图图/);assert.match(html,/资产参考模式绑定并确认资产图后，直接生成动态视频/);assert.doesNotMatch(html,/依次确认构图图并生成动态视频/);
});
