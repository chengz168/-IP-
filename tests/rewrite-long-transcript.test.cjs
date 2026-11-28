const test=require('node:test'),assert=require('node:assert/strict');
const source='先登记。'+'上午在社区按主题摆好书籍，每人最多选5本'.repeat(65)+'活动不提供邮寄。';
const body='上午先在社区将书籍按主题整理，每人可以选5本。'.repeat(60)+'活动不提供邮寄。';
const input=()=>({fields:{sourceText:source,wordLimit:source.length,rewriteRequirements:'整理为自然口语。'},template:{content:'模板原件',source:{kind:'reference-visible'}},generation:{protocol:'ollama',model:'qwen3.5:9b-q4_K_M'}});

test('无句号长转写复用正文生成，保留首段与数字，不强迫单一超长JSON单元',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const value=input(),before=structuredClone(value);let calls=0;
 const result=await generateRewrite({text:async(system,user,ctx,options)=>{
  calls++;assert.match(system,/长篇语音转写的全文改写/);assert.match(system,/首段保留已经由应用完成/);assert(user.includes(source.slice('先登记。'.length)));assert(!user.includes(source));assert.match(user,/<source>[\s\S]+<\/source>/);assert(user.includes(value.fields.rewriteRequirements));assert.match(user,/\["5"\]/);assert.equal(options.schema,undefined);assert.equal(options.thinking,false);return {text:body};
 }},value,{});
 assert.equal(calls,1);assert.equal(result.wrapperSource,'local-reference-long-transcript-v1');assert.equal(result.text,'先登记。\n'+body);assert.equal(result.rawText,body);assert.equal(result.attempts[0].quality.status,'needs-review');assert.equal(result.attempts[0].quality.accepted,false);assert.deepEqual(value,before);
});

test('长转写重复开头、数字变化或JSON不能通过，最多纠正一次且不裁剪回包',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');
 for(const raw of ['先登记。'+body,body.replaceAll('5','8'),JSON.stringify({units:{u1:body}})]){
  let calls=0;const result=await generateRewrite({text:async()=>{calls++;return {text:raw};}},input(),{});
  assert.equal(calls,2);assert.equal(result.rawText,raw);assert.equal(result.attempts.length,2);assert.equal(result.attempts[1].quality.status,'rejected');assert(result.assembly.validationIssues.length>0);
 }
});

test('已有自然句段的长稿继续逐单元改写，不扩大正文路线',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');const value=input();value.fields.sourceText=source.replaceAll('每人最多选5本','每人最多选5本。');let calls=0;
 const result=await generateRewrite({text:async(system,user,ctx,options)=>{
  calls++;assert(options.schema);return {text:JSON.stringify({units:Object.fromEntries(Object.keys(options.schema.properties.units.properties).map(id=>[id,id==='u66'?'活动不提供邮寄。':'在社区先按主题将书摆好，上午每人最多选5本。']))})};
 }},value,{});
 assert.equal(calls,1);assert.equal(result.wrapperSource,'local-reference-rewrite-units-v2');
});

test('仅合并逐字一致的独立首行，原回包留证，连续重复或首行含其他正文仍拒绝',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs');let calls=0;
 const raw='先登记。\n\n'+body;
 const result=await generateRewrite({text:async()=>{calls++;return {text:raw};}},input(),{});
 assert.equal(calls,1);assert.equal(result.rawText,raw);assert.equal(result.text,'先登记。\n'+body);assert.equal(result.assembly.normalization.kind,'remove-exact-opening-line');assert.equal(result.attempts[0].quality.status,'needs-review');
 for(const invalid of ['先登记。\n先登记。\n'+body,'先登记。其他正文\n'+body]){
  const rejected=await generateRewrite({text:async()=>({text:invalid})},input(),{});
  assert.equal(rejected.attempts[1].quality.status,'rejected');assert.match(rejected.assembly.validationIssues.join('；'),/重复了保留开头/);assert.equal(rejected.rawText,invalid);
 }
});
