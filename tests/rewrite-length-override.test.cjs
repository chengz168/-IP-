const test=require('node:test'),assert=require('node:assert/strict');
const input=()=>({fields:{sourceText:'先看板面。厚度有10毫米。',wordLimit:80,rewriteRequirements:'面向店老板，讲清挑选时的观察步骤。'},template:{content:'全文字数要与原文案字数没有什么差距。保留事实。',source:{kind:'reference-visible'}},generation:{model:'本地模型'}});

test('用户字数覆盖参考模板默认长度且模板原件不改，补充要求不丢失',async()=>{
 const {rewriteExecutionSystem,rewriteRequest}=await import('../server/rewrite-request.mjs');const value=input(),before=structuredClone(value),result=rewriteExecutionSystem(value);
 assert.match(result.system,/约80字符/);assert(!result.system.includes('全文字数要与原文案字数没有什么差距。'));assert.equal(result.adaptation.targetCharacters,80);assert.deepEqual(value,before);
 assert(rewriteRequest(value).user.includes(value.fields.rewriteRequirements));assert.equal(rewriteExecutionSystem({...value,template:{content:'我的模板'}}).system,'我的模板');
});

test('无标点实际工厂口播按明确问候断句，后文不丢字不从半词开始',async()=>{
 const {rewriteUnits}=await import('../server/rewrite-units.mjs');const source='大家好我身后这些板材是咱们厂做帕罗选用的最核心的版面大家可以看一下啊我给大家介绍一下厚度有10毫米的';
 const plan=rewriteUnits(source,1000);assert.equal(plan.opening,'大家好。');assert(plan.units[0].source.startsWith('我身后这些板材'));assert.equal(plan.opening.replace('。','')+plan.units[0].source,source);
});

test('参考改写原样回显后限次纠错，实际执行适配和两次原始回包均保存',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const value=input();let calls=0;
 const output='板面的厚度有10毫米，挑选时先把板面和边缘看清楚，再结合自己准备做的餐品逐项核对。把厚度问明白，把日常清理的步骤了解清楚，选之前多看细节。';
 const result=await generateRewrite({text:async(system,user,ctx,options)=>{calls++;assert(system.includes('约80字符'));assert(user.includes(value.fields.rewriteRequirements));assert.equal(options.model,'本地模型');if(calls===2){assert.match(user,/上次合稿/);assert.match(user,/重新生成全部units/);}return {text:JSON.stringify({units:{u1:calls===1?'厚度有10毫米。':output}})};}},value,{});
 assert.equal(calls,2);assert.equal(result.attempts.length,2);assert.equal(result.attempts[0].quality.status,'rejected');assert.equal(result.attempts[1].quality.status,'needs-review');assert.equal(result.attempts[1].quality.accepted,false);assert.equal(result.executionAdaptation.targetCharacters,80);assert.equal(result.text,'先看板面。\n'+output);assert(result.rawText.includes(output));
});

test('两次都不合格不会无限重试，保留原样结果供现有拒绝检查',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');let calls=0;const result=await generateRewrite({text:async()=>{calls++;return {text:JSON.stringify({units:{u1:'厚度有10毫米。'}})}}},input(),{});
 assert.equal(calls,2);assert.equal(result.attempts.length,2);assert.equal(result.attempts.at(-1).quality.status,'rejected');
});

test('首次回包后已停止，不发出自动修正请求',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const controller=new AbortController();let calls=0;
 await assert.rejects(generateRewrite({text:async()=>{calls++;controller.abort();return {text:JSON.stringify({units:{u1:'厚度有10毫米。'}})}}},input(),{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(calls,1);
});

test('自动修正请求失败仍保留首次原始回包证据',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');let calls=0;
 await assert.rejects(generateRewrite({text:async()=>{if(++calls===2)throw Error('连接失败');return {text:JSON.stringify({units:{u1:'厚度有10毫米。'}})}}},input(),{}),error=>{assert.equal(error.evidence.attempts.length,1);assert.match(error.evidence.attempts[0].rawText,/10毫米/);return true;});
});


test('大幅扩写按正文生成并固定首段，本机Qwen关闭长思考且数字遗漏保留拒绝原因',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const value=input();value.fields.wordLimit=1000;value.generation={protocol:'ollama',model:'qwen3.5:9b-q4_K_M'};
 const good='先看板面。\n厚度有10毫米。'+('看板面时先核对自己需要的规格，再观察展示的细节。'.repeat(39));let calls=0;
 const result=await generateRewrite({text:async(system,user,ctx,options)=>{calls++;assert.equal(options.thinking,false);assert.equal(options.presencePenalty,0);assert.equal(options.maxTokens,2500);assert.equal(options.schema,undefined);assert(user.includes(value.fields.sourceText));return {text:good};}},value,{});
 assert.equal(calls,1);assert.equal(result.wrapperSource,'local-reference-expansion-v1');assert.equal(result.attempts[0].quality.status,'needs-review');assert.equal(result.assembly.validationIssues.length,0);
 const bad=good.replace('10毫米','十毫米');calls=0;const rejected=await generateRewrite({text:async()=>{calls++;return {text:bad}}},value,{});assert.equal(calls,2);assert(rejected.assembly.validationIssues.some(x=>x.includes('10')));assert.equal(rejected.attempts[1].quality.status,'rejected');
});

test('未确认的其他本地模型不强加Qwen思考参数',async()=>{
 const {rewriteModelOptions}=await import('../server/rewrite-request.mjs');assert.deepEqual(rewriteModelOptions({generation:{protocol:'ollama',model:'another-model'}}),{});assert.deepEqual(rewriteModelOptions({generation:{protocol:'compatible',model:'qwen3.5'}}),{});
});

test('大幅扩写停止后不追加纠错，纠错失败仍保留首次原始正文',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const value=input();value.fields.wordLimit=1000;const controller=new AbortController();let calls=0;
 await assert.rejects(generateRewrite({text:async()=>{calls++;controller.abort();return {text:'厚度有10毫米。'};}},value,{signal:controller.signal}),error=>error.name==='AbortError');assert.equal(calls,1);
 calls=0;await assert.rejects(generateRewrite({text:async()=>{if(++calls===2)throw Error('纠错请求失败');return {text:'厚度有10毫米。'};}},value,{}),error=>{assert.equal(error.evidence.attempts.length,1);assert.equal(error.evidence.attempts[0].rawText,'厚度有10毫米。');assert.equal(error.evidence.attempts[0].text,'先看板面。\n厚度有10毫米。');return true;});
});
