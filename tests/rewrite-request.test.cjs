const test=require('node:test'),assert=require('node:assert/strict');

test('通用改写请求保留来源风险和时点，不以禁止附言删除原有免责声明',async()=>{
 const {rewriteRequest}=await import('../server/rewrite-request.mjs');
 const source='原视频称三季度社保418组合新进。历史持仓不代表未来持续加仓，不构成投资建议。';
 const input={fields:{sourceText:source,wordLimit:150},template:{content:'用户自己的模板。'}};
 const before=structuredClone(input),request=rewriteRequest(input);
 assert.equal(request.system,input.template.content);assert.deepEqual(input,before);
 assert(request.user.endsWith('原文：\n'+source));assert(!request.user.includes('不写标题、分析、创作说明或免责声明'));
 assert.match(request.user,/原有免责声明.*必须完整保留/);assert.match(request.user,/原稿已有的限制与风险提示属于正文/);assert.match(request.user,/不把历史数据写成当前事实/);
 assert.equal(request.wrapperSource,'local-rewrite-constraints-v2');
});

test('真实生成入口把主体和数值保留约束交给服务，返回正文仍需单独质量检查',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');let request;
 const source='航天电器：1368.94万股，增长266%。光威复材：418、114组合。';
 const input={fields:{sourceText:source,wordLimit:120},template:{content:'只改写用户材料。'},generation:{model:'已有本地模型'}};
 const provider={text:async(system,user,ctx,options)=>{request={system,user,options};return {text:'协议替身正文，不证明模型保真。'};}};
 const result=await generateRewrite(provider,input,{});
 assert.match(request.user,/数字、单位、专名、型号及其主体归属保持不变/);assert(request.user.includes(source));assert.equal(request.options.model,input.generation.model);
 assert.equal(result.wrapperSource,'local-rewrite-constraints-v2');assert.equal(result.text,'协议替身正文，不证明模型保真。');assert.equal(result.quality,undefined);
});

test('原厂可见模板原文不改，额外本地约束保留独立来源',async()=>{
 const {rewriteRequest}=await import('../server/rewrite-request.mjs'),{referencePrompts}=await import('../server/reference-prompts.mjs');
 const template=referencePrompts.find(item=>item.type==='copy');assert(template);
 const request=rewriteRequest({fields:{sourceText:'先登记。每人最多5本，不收破损书。',wordLimit:80},template});
 assert.equal(request.system,template.content);assert.match(request.user,/第一段仅包含原文首句/);assert.match(request.user,/否定、条件、范围、时点/);assert.equal(request.wrapperSource,'local-rewrite-constraints-v2');
});

test('普通模板遗漏来源风险与历史限定给出逐条复核，不把同义改写冒判为语义通过',async()=>{
 const {assessRewrite}=await import('../server/copy-quality.mjs');
 const source='按原视频整理。不构成投资建议，历史持仓不代表未来持续加仓。';
 const omitted=assessRewrite(source,'下面盘点片中企业。',80,{});
 assert(omitted.warnings.some(value=>value.includes('不构成投资建议')));assert(omitted.warnings.some(value=>value.includes('不代表未来持续加仓')));assert.equal(omitted.accepted,false);
 const preserved=assessRewrite(source,'这里按原视频内容梳理。不构成投资建议，历史持仓不代表未来持续加仓。',80,{});
 assert(!preserved.warnings.some(value=>value.includes('限制条款')));assert.equal(preserved.accepted,false);
 const paraphrased=assessRewrite(source,'整理原片信息，仅供参考，并非投资建议。过去持仓不能保证之后加仓。',80,{});
 assert(paraphrased.warnings.some(value=>value.includes('限制条款')));assert.equal(paraphrased.status,'needs-review');
});

test('普通模板明确反转已支持的否定限制会拒绝且保留输出',async()=>{
 const {assessRewrite}=await import('../server/copy-quality.mjs');
 const output='这个款式内置电池。';const result=assessRewrite('这个款式不内置电池。',output,20,{});
 assert.equal(result.status,'rejected');assert.match(result.issues.join('；'),/否定限制/);assert.equal(output,'这个款式内置电池。');
});
