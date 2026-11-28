const {test}=require('node:test');
const assert=require('node:assert/strict');
const {productionInput,productionSignature,inferProductionPlan,currentPlan,planPrompt}=require('../server/video-production-plan.cjs');

const body='人工智能可以帮我们处理重复工作。理解工具的边界，才能更好地使用工具。';
const sourceUrl='https://www.douyin.com/video/123456789';
function draft(overrides={}){return {finalText:body,video:{},...overrides};}
function reference(overrides={}){return {sourceRunId:'reference-run',sourceSha256:'a'.repeat(64),contentType:'spoken',summary:'旁白介绍工作场景，画面展示不同工具。',reusableStructure:['问题开场','展示具体工作场景'],sections:[{label:'问题开场',purpose:'提出工具如何协助工作的问题',basis:'transcript',visualSamples:[0]}],visualObservations:[{sample:0,description:'画面显示电脑屏幕和办公桌，没有人物面对镜头。'}],...overrides};}
function referenceDraft(overrides={}){return draft({sourceUrl,referenceSelection:{sourceRunId:'reference-run',sourceSha256:'a'.repeat(64),sourceUrl},...overrides});}
function result(overrides={}){return {presentation:'narrated-scenes',narrationMode:'upstream',contentType:'knowledge',confidence:'medium',reason:'旁白解释工具的用途，分镜提供具体场景',style:'',quotes:[{source:'text',quote:'人工智能可以帮我们处理重复工作'}],...overrides};}
function provider(reply=result(),config={}){
 const calls=[],settings={baseUrl:'http://127.0.0.1:11434',model:'local-text',textProtocol:'ollama',textContextTokens:32768,...config};
 return {calls,settings,config:()=>({...settings}),text:async(system,user,ctx,options)=>{calls.push({system,user,ctx,options});if(reply instanceof Error)throw reply;return typeof reply==='function'?reply({system,user,ctx,options}):{text:typeof reply==='string'?reply:JSON.stringify(reply),requestId:'request-local-1',usage:{total_tokens:400}};}};
}
function saved(value,plan){return {...value,video:{...value.video,productionPlan:plan}};}

test('签名只跟随制作资料；界面步骤和任务时间变化不会使方案失效',()=>{
 const value=referenceDraft({product:{title:'样例产品',scriptRunId:'product-run',shots:[{imageId:'image-1'}]},video:{productionInstruction:'采用写实分镜'}}),ref=reference();
 const signature=productionSignature(value,{reference:ref});
 assert.equal(signature,productionSignature({...value,updatedAt:'later',step:4,video:{...value.video,activeTab:'assets'}},{reference:ref}));
 for(const change of [v=>v.finalText+='新的正文。',v=>v.video.productionInstruction='纯画面叙事',v=>v.product.shots[0].imageId='image-2',v=>v.product.scriptRunId='new-product',v=>v.sourceUrl+='?new=1',v=>v.referenceSelection.sourceRunId='new-run',v=>v.referenceSelection.sourceSha256='b'.repeat(64)]){
  const next=structuredClone(value);change(next);assert.notEqual(productionSignature(next,{reference:ref}),signature);
 }
 assert.notEqual(productionSignature(value,{reference:{...ref,summary:'完全不同的参考摘要'}}),signature);
});

test('完整正文进入模型；结构化配置固定且不自动重试',async()=>{
 const p=provider(),plan=await inferProductionPlan({draft:draft(),providers:p});
 assert.equal(plan.status,'inferred');assert.equal(plan.mode,'story');assert.equal(plan.narrationMode,'upstream');assert.equal(plan.qualityAccepted,false);assert.equal(p.calls.length,1);
 assert.equal(JSON.parse(p.calls[0].user).text,body);assert.equal(p.calls[0].options.maxTokens,1400);assert.equal(p.calls[0].options.thinking,false);assert.equal(p.calls[0].options.temperature,0);assert.equal(p.calls[0].options.schema.additionalProperties,false);
 assert.equal(plan.modelEvidence.requestId,'request-local-1');assert.equal(plan.modelEvidence.model,'local-text');assert.deepEqual(plan.modelEvidence.quotes,result().quotes);
});

test('兼容协议和 IPv6 回环可调用本地服务',async()=>{
 for(const baseUrl of ['http://localhost:1234/v1','http://[::1]:1234/v1']){
  const p=provider(result(),{baseUrl,textProtocol:'compatible'}),plan=await inferProductionPlan({draft:draft(),providers:p});assert.equal(plan.status,'inferred');assert.equal(p.calls.length,1);
 }
});

test('云地址、带凭证地址、不支持协议以及缺少模型均不调用模型',async()=>{
 for(const config of [{baseUrl:'https://example.com/v1'},{baseUrl:'http://192.168.1.2:11434'},{baseUrl:'http://user:secret@localhost:11434'},{baseUrl:'file:///tmp/test'},{textProtocol:'unknown'},{model:''}]){
  const p=provider(result(),config),plan=await inferProductionPlan({draft:draft(),providers:p});assert.equal(plan.status,'fallback');assert.equal(p.calls.length,0);assert.match(plan.reason,/未调用云服务/);
 }
 const plan=await inferProductionPlan({draft:draft()});assert.equal(plan.status,'fallback');assert.equal(plan.presentation,'talking-head');assert.equal(plan.confidence,'low');
});

test('超长正文和保守上下文预算失败时明确回退，不截断后调用',async()=>{
 for(const [text,config]of [['字'.repeat(16001),{textContextTokens:100000}],['字'.repeat(11000),{}],[body,{textContextTokens:1000}]]){
  const value=draft({finalText:text}),p=provider(result(),config),plan=await inferProductionPlan({draft:value,providers:p});assert.equal(plan.status,'fallback');assert.equal(p.calls.length,0);assert.match(plan.reason,/未截断正文/);assert.equal(productionInput(value).text,text);
 }
});

test('spoken 只代表台词主叙事，不能让无出镜依据的模型建议进入人物流程',async()=>{
 const p=provider(result({presentation:'talking-head',contentType:'talking-head'})),plan=await inferProductionPlan({draft:referenceDraft(),reference:reference(),providers:p});
 assert.equal(plan.status,'inferred');assert.equal(plan.presentation,'narrated-scenes');assert.equal(plan.mode,'story');assert.equal(plan.narrationMode,'upstream');assert.match(plan.reason,/未明确人物出镜/);
});

test('用户明确要求本人出镜时覆盖模型分镜建议',async()=>{
 const value=draft({video:{productionInstruction:'请让我出镜讲解，保持自然。'}}),p=provider(),plan=await inferProductionPlan({draft:value,providers:p});
 assert.equal(plan.status,'inferred');assert.equal(plan.presentation,'talking-head');assert.equal(plan.mode,'single');assert.equal(plan.confidence,'high');assert.deepEqual(plan.cues,['让我出镜']);
});

test('否定出镜不会误命中，逗号后的旁白分镜要求仍然生效',async()=>{
 const value=draft({video:{productionInstruction:'不要让我出镜，也不要口播，使用旁白分镜。'}}),plan=await inferProductionPlan({draft:value,providers:provider(result({presentation:'talking-head'}))});
 assert.equal(plan.presentation,'narrated-scenes');assert.equal(plan.mode,'story');assert.equal(plan.narrationMode,'upstream');
 const fallback=await inferProductionPlan({draft:value});assert.equal(fallback.presentation,'narrated-scenes');
});

test('普通正文或一个宠物题材词不会在规则回退时自动跳分镜',async()=>{
 for(const finalText of [body,'今天给大家介绍一下我家的猫咪。']){
  const plan=await inferProductionPlan({draft:draft({finalText})});assert.equal(plan.status,'fallback');assert.equal(plan.mode,'single');assert.equal(plan.confidence,'low');
 }
});

test('明确连续镜头方向、事件或知识旁白的回退可进入分镜',async()=>{
 for(const finalText of ['镜头移到门口。特写桌上的水杯。','旁白：今天讲清这个原理。','他推开门走进房间，突然发现桌上的信，随后拿起信封。']){
  const plan=await inferProductionPlan({draft:draft({finalText})});assert.equal(plan.status,'fallback');assert.equal(plan.mode,'story');assert.equal(plan.narrationMode,'upstream');
 }
});

test('商品必须有脚本与绑定图片才进入商品模式，缺资料进入分镜并说明',async()=>{
 const response=result({presentation:'product-demo',contentType:'product-promo'});
 const full=draft({product:{title:'样例产品',scriptRunId:'product-run',shots:[{imageId:'image-1'},{imageId:'image-1'}]}}),bound=await inferProductionPlan({draft:full,providers:provider(response)});
 assert.equal(bound.mode,'product');assert.deepEqual(productionInput(full).product.imageIds,['image-1']);
 for(const product of [{title:'样例产品'},{title:'样例产品',scriptRunId:'run',shots:[]},{title:'样例产品',shots:[{imageId:'image-1'}]}]){
  const unbound=await inferProductionPlan({draft:draft({product}),providers:provider(response)});assert.equal(unbound.status,'inferred');assert.equal(unbound.mode,'story');assert.match(unbound.requirements.join(''),/补充有效商品资料/);assert.match(unbound.steps[0],/补充商品资料/);
 }
});

test('视觉参考和明确无旁白要求保留无旁白分镜',async()=>{
 const ref=reference({contentType:'music-visual'}),fallback=await inferProductionPlan({draft:referenceDraft(),reference:ref});assert.equal(fallback.mode,'story');assert.equal(fallback.presentation,'visual-story');assert.equal(fallback.narrationMode,'none');
 const plan=await inferProductionPlan({draft:draft({video:{productionInstruction:'不要旁白，用纯画面叙事'}}),providers:provider()});assert.equal(plan.presentation,'visual-story');assert.equal(plan.narrationMode,'none');
});

for(const [label,change]of [
 ['错误制作类型',r=>{r.presentation='unknown-mode';}],['错误旁白类型',r=>{r.narrationMode='auto';}],['错误题材',r=>{r.contentType='unknown-category';}],['错误置信度',r=>{r.confidence='certain';}],
 ['超长原因',r=>{r.reason='原'.repeat(501);}],['超长风格',r=>{r.style='风'.repeat(501);}],['英文原因',r=>{r.reason='Use narration';}],['英文风格',r=>{r.style='Realistic';}],
 ['无引用',r=>{r.quotes=[];}],['伪造引用',r=>{r.quotes=[{source:'text',quote:'原文中不存在的证据'}];}],['多余字段',r=>{r.extra='不能信任';}]
])test('模型返回'+label+'时只调用一次并明确回退',async()=>{
 const response=result();change(response);const p=provider(response),plan=await inferProductionPlan({draft:draft(),providers:p});assert.equal(plan.status,'fallback');assert.equal(p.calls.length,1);assert.match(plan.reason,/依据校验失败/);assert.equal(plan.modelEvidence.failed,true);assert.equal(plan.qualityAccepted,false);
});

test('无效 JSON 和服务错误均回退，代码围栏 JSON 可以解析',async()=>{
 for(const reply of ['not-json',Error('本地服务错误')]){const p=provider(reply),plan=await inferProductionPlan({draft:draft(),providers:p});assert.equal(plan.status,'fallback');assert.equal(p.calls.length,1);}
 const plan=await inferProductionPlan({draft:draft(),providers:provider('```json\n'+JSON.stringify(result())+'\n```')});assert.equal(plan.status,'inferred');
});

test('参考引用必须来自单个原字段，不能拼接两个字段来伪造证据',async()=>{
 const ref=reference({summary:'第一段观察',reusableStructure:['第二段结构']}),valid=result({quotes:[{source:'reference',quote:'第一段观察'}]}),invalid=result({quotes:[{source:'reference',quote:'第一段观察\n第二段结构'}]});
 assert.equal((await inferProductionPlan({draft:referenceDraft(),reference:ref,providers:provider(valid)})).status,'inferred');
 assert.equal((await inferProductionPlan({draft:referenceDraft(),reference:ref,providers:provider(invalid)})).status,'fallback');
});

test('一条引用抄写失误时只保留逐字可定位依据，错误引用记录在证据中',async()=>{
 const p=provider(result({quotes:[{source:'text',quote:'人工智能可以帮我们处理重复工作'},{source:'text',quote:'模型自行改写的无效引用'}]}));
 const plan=await inferProductionPlan({draft:draft(),providers:p});
 assert.equal(plan.status,'inferred');assert.deepEqual(plan.cues,['人工智能可以帮我们处理重复工作']);
 assert.equal(plan.modelEvidence.rejectedQuotes.length,1);assert.equal(plan.modelEvidence.rejectedQuotes[0].reason,'无法逐字定位原文');assert.equal(p.calls.length,1);
});

test('输入白名单、参考哈希、图片编号与制作要求均有边界校验',()=>{
 assert.throws(()=>productionInput(draft(),{reference:{...reference(),rawPrompt:'未知字段'}}),/未授权字段/);
 assert.throws(()=>productionInput(draft(),{reference:reference({sourceSha256:'invalid'})}),/哈希/);
 assert.throws(()=>productionInput(draft(),{reference:reference({contentType:'unrecognized'})}),/类型/);
 assert.throws(()=>productionInput(draft(),{reference:reference({visualObservations:[{sample:-1,description:'画面'}]})}),/编号/);
 assert.throws(()=>productionInput(draft({video:{productionInstruction:'字'.repeat(1501)}})),/制作要求/);
 assert.throws(()=>productionInput(draft({product:{shots:[{imageId:'x'.repeat(161)}]}})),/图片编号/);
 assert.throws(()=>productionInput(draft({product:{shots:[{imageId:42}]}})),/图片编号/);
 assert.throws(()=>productionInput(draft({product:{shots:Array.from({length:1001},()=>({imageId:'a'}))}})),/数量/);
});

test('开始前、模型执行中或 provider 主动取消都向上传递，不吞为规则回退',async()=>{
 const before=new AbortController();before.abort();const first=provider();await assert.rejects(inferProductionPlan({draft:draft(),providers:first,ctx:{signal:before.signal}}),{name:'AbortError'});assert.equal(first.calls.length,0);
 const during=new AbortController(),second=provider(()=>{during.abort();return {text:JSON.stringify(result())};});await assert.rejects(inferProductionPlan({draft:draft(),providers:second,ctx:{signal:during.signal}}),{name:'AbortError'});
 const abort=Object.assign(Error('任务已取消'),{name:'AbortError'});await assert.rejects(inferProductionPlan({draft:draft(),providers:provider(abort)}),{name:'AbortError'});
});

test('准备期间本地地址切到云端或协议变化时不提交模型请求',async()=>{
 for(const change of [p=>{p.settings.baseUrl='https://example.com/v1';},p=>{p.settings.textProtocol='compatible';}]){
  const p=provider(),plan=await inferProductionPlan({draft:draft(),providers:p,ctx:{progress:()=>change(p)}});assert.equal(plan.status,'fallback');assert.equal(p.calls.length,0);assert.match(plan.reason,/配置在准备期间发生变化/);
 }
});

test('currentPlan 只接受受保护的视频字段，顶层伪造方案不生效',async()=>{
 const value=draft(),plan=await inferProductionPlan({draft:value,providers:provider()}),stored=saved(value,plan);
 assert.equal(currentPlan({...value,productionPlan:plan}),null);assert.deepEqual(currentPlan(stored),plan);
 const cloned=currentPlan(stored);cloned.reason='外部改动';assert.notEqual(cloned.reason,stored.video.productionPlan.reason);
 for(const change of [p=>{p.mode='single';},p=>{p.qualityAccepted=true;},p=>{p.contentType.name='伪造题材';},p=>{p.confidence='invalid';}]){const next=structuredClone(stored);change(next.video.productionPlan);assert.equal(currentPlan(next),null);}
 assert.equal(currentPlan({...stored,finalText:body+'新的一段。'}),null);
});

test('解除参考或更换记录、哈希、地址都会使当前方案失效',async()=>{
 const value=referenceDraft(),plan=await inferProductionPlan({draft:value,reference:reference(),providers:provider()}),stored=saved(value,plan);assert.deepEqual(currentPlan(stored),plan);
 for(const change of [v=>{delete v.referenceSelection;},v=>{v.referenceSelection.sourceRunId='another-run';},v=>{v.referenceSelection.sourceSha256='b'.repeat(64);},v=>{v.referenceSelection.sourceUrl+='?changed=1';},v=>{v.sourceUrl+='?changed=1';}]){const next=structuredClone(stored);change(next);assert.equal(currentPlan(next),null);}
});

test('制作提示包含有界参考结构与采样限制，不包含完整模型证据',async()=>{
 const value=referenceDraft(),ref=reference({reusableStructure:['开头提问','现场演示','结果解释','结尾回应','第五项不纳入摘要']}),plan=await inferProductionPlan({draft:value,reference:ref,providers:provider()});plan.modelEvidence.responseText='这是不应复制的原始模型回包';
 const prompt=planPrompt(plan);assert.match(prompt,/旁白配合分镜画面/);assert.match(prompt,/仅列有限结构项/);assert.match(prompt,/采样不是完整动作或剪辑时间线/);assert.match(prompt,/问题开场/);assert.match(prompt,/不是内容质量验收或模型能力证明/);assert.doesNotMatch(prompt,/第五项不纳入摘要|这是不应复制的原始模型回包|responseText|request-local-1/);
});
