const test=require('node:test'),assert=require('node:assert/strict');
const {compileProductMotion}=require('../server/product-prompt.cjs');
const {validPrompt,h3Prompt,referenceVideoPrompt}=require('../server/story-generator.cjs');
const {wanGraph}=require('../server/story-wan.cjs');
const {hash}=require('../server/story-contract.cjs');

// 验证真实图输入保留审核原文，不把契约检查当作模型保真验收。
for(const product of [false,true])test((product?'商品':'普通')+'镜头的最终指令保留被译文遗漏的源约束与优先级',async()=>{
 const design={visual:'平整炉面中央一块牛排，栅格仅在后方，三个旋钮。',action:'牛排保持原位，不翻面、不变形，不新增工具。',camera:'固定机位，不推近。',sound:'低环境声，无对白。',style:'自然写实。',referenceFacts:{product:'银色扒炉'},storyInstructions:'保持商品结构。',instruction:'输出完全静音画面，旁白后期使用第三步配音。',supplementaryPrompt:'OUTDATED_SUPPLEMENT_ONLY'};
 const input={prompt:'OLD_PROMPT_ONLY',duration:5,aspect:'9:16',image:{assetId:'frame'},instruction:design.instruction,storyInstructions:design.storyInstructions,...(product?{productIntroduction:{version:1},approvedProductDesign:design}:{approvedStoryDesign:design})};
 const before=structuredClone(input),translated='A griddle with a steak. Low ambient sounds.';
 const out=await compileProductMotion({text:async()=>({text:JSON.stringify({prompt:translated})})},input,{progress(){}});
 assert.deepEqual(input,before);assert(out.prompt.startsWith(translated));
 assert.equal(out.promptCompilation.sourceHash,hash(design));assert.equal(out.promptCompilation.retentionVersion,1);assert.equal(out.promptCompilation.qualityAccepted,false);
 assert.equal(out.promptCompilation.retainedSource.action,design.action);
 assert(!Object.hasOwn(out.promptCompilation.retainedSource,'supplementaryPrompt'));
 const prompts=[validPrompt(out),h3Prompt(out),referenceVideoPrompt(out,[{kind:'prop',name:'扒炉'}]),wanGraph({input:out,image:'confirmed.png',prompt:validPrompt(out)})['4'].inputs.text];
 for(const prompt of prompts){for(const key of ['visual','action','camera','sound','instruction'])assert(prompt.includes(design[key]),key+'原文丢失');assert(!prompt.includes('OLD_PROMPT_ONLY'));assert(!prompt.includes('OUTDATED_SUPPLEMENT_ONLY'));assert.match(prompt,/explicit current instruction before older saved requirements/);assert.match(prompt,/follow the original source requirement/);}
});

test('未启用中文编译的历史输入保持原样，不为旧任务补签来源',async()=>{
 const input={prompt:'旧冻结任务',duration:5,aspect:'9:16'};
 const out=await compileProductMotion({text:async()=>{throw Error('不应调用翻译');}},input,{progress(){}});
 assert.equal(out,input);assert(!out.promptCompilation);
});

test('Wan无音轨能力只改变翻译副本，原声音留档且显式对白仍被门禁拒绝',async()=>{
 const source={visual:'平整炉面中央一块牛排。',action:'牛排不变形。',camera:'固定机位。',sound:'低环境声及金属声。',instruction:'输出静音画面，旁白后期合成。'};
 const input={prompt:'扒炉',duration:5,aspect:'9:16',image:{assetId:'frame'},wanRecipe:{architecture:'wan22-ti2v-5b'},approvedStoryDesign:source};
 let translatedInput;const providers={text:async(system,user)=>{translatedInput=JSON.parse(user);assert.match(system,/没有音轨，只编译视觉画面/);return {text:JSON.stringify({prompt:'One steak on a flat griddle. Static camera.'})};}};
 const out=await compileProductMotion(providers,input,{progress(){}});
 assert.equal(source.sound,'低环境声及金属声。');assert.equal(out.promptCompilation.source.sound,source.sound);assert(!Object.hasOwn(out.promptCompilation.retainedSource,'sound'));assert.match(translatedInput.sound,/无音轨/);assert.equal(out.promptCompilation.audioPolicy,'silent-narration-in-post');
 assert.match(wanGraph({input:out,image:'frame.png',prompt:validPrompt(out)})['4'].inputs.text,/video without an audio track/);
 const rejected=await compileProductMotion(providers,{...input,approvedStoryDesign:{...source,sound:'现场原声对白。'}},{progress(){}});
 assert.throws(()=>wanGraph({input:rejected,image:'frame.png',prompt:validPrompt(rejected)}),/不支持显式对白/);
});

test('H3剧情保留中文对白，不受Wan无音轨策略影响',async()=>{
 const sound='女子在第三秒说道：“已经准备好了。”，保留自然环境声。';
 const out=await compileProductMotion({text:async(_system,user)=>{assert.equal(JSON.parse(user).sound,sound);return {text:JSON.stringify({prompt:'A woman stands beside the table.'})};}},{prompt:'剧情',aspect:'9:16',duration:5,approvedStoryDesign:{visual:'女子站在桌旁。',action:'抬头说话。',camera:'固定机位。',sound}},{progress(){}});
 assert(h3Prompt(out).includes(sound));assert.equal(out.promptCompilation.audioPolicy,'source-requirements');assert.doesNotMatch(out.prompt,/This frozen Wan recipe/);
});

test('源块导致超长时明确拒绝，不能静默截断末尾约束',async()=>{
 const action='保持原位，不变形。'.repeat(4000)+'不得新增工具。';
 const out=await compileProductMotion({text:async()=>({text:JSON.stringify({prompt:'A static griddle.'})})},{prompt:'扒炉',duration:5,aspect:'9:16',image:{assetId:'frame'},approvedStoryDesign:{visual:'扒炉',action,camera:'固定',sound:'无对白'}},{progress(){}});
 assert(out.prompt.includes(action));assert.throws(()=>validPrompt(out),/生成要求过长/);assert.throws(()=>wanGraph({input:out,image:'frame.png'}),/长度不得超过32000字符/);
});
