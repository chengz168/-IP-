const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../scripts/experiments/rewrite-protection.mjs');

test('保护包含阿拉伯数量、中文数量、标识和明确限制的整句',async()=>{
 const {protectionReasons}=await load();
 for(const source of ['每人最多带5本书，不收教材和破损书。','每位可带三本书。','型号L7-Pro，USB供电。','不得擅自删除。','必须先核对编号。'])assert(protectionReasons(source).length,source);
 assert.deepEqual(protectionReasons('请把剩下的书放回原来的桌上。'),[]);
});

test('数量限制由原句组装，模型不能把带入数量改为手持数量',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite,protectedUnitSchema}=await load(),source='先到登记台。每人最多带5本书，不收教材和破损书。把书按分类放好。',plan=protectedRewritePlan(source,source.length);
 assert.deepEqual(plan.protectedUnits.map(u=>u.id),['u1']);assert.deepEqual(protectedUnitSchema(plan).properties.units.required,['u2']);
 const r=assembleProtectedRewrite(plan,{units:{u2:'按分类把书放好。'}});assert.equal(r.text,'先到登记台。\n每人最多带5本书，不收教材和破损书。\n按分类把书放好。');assert.equal(r.assembly.protectedUnits[0].source,plan.units[0].source);
 assert.throws(()=>assembleProtectedRewrite(plan,{units:{u1:'每个人手里最多只能拿5本。',u2:'按分类把书放好。'}}),/保留句不能由模型覆盖/);
});

test('否定与其条件、对象同时按整句保留，并保持原始句段顺序',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),source='先打开箱子。暂时看不懂的记录，放在待查区，不要直接删掉。把卡片分类放好。活动不提供邮寄。',plan=protectedRewritePlan(source,source.length);
 const r=assembleProtectedRewrite(plan,{units:{u2:'按类别把卡片放好。'}});assert.deepEqual(r.assembly.editableUnitIds,['u2']);assert(r.text.includes(plan.units[0].source));assert(r.text.indexOf('暂时看不懂')<r.text.indexOf('按类别'));assert(r.text.indexOf('按类别')<r.text.indexOf('不提供邮寄'));
});

test('全部为保护句时在请求之前拒绝，不能把原文拼回去称为改写',async()=>{
 const {protectedRewriteRequest}=await load();assert.throws(()=>protectedRewriteRequest({fields:{sourceText:'先看参数。宽12厘米。不内置电池。',wordLimit:50},template:{content:'模板'}}),/没有可改写句段/);
});

test('可改写部分完全照搬、只改标点或空输出时拒绝',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),source='先到登记台。每人限5本。把书按分类放好。',plan=protectedRewritePlan(source,source.length);
 for(const output of ['把书按分类放好。','把书，按分类放好！',''])assert.throws(()=>assembleProtectedRewrite(plan,{units:{u2:output}}));
});

test('缺少、多余、数组和任意外层字段拒绝，JSON属性顺序不决定句段顺序',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),source='先登记。每人限5本。把书摆好。最后收好卡片。',plan=protectedRewritePlan(source,source.length);
 for(const value of [{units:{u2:'书先摆好。'}},{units:{u2:'书先摆好。',u3:'卡片最后收好。',x:'多出'}},{units:[]},{units:{u2:'书先摆好。',u3:'卡片最后收好。'},extra:true}])assert.throws(()=>assembleProtectedRewrite(plan,value));
 assert.equal(assembleProtectedRewrite(plan,{units:{u3:'卡片最后收好。',u2:'书先摆好。'}}).text,'先登记。\n每人限5本。\n书先摆好。\n卡片最后收好。');
});

test('可改写句段新增数字仍拒绝；未识别的事实和口播不冒认为通过',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),{assessRewrite}=await import('../server/copy-quality.mjs'),{referencePrompts}=await import('../server/reference-prompts.mjs');const source='先登记。每人限5本。把书摆好。',plan=protectedRewritePlan(source,source.length);
 assert.throws(()=>assembleProtectedRewrite(plan,{units:{u2:'把5本书摆好。'}}),/数字|标识/);
 const r=assembleProtectedRewrite(plan,{units:{u2:'把书放在旁边。'}});assert.equal(assessRewrite(source,r.text,source.length,referencePrompts[0],r.assembly).accepted,false);assert.match(r.assembly.coverageScope,/不证明语义全部通过/);
});

test('原厂可见system全文不改，本地保留策略有独立来源标记',async()=>{
 const {protectedRewriteRequest}=await load(),{referencePrompts}=await import('../server/reference-prompts.mjs');const request=protectedRewriteRequest({fields:{sourceText:'先登记。每人限5本。最后收好卡片。',wordLimit:40},template:referencePrompts[0]});assert.equal(request.system,referencePrompts[0].content);assert.equal(request.wrapperSource,'local-reference-protected-units-v2');assert.match(request.user,/不能重复或另写与它们矛盾/);assert.deepEqual(request.schema.properties.units.required,['u2']);
});

test('普通一个和一组保留改写空间，但数量原写法丢失仍拦截，不冒认语义错误',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),source='先登记。每组写一个小标题。最后挑出一组复述。',plan=protectedRewritePlan(source,source.length);
 assert.equal(plan.protectedUnits.length,0);assert.throws(()=>assembleProtectedRewrite(plan,{units:{u1:'给每组起个简短标题。',u2:'最后选出一组讲一遍。'}}),/中文数量原写法/);
 const r=assembleProtectedRewrite(plan,{units:{u1:'一个小标题给每组写好。',u2:'最后选出一组讲一遍。'}});assert.equal(r.assembly.editableUnitIds.length,2);
});

test('可用电源被收窄成插座不在有限规则能力内，测试不得冒认事实已通过',async()=>{
 const {protectedRewritePlan,assembleProtectedRewrite}=await load(),{assessRewrite}=await import('../server/copy-quality.mjs'),{referencePrompts}=await import('../server/reference-prompts.mjs');const source='先看说明。宽12厘米。摆放时先确认桌边有可用电源，再给底座留出位置。',plan=protectedRewritePlan(source,source.length),r=assembleProtectedRewrite(plan,{units:{u2:'放灯时先看桌边有没有插座，再给底座留出位置。'}}),quality=assessRewrite(source,r.text,source.length,referencePrompts[0],r.assembly);
 assert.equal(quality.accepted,false);assert.equal(quality.status,'needs-review');assert.match(r.assembly.coverageScope,/其余句段.*仍需对照审读/);
});
