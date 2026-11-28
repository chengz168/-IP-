const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../server/rewrite-units.mjs');

test('句段覆盖保留小数与英文型号，截停开头后的动作进入后文',async()=>{
 const {rewriteUnits,explicitTokens}=await load();
 const plan=rewriteUnits('  先把灯放好。底座宽12.5厘米，型号L7-Pro，通过USB供电。再收好灯杆。',60);
 assert.equal(plan.opening,'先把灯放好。');assert.equal(plan.units.length,2);assert.equal(plan.units[0].source,'底座宽12.5厘米，型号L7-Pro，通过USB供电。');
 assert.deepEqual(explicitTokens('L7-Pro. USB、12.5厘米，50%'),['L7-Pro','USB','12.5','50%']);
 const text='整理桌面时，先找出每天都会用的物品，把常用的笔和便签放在手边。最后收好不用的物品。',cut=rewriteUnits(text,text.length);
 assert.equal(cut.opening,'整理桌面时，先找出每天都会用的物品。');assert.equal(cut.units[0].source,'把常用的笔和便签放在手边。');
});

test('引号内开头和换行后文不会丢句，单句及过小目标明确拒绝',async()=>{
 const {rewriteUnits}=await load(),source='“先登记。”\n再把书放好。\n结束后带走剩书。',plan=rewriteUnits(source,source.length);
 assert.equal(plan.opening,'“先登记。”');assert.deepEqual(plan.units.map(unit=>unit.source),['再把书放好。','结束后带走剩书。']);
 assert.throws(()=>rewriteUnits('只有一句。',20),/只有模板要求保留的开头/);assert.throws(()=>rewriteUnits(source,2),/目标字数不足/);
});

test('按原文顺序组装，模型对象属性顺序不影响动作顺序',async()=>{
 const {rewriteUnits,assembleUnits,unitSchema}=await load(),source='先登记。每人限5本书。最后带走余书。',plan=rewriteUnits(source,source.length),result=assembleUnits(plan,{units:{u2:'余书最后带走。',u1:'每人最多5本。'}});
 assert.equal(result.text,'先登记。\n每人最多5本。\n余书最后带走。');assert.equal(result.assembly.units[0].id,'u1');assert.match(result.assembly.coverageScope,/不证明/);
 assert.deepEqual(unitSchema(plan).properties.units.required,['u1','u2']);assert.equal(unitSchema(plan).properties.units.additionalProperties,false);
});

test('缺失、多余或空单元不能生成可应用文案',async()=>{
 const {rewriteUnits,assembleUnits}=await load(),source='先登记。每人限5本书。最后带走余书。',plan=rewriteUnits(source,source.length);
 for(const units of [{u1:'每人最多5本。'},{u1:'每人最多5本。',u2:'余书最后带走。',u3:'额外句子'},{u1:'',u2:'余书最后带走。'}])assert.throws(()=>assembleUnits(plan,{units}));
});

test('数字型号被改写或新增时拒绝，中文数字不冒认完全等价',async()=>{
 const {rewriteUnits,assembleUnits}=await load(),source='先摆灯。L7由USB供电。灯宽12厘米。',plan=rewriteUnits(source,source.length);
 assert.doesNotThrow(()=>assembleUnits(plan,{units:{u1:'USB给L7供电。',u2:'宽度为12厘米。'}}));
 for(const units of [{u1:'USB给L8供电。',u2:'宽度为12厘米。'},{u1:'USB给L7供电。',u2:'宽度为20厘米。'},{u1:'USB给L7供电。',u2:'宽度十二厘米。'},{u1:'USB给L7供电。',u2:'12厘米宽3档'}])assert.throws(()=>assembleUnits(plan,{units}),/数字|标识/);
});

test('只有开头在调用模型前失败，一般自定义模板维持原执行方式',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');let calls=0;
 const provider={text:async()=>{calls++;return {text:'独立模板的返回'};}},input={fields:{sourceText:'先摆灯。',wordLimit:30},generation:{model:'本机模型'},template:{content:'模板',source:{kind:'reference-visible'}}};
 await assert.rejects(generateRewrite(provider,input,{}),/只有模板要求保留的开头/);assert.equal(calls,0);
 const result=await generateRewrite(provider,{...input,template:{content:'自定义模板'}},{});assert.equal(result.text,'独立模板的返回');assert.equal(calls,1);
});

test('前导空白不导致保留开头误判，结构合格仍不代表质量通过',async()=>{
 const {assessRewrite}=await import('../server/copy-quality.mjs'),{referencePrompts}=await import('../server/reference-prompts.mjs');
 const result=assessRewrite('  先登记。最后带走余书。','先登记。\n余书结束时带走。',16,referencePrompts[0]);
 assert.equal(result.status,'needs-review');assert.equal(result.accepted,false);
});

test('段落长度偏差提示复核，不能据此认定信息错误或质量已通过',async()=>{const {rewriteUnits,assembleUnits}=await load(),{assessRewrite}=await import('../server/copy-quality.mjs'),{referencePrompts}=await import('../server/reference-prompts.mjs');const source='先登记。每人限5本书。最后带走余书。',plan=rewriteUnits(source,source.length),r=assembleUnits(plan,{units:{u1:'每人5本。',u2:'字'.repeat(100)}}),quality=assessRewrite(source,r.text,source.length,referencePrompts[0],r.assembly);assert.equal(r.assembly.lengthWarnings.length,1);assert(quality.warnings.some(value=>value.includes('信息单元u2')));assert.equal(quality.accepted,false);});

test('固定开头重复可通过一次模型纠正恢复，原回包留证且不裁剪内容',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');
 const input={fields:{sourceText:'先登记。把书按主题分类摆放，结束后带走余书。',wordLimit:30},template:{content:'第一段照抄原文。',source:{kind:'reference-visible'}},generation:{model:'fixture'}};
 const raw=JSON.stringify({units:{u1:'先登记。请将书籍按主题摆好，结束时带走余下的书。'}}),corrected=JSON.stringify({units:{u1:'请将书籍按主题分类摆好，结束时把余下的书带走。'}});let calls=0;
 const result=await generateRewrite({text:async(system,user)=>{
  calls++;assert.match(system,/第一段照抄原文/);assert.match(system,/已经由应用完成/);
  if(calls===2){assert.match(user,/后文重复了保留开头/);assert(!user.includes(raw));}
  return {text:calls===1?raw:corrected};
 }},input,{});
 assert.equal(calls,2);assert.equal(result.text,'先登记。\n请将书籍按主题分类摆好，结束时把余下的书带走。');
 assert.equal(result.attempts.length,2);assert.equal(result.attempts[0].rawText,raw);assert.match(result.attempts[0].validationError,/重复/);assert.equal(result.rawText,corrected);assert.equal(result.attempts[1].quality.accepted,false);
});

test('第二次仍校验失败时两次不同回包完整保留，不能自动删除重复开头',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');
 const input={fields:{sourceText:'先登记。每人限5本书。',wordLimit:25},template:{content:'模板',source:{kind:'reference-visible'}},generation:{model:'fixture'}};
 const replies=[JSON.stringify({units:{u1:'先登记。每人最多5本。'}}),JSON.stringify({units:{u1:'每人最多8本。'}})];let calls=0;
 await assert.rejects(generateRewrite({text:async()=>({text:replies[calls++]})},input,{}),error=>{
  assert.match(error.message,/数字或标识/);assert.deepEqual(error.evidence.attempts.map(a=>a.rawText),replies);assert.equal(error.evidence.rawText,replies[1]);return true;
 });assert.equal(calls,2);
});

test('网络或取消错误不触发纠正请求，普通模板仍单次调用',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');
 const input={fields:{sourceText:'先登记。把书分类摆好。',wordLimit:25},template:{content:'模板',source:{kind:'reference-visible'}},generation:{model:'fixture'}};let calls=0;
 await assert.rejects(generateRewrite({text:async()=>{calls++;throw Error('网络不可用');}},input,{}),/网络不可用/);assert.equal(calls,1);
 const controller=new AbortController();calls=0;
 await assert.rejects(generateRewrite({text:async()=>{calls++;controller.abort();return {text:'无效JSON'};}},input,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
 calls=0;const ordinary={...input,template:{content:'普通模板'}};
 const result=await generateRewrite({text:async()=>{calls++;return {text:'普通模板的原始返回'};}},ordinary,{});assert.equal(calls,1);assert.equal(result.text,'普通模板的原始返回');
});
