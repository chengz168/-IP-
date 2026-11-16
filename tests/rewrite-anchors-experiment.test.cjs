const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../scripts/experiments/rewrite-anchors.mjs');
test('实验锚点拒绝漏分句、杜撰引用和空短语，不能只凭JSON格式接受',async()=>{
 const {anchorPlan,parseAnchorPlan}=await load(),plan=anchorPlan('整理时先打开盒子。把同一主题的卡片放到一起，再给每组写一个小标题。',48),make=()=>({anchors:{u1c1:['同一主题'],u1c2:['每组','一个小标题']}});
 assert.equal(parseAnchorPlan(plan,make()).length,2);
 for(const value of [{},[],{anchors:{}},{...make(),other:true},{anchors:{u1c1:['同一类型'],u1c2:['每组']}},{anchors:{u1c1:[''],u1c2:['每组']}},{anchors:{u1c1:['同一主题','同一主题'],u1c2:['每组']}}])assert.throws(()=>parseAnchorPlan(plan,value),/格式|编号|原文引用/);
});
test('编号和数字完整仍须拒绝未保留的普通修饰短语',async()=>{
 const {anchorPlan,parseAnchorPlan,assembleAnchoredRewrite}=await load(),plan=anchorPlan('台灯使用USB供电。先确认桌边有可用电源，再给底座留出位置。',45),anchors=parseAnchorPlan(plan,{anchors:{u1c1:['可用电源'],u1c2:['底座']}});
 assert.throws(()=>assembleAnchoredRewrite(plan,anchors,{units:{u1:'放之前先看桌边有没有插座，再给底座腾地方。'}}),/未保留关键短语：可用电源/);
 assert.ok(assembleAnchoredRewrite(plan,anchors,{units:{u1:'摆放前，桌边的可用电源先确认好，再为底座留出位置。'}}).text.includes('可用电源'));
});
test('原文、清单和回包不被本地组装改写，失败没有原句偷偷回填',async()=>{
 const {anchorPlan,parseAnchorPlan,assembleAnchoredRewrite}=await load(),plan=anchorPlan('开箱先摆好卡片。用自己的话复述，再把卡片收回对应的位置。',35),value={anchors:{u1c1:['自己的话','复述'],u1c2:['对应的位置']}};
 const anchors=parseAnchorPlan(plan,value),response={units:{u1:'换个说法讲一遍，再把卡片放回原位。'}},before=JSON.stringify({plan,anchors,response,value});
 assert.throws(()=>assembleAnchoredRewrite(plan,anchors,response),/关键短语/);assert.equal(JSON.stringify({plan,anchors,response,value}),before);
});
test('预先取消不调用模型，第一请求后取消不再提交第二请求',async()=>{
 const {generateAnchoredRewrite}=await load(),input={fields:{sourceText:'先摆好卡片。用自己的话复述。',wordLimit:20},template:{content:'保留内容'},generation:{model:'local'}},before=new AbortController();before.abort();let calls=0;
 const provider={text:async()=>{calls++;return {text:'{"anchors":{"u1c1":["自己的话"]}}'};}};await assert.rejects(generateAnchoredRewrite(provider,input,{signal:before.signal}),/abort/i);assert.equal(calls,0);
 const after=new AbortController();provider.text=async()=>{calls++;after.abort();return {text:'{"anchors":{"u1c1":["自己的话"]}}'};};await assert.rejects(generateAnchoredRewrite(provider,input,{signal:after.signal}),/abort/i);assert.equal(calls,1);
});
test('锚点原始请求与实际改写回包分别留证，system正文不混入额外包装',async()=>{
 const {generateAnchoredRewrite}=await load(),input={fields:{sourceText:'先摆好卡片。用自己的话复述。',wordLimit:20},template:{content:'原厂可见模板逐字保留'},generation:{model:'local'}},seen=[];
 const provider={text:async(system,user,ctx,options)=>{seen.push({system,user,options});return {text:seen.length===1?'录入错误':'{"units":{"u1":"请用自己的话复述一遍。"}}'};}};
 await assert.rejects(generateAnchoredRewrite(provider,input,{}),error=>{assert.equal(error.evidence.requests.length,1);assert.equal(error.evidence.extraction.text,'录入错误');return true;});assert.equal(seen.length,1);
 seen.length=0;provider.text=async(system,user,ctx,options)=>{seen.push({system,user,options});return {text:seen.length===1?'{"anchors":{"u1c1":["自己的话","复述"]}}':'{"units":{"u1":"请用自己的话复述一遍。"}}'};};const output=await generateAnchoredRewrite(provider,input,{});assert.equal(output.requests.length,2);assert.equal(seen[1].system,input.template.content);assert.equal(output.rawText,'{"units":{"u1":"请用自己的话复述一遍。"}}');assert.equal(output.text,'先摆好卡片。\n请用自己的话复述一遍。');
});
