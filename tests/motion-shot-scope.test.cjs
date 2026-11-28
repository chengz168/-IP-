const test=require('node:test'),assert=require('node:assert/strict');
const {scopeMotionSource}=require('../server/motion-shot-scope.cjs');
const {compileProductMotion}=require('../server/product-prompt.cjs');
const {h3Prompt,referenceVideoPrompt}=require('../server/story-generator.cjs');
test('单镜剔除整集编排而保留外观、安全边界和原始审计',async()=>{
 const source={visual:'女性胸像，画面没有电脑。',action:'只眨眼一次。',camera:'固定近景。',sound:'静音。',style:'柔和窗光，保持肤色；中景和近景交替，无品牌。',storyInstructions:'正文只作画外解说。整集围绕电脑办公和材料核对两个场景。只需一个女性、一处办公室和一台电脑，尽量共用这三项资产。四个镜头使用不同景别：开场电脑、侧脸、窗口、核对。禁止画面内出现字幕。',instruction:'只生成当前女性胸像。'};
 const before=structuredClone(source),scoped=scopeMotionSource(source);assert.equal(scoped.omitted.length,4);assert.deepEqual(source,before);
 let sent;const result=await compileProductMotion({text:async(_system,user)=>{sent=JSON.parse(user);return {text:JSON.stringify({prompt:'A woman blinks in a fixed close shot.'})};}},{approvedStoryDesign:source,prompt:'旧提示',storyInstructions:source.storyInstructions,style:source.style,instruction:source.instruction,duration:7.67,aspect:'16:9',image:{assetId:'first'},lastFrame:{assetId:'last'}},{progress(){}});
 assert.deepEqual(result.promptCompilation.source,before);assert.match(sent.storyInstructions,/禁止画面内出现字幕/);assert.match(sent.style,/柔和窗光/);assert.match(sent.style,/无品牌/);
 for(const prompt of [h3Prompt(result),referenceVideoPrompt({...result,lastFrame:undefined},[{kind:'character',name:'女性'}])]){assert.doesNotMatch(prompt,/整集围绕|四个镜头|共用这三项资产|中景和近景交替/);assert.match(prompt,/只眨眼一次/);assert.match(prompt,/禁止画面内出现字幕/);}
});
test('本镜动作、跨镜一致性与禁止切镜的规则不被误删',()=>{
 const source={style:'自然肤色，无重影。',storyInstructions:'所有镜头保持同一人物服装。禁止中景和近景交替。产品三个旋钮，保持商标。',action:'人物先看纸张，然后看向窗户。',camera:'从中景缓慢推到近景。'};
 const result=scopeMotionSource(source);assert.deepEqual(result.effective,source);assert.deepEqual(result.omitted,[]);
});
test('句中否定和混合硬性约束宁可保留，不扩大删除范围',()=>{
 const source={style:'色彩自然，不要中景和近景交替。',storyInstructions:'四个镜头使用不同景别：必须保持同一人物衣服和身份。'};
 assert.deepEqual(scopeMotionSource(source).effective,source);
});

test('全片主题、统一道具和产品特征不是跨镜编排',()=>{
 const source={style:'统一柔光，中景和近景交替，无品牌。',storyInstructions:'全片围绕年轻人的工作压力。全片包含一个红色马克杯。整集围绕一台深蓝色电脑展开。'};
 const result=scopeMotionSource(source);
 assert.equal(result.effective.storyInstructions,source.storyInstructions);
 assert.equal(result.effective.style,'统一柔光，无品牌。');
 assert.equal(result.omitted.length,1);
});

test('本镜排除电脑时移开屏幕内容描述，保留文字禁令和原始输入',()=>{
 const source={visual:'画面不出现电脑、手部或其他人物。',storyInstructions:'屏幕为模糊的块状文档，不生成可读文字或数字；禁止图表证明真实收入变化。'};
 const result=scopeMotionSource(source);
 assert.equal(result.effective.storyInstructions,'不生成可读文字或数字；禁止图表证明真实收入变化。');
 assert.match(source.storyInstructions,/屏幕为/);
 assert.equal(result.omitted[0].reason,'本镜明确排除的显示设备内容');
 const shown={...source,visual:'女人面前有一台电脑。'};
 assert.deepEqual(scopeMotionSource(shown).effective,shown);
 const ambiguous={...source,visual:'没有水印，桌面有一台电脑。'};
 assert.deepEqual(scopeMotionSource(ambiguous).effective,ambiguous);
 const protectedSource={...source,storyInstructions:'屏幕显示必须保持隐私遮挡。'};
 assert.deepEqual(scopeMotionSource(protectedSource).effective,protectedSource);
});
