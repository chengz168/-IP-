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
 assert.equal(out.promptCompilation.sourceHash,hash(design));assert.equal(out.promptCompilation.retentionVersion,2);assert.equal(out.promptCompilation.qualityAccepted,false);
 assert.equal(out.promptCompilation.retainedSource.action,design.action);
 assert(!Object.hasOwn(out.promptCompilation.retainedSource,'supplementaryPrompt'));
 const prompts=[validPrompt(out),h3Prompt(out),referenceVideoPrompt(out,[{kind:'prop',name:'扒炉'}]),wanGraph({input:out,image:'confirmed.png',prompt:validPrompt(out)})['4'].inputs.text];
 for(const prompt of prompts){for(const key of ['visual','action','camera','sound','instruction'])assert(prompt.includes(design[key]),key+'原文丢失');assert(!prompt.includes('OLD_PROMPT_ONLY'));assert(!prompt.includes('OUTDATED_SUPPLEMENT_ONLY'));assert.match(prompt,/explicit current instruction before older saved requirements/);assert.match(prompt,/follow the original source requirement/);}
});

test('明确固定机位覆盖只改变有效来源，审计原文不变且最终Wan节点不再含旧运镜',async()=>{
 const directive='固定机位，不平移、不推拉、不旋转、不切镜，仅有轻微自然亮度起伏。';
 const design={visual:'围挡转角的扒炉微距，商品保持原有结构。',action:'镜头沿围挡向前滑动10厘米并停在转角，物体保持静止和刚性，不新增人物或工具。',camera:'镜头沿围挡向前滑动10厘米并停在转角。',sound:'无对白，旁白后期合成。',instruction:directive,supplementaryPrompt:'镜头沿围挡向前滑动10厘米。'};
 const input={prompt:'包含旧运镜的历史提示',duration:5,aspect:'9:16',image:{assetId:'frame'},instruction:directive,wanRecipe:{architecture:'wan22-ti2v-5b'},approvedStoryDesign:design};
 let translatedSource;
 const out=await compileProductMotion({text:async(_system,user)=>{translatedSource=JSON.parse(user);return {text:JSON.stringify({prompt:'A close view of the griddle corner. The camera remains fixed. Subtle natural brightness variation.'})};}},{...input,wanRecipe:undefined},{progress(){}});
 assert.deepEqual(out.promptCompilation.source,design);assert.equal(out.promptCompilation.sourceHash,hash(design));
 assert.match(out.promptCompilation.effectiveSource.camera,/固定机位，不平移、不推拉、不旋转/);assert.equal(out.promptCompilation.effectiveSource.action,'物体保持静止和刚性，不新增人物或工具。');
 assert.equal(out.promptCompilation.effectiveSourceHash,hash(out.promptCompilation.effectiveSource));
 assert.equal(out.promptCompilation.resolution.rule,'explicit-static-camera-v1');assert.equal(out.promptCompilation.resolution.overrides[0].overridden,design.camera);assert.equal(out.promptCompilation.resolution.overrides[1].field,'action');assert.equal(out.promptCompilation.resolution.overrides[1].overridden,'镜头沿围挡向前滑动10厘米并停在转角');
 assert.match(translatedSource.camera,/固定机位/);assert.doesNotMatch(translatedSource.camera,/[,，；;。]\s*[；;]/u);assert(!Object.hasOwn(translatedSource,'supplementaryPrompt'));
 assert(!out.prompt.includes('沿围挡向前滑动10厘米'));assert(out.promptCompilation.source.camera.includes('沿围挡向前滑动10厘米'));
 const node4=wanGraph({input:out,image:'confirmed.png',prompt:validPrompt(out)})['4'].inputs.text;
 assert(!node4.includes('沿围挡向前滑动10厘米'));assert(node4.includes('固定机位，不平移、不推拉、不旋转'));
});

test('第9镜完整修改要求中的画外“或”不触发机位不确定，构图与静止主体动作保留',async()=>{
 const instruction='只使用已审查的右前角局部图作为唯一首帧。它只代表画内局部，不补全画外整机、其他旋钮、隐藏侧面或焊缝。画内可见炉面、右围挡、前沿转角、局部面板、圆形控制件、部分后沿竖槽及绿色地面与青色灯带；全部保持位置、轮廓、比例与原有金属表面反光。固定机位，不平移、不推拉、不旋转、不切镜；仅有极轻微自然反光亮度起伏，不移动高光位置。无人物、无手、无工具、无字幕、水印和额外物件。只输出静音画面，第三步C旁白在后期合成。';
 const design={visual:'扒炉右侧围挡和前沿交接转角特写，连续金属边界清楚，不额外表现未经核实的焊接方式。',action:'镜头沿围挡向前滑动10厘米并停在转角，物体保持静止和刚性。',camera:'转角微距，单一短距离滑动。',sound:'仅低水平室内环境声及与动作一致的金属/布料声音，无人声、对白和音乐。',style:'自然写实的工厂产品介绍，保持实物外观，金属细节自然，无夸张美化。',supplementaryPrompt:'按当前中文画面、动作、运镜执行。保持商品结构，不增加零件。',storyInstructions:'固定产品三旋钮与围挡结构，不加显示屏。生成不包含文字、字幕、数字刻度、水印、对白或音乐。',instruction};
 let translatedSource,calls=0;
 const out=await compileProductMotion({text:async(_system,user)=>{calls++;translatedSource=JSON.parse(user);return {text:JSON.stringify({prompt:'A close-up of the griddle corner. The camera remains fixed with no pan, push, pull, rotation, or cut. The object remains still and rigid.'})};}},{prompt:'右前角',duration:9.5,aspect:'9:16',image:{assetId:'frame'},instruction,storyInstructions:design.storyInstructions,approvedStoryDesign:design},{progress(){}});
 assert.equal(calls,1);assert.deepEqual(out.promptCompilation.source,design);assert.equal(out.promptCompilation.sourceHash,hash(design));
 assert.match(translatedSource.camera,/转角微距/);assert.match(translatedSource.camera,/固定机位/);assert.doesNotMatch(translatedSource.camera,/[,，；;。]\s*[；;]/u);assert.equal(translatedSource.action,'物体保持静止和刚性。');
 assert(!JSON.stringify(out.promptCompilation.effectiveSource).includes('向前滑动10厘米'));assert.match(out.promptCompilation.effectiveSource.instruction,/隐藏侧面或焊缝/);
 assert(!validPrompt(out).includes('向前滑动10厘米'));assert.match(validPrompt(out),/隐藏侧面或焊缝/);
 const node4=wanGraph({input:out,image:'confirmed.png',prompt:validPrompt(out)})['4'].inputs.text;
 assert(!node4.includes('向前滑动10厘米'));assert.match(node4,/固定机位，不平移、不推拉、不旋转/);assert.match(node4,/隐藏侧面或焊缝/);
});

test('固定机位冲突有条件或主体运镜混写时不调用翻译器',async()=>{
 const base={visual:'一个扒炉转角。',action:'商品保持刚性。',camera:'镜头沿围挡向前滑动10厘米。',sound:'无对白。'};
 for(const [instruction,action] of [
  ['如果固定机位就不要推拉，之后再移动镜头。',base.action],
  ['固定机位，不平移、不推拉、不旋转。','镜头沿围挡移动时商品保持刚性。'],
 ]){
  let calls=0;await assert.rejects(compileProductMotion({text:async()=>{calls++;return {text:'{}'};}},{prompt:'转角',duration:5,aspect:'9:16',instruction,approvedStoryDesign:{...base,action}},{progress(){}}),/机位要求与已保存运镜存在冲突/);assert.equal(calls,0);
 }
});

test('固定机位覆盖下译文仍正向要求相机移动时阻止生成',async()=>{
 const instruction='固定机位，不平移、不推拉、不旋转。';
 await assert.rejects(compileProductMotion({text:async()=>({text:JSON.stringify({prompt:'The camera tracks forward along the fence.'})})},{prompt:'转角',duration:5,aspect:'9:16',instruction,approvedStoryDesign:{visual:'围挡转角。',action:'扒炉保持静止。',camera:'镜头向前滑动10厘米。',sound:'无对白。'}},{progress(){}}),/镜头指令译文仍包含/);
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
