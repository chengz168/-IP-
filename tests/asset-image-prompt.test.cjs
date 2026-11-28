const {test}=require('node:test'),assert=require('node:assert/strict');
const {assetImagePrompt}=require('../server/asset-image-prompt.cjs');
test('独立电脑资产不继承整片人物和分镜，保留该资产外观、风格与修订',()=>{
 const input={target:{kind:'asset'},assetDefinition:{kind:'prop',name:'便携电脑',description:'银灰色折叠机身'},prompt:'单台电脑，屏幕纯灰',style:'自然窗光，暖灰配色',instruction:'取消品牌与外接键盘',storyInstructions:'四个镜头：三人会议、人物特写、分屏办公与同框讨论',creativePreset:{rules:['人物面对镜头']}};
 const output=assetImagePrompt(input);assert.match(output,/银灰色折叠机身/);assert.match(output,/自然窗光/);assert.match(output,/取消品牌与外接键盘/);assert.doesNotMatch(output,/三人会议|人物特写|人物面对镜头/);assert.match(output,/Do not add people/);assert.equal(input.storyInstructions,'四个镜头：三人会议、人物特写、分屏办公与同框讨论');
});
test('角色图和场景图各用自身范围，镜头图仍沿用已有完整编译',()=>{
 const base={target:{kind:'asset'},prompt:'外观描述'};
 assert.match(assetImagePrompt({...base,assetDefinition:{kind:'character'}}),/designated character/);
 assert.match(assetImagePrompt({...base,assetDefinition:{kind:'scene'}}),/designated environment/);
 assert.equal(assetImagePrompt({...base,target:{kind:'shot'}}),null);
 assert.equal(assetImagePrompt({prompt:'历史无目标输入'}),null);
 assert.throws(()=>assetImagePrompt({...base,assetDefinition:{kind:'invalid'}}),/类型无效/);
});
test('实际SDXL工作流提交采用资产范围，远程记录仍保留原全局要求',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{StoryGenerator,DEFAULT_CHECKPOINT}=require('../server/story-generator.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-prompt-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store={data:{settings:{provider:{storyImageProtocol:'comfy'}}},outputDir:()=>root};
 const generator=new StoryGenerator(store,{},{});generator.comfy.json=async()=>({CheckpointLoaderSimple:{input:{required:{ckpt_name:[[DEFAULT_CHECKPOINT]]}}},...Object.fromEntries(['KSampler','CLIPTextEncode','EmptyLatentImage','VAEDecode','VAEEncode','LoadImage','SaveImage'].map(name=>[name,{}]))});
 let captured;generator.executeComfy=async remote=>(captured=remote,{id:'图像协议夹具'});
 await generator.image({target:{kind:'asset',assetId:'laptop'},assetDefinition:{kind:'prop',name:'电脑',description:'银灰'},prompt:'单台笔记本',storyInstructions:'剧情里有三人会议和拼贴',aspect:'16:9'});
 assert.match(captured.graph['2'].inputs.text,/单台笔记本/);assert.doesNotMatch(captured.graph['2'].inputs.text,/三人会议和拼贴/);assert.equal(captured.input.storyInstructions,'剧情里有三人会议和拼贴');assert.equal(captured.input.assetDefinition.kind,'prop');
});
