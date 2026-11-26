const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {StoryStudio}=require('../server/story-studio.cjs');
const {createStory,hash,assetInput,shotInput}=require('../server/story-contract.cjs');
const {StoryGenerator,validPrompt,h3Prompt,referenceVideoPrompt,PROMPT_COMPILER_VERSION}=require('../server/story-generator.cjs');
const {compileProductMotion}=require('../server/product-prompt.cjs');

const globalText='保留C的画外旁白；画面只拍操作手部，不得出现男性对口型。';
const localText='本次动作放慢，保持商品完整。';
function fixture(product=false){
 const draft={id:'draft',confirmed:true,finalText:'介绍金属扒炉'};
 const story=createStory(draft);story.instructions=globalText;
 story.assets=[{id:'asset',kind:'prop',name:'扒炉',description:'金属烤面',prompt:'扒炉静物',images:[{id:'legacy-image',status:'ready'}],selectedImageId:'legacy-image'}];
 story.episodes=[{id:'episode',text:draft.finalText,shots:[{id:'shot',text:draft.finalText,visual:'工作台上的扒炉',action:'用铲子清理烤面',camera:'固定近景',sound:'自然环境声，无对白',duration:5,imagePrompt:'工作台与扒炉近景',videoPrompt:'清洁金属烤面',assetIds:[],selectedImageId:'frame',videos:[],images:[]}]}];
 if(product)story.productIntroduction={version:1,productHash:'product-hash'};
 draft.story=story;const calls=[];
 const studio=new StoryStudio({store:{data:{runs:[]},draft:()=>draft},runtime:{run:async(_type,_id,args,work)=>{calls.push({kind:'run',input:args.input});return work({signal:new AbortController().signal,progress(){}});}},providers:{text:async(system,user)=>{calls.push({kind:'translation',system,source:JSON.parse(user)});return {text:JSON.stringify({prompt:'A static close shot of a metal griddle being cleaned.'})};}},generator:{video:async input=>{calls.push({kind:'video',input});return {id:'new-video',type:'video'};}}});
 // 隔离上下游状态，仅验证真实计划构造、翻译和最终提示编译，不访问正式Store。
 studio.ready=()=>structuredClone(story);studio.story=()=>structuredClone(story);studio.requireFacts=()=>null;studio.referenceFacts=()=>null;studio.assertMutable=()=>{};studio.sourceCurrent=()=>true;studio.write=(_id,value)=>value;
 return {studio,story,calls,args:{id:'draft',episodeId:'episode',shotId:'shot'}};
}

test('图片计划独立携带全局与局部要求，不改写旧候选或资产摘要',()=>{
 const f=fixture(),before=structuredClone(f.story),oldHash=hash(assetInput(f.story,f.story.assets[0]));
 const input=f.studio.imagePlan(f.story,{id:'draft',assetId:'asset',instruction:localText});
 assert.equal(input.storyInstructions,globalText);assert.equal(input.instruction,localText);
 const prompt=validPrompt(input);assert(prompt.includes('Global story requirements: '+globalText));assert(prompt.includes('Additional requirements: '+localText));
 assert.deepEqual(f.story,before);assert.equal(input.inputHash,oldHash);
});

test('普通动态镜头和两种H3提示都收到完整全局要求，局部要求语义保持',async()=>{
 const f=fixture(),beforeHash=hash(shotInput(f.story,f.story.episodes[0].shots[0]));
 await f.studio.generateVideo({...f.args,instruction:localText});
 const input=f.calls.find(row=>row.kind==='video').input;
 assert.equal(input.storyInstructions,globalText);assert.equal(input.instruction,localText);
 for(const prompt of [validPrompt(input),h3Prompt(input),referenceVideoPrompt(input,[{kind:'prop',name:'扒炉'}])]){
  assert(prompt.includes('Global story requirements: '+globalText));assert(prompt.includes('Additional requirements: '+localText));
 }
 assert.equal(hash(shotInput(f.story,f.story.episodes[0].shots[0])),beforeHash);
});

test('商品翻译源及其摘要包含全局要求，翻译漏译时最终编译仍保留原文约束',async()=>{
 const f=fixture(true),result=await f.studio.generateVideo({...f.args,instruction:localText});
 const source=f.calls.find(row=>row.kind==='translation').source,input=f.calls.find(row=>row.kind==='video').input;
 assert.equal(source.storyInstructions,globalText);assert.equal(source.instruction,localText);
 assert.deepEqual(result.promptCompilation.source,source);assert.equal(result.promptCompilation.sourceHash,hash(source));
 assert.equal(input.storyInstructions,globalText);assert.equal(input.instruction,'');
 assert(validPrompt(input).includes(globalText));assert.equal(result.candidate.instruction,localText);
 assert.equal(result.promptCompilation.qualityAccepted,false);
});

test('没有全局字段的旧输入保持原提示，非法或超长全局要求提前拒绝',()=>{
 const input={prompt:'金属扒炉',aspect:'9:16',instruction:localText};
 assert.equal(validPrompt(input),validPrompt({...input,storyInstructions:''}));
 assert(!validPrompt(input).includes('Global story requirements:'));
 for(const storyInstructions of [null,{},1,'长'.repeat(5001)])assert.throws(()=>validPrompt({...input,storyInstructions}),/全局补充要求/);
});

test('新任务记录编译版本，登记及恢复旧任务不补签该版本',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'story-global-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store={data:{assets:[],settings:{provider:{storyImageProtocol:'compatible'}}},outputDir:()=>root,save(){},addAsset:(_file,metadata)=>({id:'asset',...metadata})};
 const generator=new StoryGenerator(store,{},{}),original={prompt:'金属扒炉',aspect:'9:16',duration:5,storyInstructions:globalText,instruction:localText};
 generator.cloudImage=async(input,prompt)=>({input,prompt});
 const image=await generator.image(original);assert.equal(image.input.promptCompilerVersion,PROMPT_COMPILER_VERSION);assert(image.prompt.includes(globalText));
 generator.referenceVideo=async input=>input;
 const video=await generator.video({...original,referenceMode:'assets'});assert.equal(video.promptCompilerVersion,PROMPT_COMPILER_VERSION);
 assert(!Object.hasOwn(original,'promptCompilerVersion'));
 const file=path.join(root,'fixture.bin');fs.writeFileSync(file,'独立登记夹具');generator.verify=async()=>({});
 const modern=await generator.register(file,'video',video,{}),oldInput={prompt:'旧输入',aspect:'9:16'};
 assert.equal(modern.storyGeneration.storyInstructions,globalText);assert.equal(modern.storyGeneration.promptCompilerVersion,PROMPT_COMPILER_VERSION);assert.equal(modern.storyGeneration.qualityAccepted,false);
 const legacy=await generator.register(file,'video',oldInput,{});assert(!Object.hasOwn(legacy.storyGeneration,'promptCompilerVersion'));assert(!Object.hasOwn(legacy.storyGeneration,'storyInstructions'));
 generator.executeComfy=async remote=>remote.input;
 const recovered=await generator.recover({remoteId:'original-task',remote:{kind:'story-comfy-video-v1',input:oldInput}});
 assert.equal(recovered,oldInput);assert(!Object.hasOwn(recovered,'promptCompilerVersion'));
});

test('商品独立编译调用也将全局要求加入可审计源，不修改调用方审核字段',async()=>{
 const approved={visual:'扒炉',action:'清理烤面',camera:'固定',sound:'无对白',instruction:localText},before=structuredClone(approved);
 const result=await compileProductMotion({text:async(_system,user)=>{assert.equal(JSON.parse(user).storyInstructions,globalText);return {text:JSON.stringify({prompt:'A close shot of a griddle.'})};}},{productIntroduction:{},approvedProductDesign:approved,storyInstructions:globalText},{progress(){}});
 assert.deepEqual(approved,before);assert.equal(result.promptCompilation.source.storyInstructions,globalText);assert.equal(result.storyInstructions,globalText);
});
