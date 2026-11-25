const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createService}=require('./support/licensed-service.cjs');
const load=()=>import('../server/copy-quality.mjs');
const history=require('./fixtures/rewrite-BK-001-history.json');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rewrite-numeric-')),before=new Set(process.listeners('exit')),s=createService(root);
 const listener=process.listeners('exit').find(fn=>!before.has(fn));
 t.after(()=>{if(listener)process.removeListener('exit',listener);fs.rmSync(root,{recursive:true,force:true});});return s;
}

for(const kind of ['default','reference-visible'])test(kind+'改写拒绝266%变26.6%，已知数字保持待复核',async()=>{
 const {assessRewrite}=await load(),source='先看持仓。加仓幅度大约266%。',template={source:{kind}};
 const bad=assessRewrite(source,'先看持仓。\n增仓幅度约26.6%。',source.length,template);
 assert.equal(bad.status,'rejected');assert.equal(bad.accepted,false);assert.match(bad.issues.join('；'),/26\.6%/);
 const good=assessRewrite(source,'先看持仓。\n增仓幅度约266%。',source.length,template);
 assert.equal(good.status,'needs-review');assert.equal(good.accepted,false);assert(!good.issues.some(value=>value.includes('量化')));
});

test('空格和全角百分号只规范化比较，原输出不被静默修改',async()=>{
 const {assessRewrite}=await load(),source='加仓266%。',output='增仓幅度为 266 ％。',result=assessRewrite(source,output,source.length,{});
 assert.equal(result.status,'needs-review');assert.deepEqual(result.warnings,[]);assert.equal(output,'增仓幅度为 266 ％。');
});

test('原文已有26.6%不误报，缺数字、年份与结构序号不一概拒绝',async()=>{
 const {assessRewrite}=await load();
 for(const [source,output] of [['甲增加266%，乙增加26.6%。','乙的增幅为26.6%。'],['增幅266%。','增幅有变化。'],['2024年列3个观点。','二〇二四年列出4个观点。']]){
  const r=assessRewrite(source,output,source.length,{});assert.equal(r.status,'needs-review',JSON.stringify(r));assert.equal(r.accepted,false);
 }
 const missing=assessRewrite('增幅266%。','增幅有变化。',10,{});assert(missing.warnings.some(value=>value.includes('266%')));
});

test('明确组合编号替换及持股单位变化拒绝，普通裸数字保留复核边界',async()=>{
 const {assessRewrite}=await load();
 for(const [source,output] of [['社保604组合持有。','持有者是社保640组合。'],['持有1368.94万股。','持仓为1368.94亿股。']]){
  const r=assessRewrite(source,output,source.length,{});assert.equal(r.status,'rejected');assert(r.issues.length);
 }
 assert.equal(assessRewrite('第一项为604。','首先来看640。',10,{}).status,'needs-review');
});

test('默认模板真实服务调用路径保存被拒绝原回包并保持旧稿与媒体引用',async t=>{
 const s=fixture(t),d=s.store.draft();Object.assign(d,{sourceText:'加仓266%。',rewrite:'已有手工稿',finalText:'已配音稿',confirmed:true,template:'default'});d.voice.audioId='已有配音';s.store.save();
 const before=structuredClone(d),raw='增仓幅度为26.6%。';s.providers.text=async()=>({text:raw,request:{model:'契约夹具，不调用模型'}});
 const output=await s.invoke('text',{id:d.id,kind:'rewrite'}),run=s.store.data.runs[0];
 assert.equal(output.quality.status,'rejected');assert.equal(output.quality.accepted,false);assert.match(output.quality.issues.join('；'),/26\.6%/);
 assert.equal(output.text,raw);assert.equal(run.output.text,raw);assert.equal(run.snapshot.sourceText,before.sourceText);assert.deepEqual(s.store.draft(),before);
 const disk=JSON.parse(fs.readFileSync(s.store.file,'utf8'));assert.equal(disk.runs[0].output.text,raw);assert.equal(disk.drafts[0].rewrite,before.rewrite);
});

test('明确相邻重复片段只给warning，保留当前实际字符串不自动删改',async()=>{
 const {assessRewrite}=await load();
 const source='它与两家公司开展联合研发和供货。';
 const output='它与两家公司开展联合研发，开展联合研发和供货。';
 const result=assessRewrite(source,output,output.length,{});
 assert.equal(result.status,'needs-review');assert.equal(result.accepted,false);
 assert(result.warnings.some(value=>value.includes('开展联合研发')));
 assert.equal(output,'它与两家公司开展联合研发，开展联合研发和供货。');
});

test('短促排比和普通对比重复不触发相邻长片段提醒',async()=>{
 const {assessRewrite}=await load();
 for(const output of ['慢慢走，也慢慢聊。','重要的事反复确认，普通的事快速处理。','一步一步来，稳稳当当完成。']){
  const result=assessRewrite('口播提示。',output,output.length,{});
  assert(!result.warnings.some(value=>value.includes('重复片段')),output);
 }
});

test('无句号ASR重复固定开头的失败继续保留原回包，不调用重试',async t=>{
 const s=fixture(t),d=s.store.draft();Object.assign(d,{sourceText:'哈喽,大家好,我是财哥最近盘点商业航天持仓加仓266%这里还有完整后文便于复核',wordLimit:'60',template:'reference-copy-v840',rewrite:'旧稿'});s.store.save();let calls=0;
 const raw=JSON.stringify({units:{u1:'哈喽，大家好。我是财哥，接着盘点商业航天加仓266%。'}});
 s.providers.text=async()=>{calls++;return {text:raw};};
 await assert.rejects(s.invoke('text',{id:d.id,kind:'rewrite'}),/重复了保留开头/);
 assert.equal(calls,1);assert.equal(s.store.data.runs[0].status,'failed');assert.equal(s.store.data.runs[0].failureOutput.rawText,raw);assert.equal(s.store.draft().rewrite,'旧稿');
});

test('真实历史默认模板回包从needs-review变为拒绝，长度偏差和原始正文均留存',async()=>{
 const {assessRewrite}=await load(),h=history.numeric,before=JSON.stringify(h);
 assert.match(h.sourceText,/266%/);assert.match(h.outputText,/26\.6%/);assert.equal(h.originalQuality.status,'needs-review');
 const actual=assessRewrite(h.sourceText,h.outputText,h.target,h.template);
 assert.equal(actual.status,'rejected');assert.equal(actual.accepted,false);assert.match(actual.issues.join('；'),/26\.6%/);
 assert.equal(actual.targetDeviation,h.originalQuality.targetDeviation);assert.equal(JSON.stringify(h),before);
});

test('真实历史参考模板的固定opening重复仍拒绝且无重试或自动删前缀',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs'),h=history.opening,before=JSON.stringify(h);let calls=0;
 const provider={text:async()=>{calls++;return {text:h.rawText};}};
 await assert.rejects(generateRewrite(provider,h.input,{}),error=>{
  assert.match(error.message,/重复了保留开头/);assert.equal(error.evidence.rawText,h.rawText);assert.equal(error.evidence.unitPlan.units.length,1);return true;
 });
 assert.equal(calls,1);assert.equal(JSON.stringify(h),before);
});

test('后文请求明确由应用拼固定首段，system模板不改，合格后文只拼一次且不修改回包',async()=>{
 const {generateRewrite}=await import('../server/rewrite-generation.mjs'),{rewriteUnits}=await import('../server/rewrite-units.mjs');
 const input={fields:{sourceText:'先把书放好。按类别整理卡片。',wordLimit:25},template:{content:'原厂可见system模板原文',source:{kind:'reference-visible'}},generation:{model:'fixture'}},plan=rewriteUnits(input.fields.sourceText,25);
 const raw=JSON.stringify({units:{u1:'请先按不同类别把卡片整理好。'}});let calls=0;
 const provider={text:async(system,user,ctx,options)=>{
  calls++;assert.equal(system,input.template.content);assert.match(user,/应用已完成模板的首段保留步骤/);assert.match(user,/不得返回opening字段/);assert.match(user,/不含固定首段/);
  assert.match(options.schema.properties.units.properties.u1.description,/不重复固定首段/);assert.equal(options.schema.additionalProperties,false);assert.deepEqual(options.schema.properties.units.required,['u1']);return {text:raw};
 }};
 const result=await generateRewrite(provider,input,{});assert.equal(calls,1);assert.equal(result.text,plan.opening+'\n请先按不同类别把卡片整理好。');assert.equal(result.rawText,raw);assert.equal(result.wrapperSource,'local-reference-rewrite-units-v2');
});
