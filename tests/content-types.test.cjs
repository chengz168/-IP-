const test=require('node:test');
const assert=require('node:assert/strict');

test('内容类型目录覆盖主要短视频和商品制作类型',async()=>{
 const {contentTypeCatalog,detectContentProfile}=await import('../server/content-types.mjs');
 const catalog=contentTypeCatalog();
 assert.ok(catalog.length>=10);
 const cases=[
  [{sourceKind:'product-page',title:'商品详情页',description:'成分与规格介绍'},'product-promo'],
  [{sourceKind:'text',text:'三步安装教程，完成设置后检查结果'},'tutorial'],
  [{sourceKind:'text',text:'科普光的原理和适用范围'},'knowledge'],
  [{sourceKind:'text',text:'测评对比两种方案的优缺点'},'review'],
  [{sourceKind:'text',text:'财报营收同比与产业链数据'},'data-explainer'],
  [{sourceKind:'text',text:'故事剧情中的角色对白'},'story-drama'],
  [{sourceKind:'text',text:'猫咪 小猫 萌宠 日常'},'pet-animal'],
  [{sourceKind:'text',text:'非口播纯画面展示与音乐氛围'},'non-verbal-visual']
 ];
 for(const [input,expected] of cases){
  const profile=detectContentProfile(input);
  assert.equal(profile.type,expected,JSON.stringify(input));
  assert.ok(profile.pipeline.length>0);
  assert.equal(typeof profile.reason,'string');
 }
});

test('商品来源优先于正文中的泛关键词，且自动路由包含商品链路',async()=>{
 const {detectContentProfile}=await import('../server/content-types.mjs');
 const profile=detectContentProfile({sourceKind:'product-page',title:'猫咪日常',description:'这是商品详情页，介绍规格和使用方法'});
 assert.equal(profile.type,'product-promo');
 assert.equal(profile.presetId,'product');
 assert.ok(profile.pipeline.includes('product-script'));
 assert.match(profile.reason,/商品|详情页/);
});

test('参考视频的音乐视觉分析路由到非口播，不能把歌词当成口播',async()=>{
 const {detectContentProfile,contentTypePrompt}=await import('../server/content-types.mjs');
 const profile=detectContentProfile({sourceKind:'reference-video',analysis:{contentType:'music-visual',summary:'转写疑似歌词，画面承担主体叙事'}});
 assert.equal(profile.type,'non-verbal-visual');
 assert.equal(profile.outputMode,'visual');
 assert.equal(profile.needsUserConfirmation,false);
 assert.match(contentTypePrompt(profile),/只用于路由建议/);
});

test('没有明确依据时保持低置信度并要求用户确认',async()=>{
 const {detectContentProfile}=await import('../server/content-types.mjs');
 const profile=detectContentProfile({sourceKind:'text',text:'今天记录一些事情'});
 assert.equal(profile.confidence,'low');
 assert.equal(profile.needsUserConfirmation,true);
 assert.equal(profile.type,'talking-head');
 assert.equal(profile.presetId,'general');
 assert.ok(profile.type);
 assert.match(profile.reason,/没有命中/);
});

test('画像校验拒绝过期版本、未知类型和缺失路由字段',async()=>{
 const {detectContentProfile,validateContentProfile}=await import('../server/content-types.mjs');
 const profile=detectContentProfile({sourceKind:'text',text:'知识科普'});
 assert.deepEqual(validateContentProfile(profile),profile);
 for(const invalid of [null,{}, {...profile,version:'old'}, {...profile,type:'unknown'}, {...profile,confidence:'unknown'}, {...profile,pipeline:null}, {...profile,rules:null}]){
  assert.throws(()=>validateContentProfile(invalid),/内容类型画像/);
 }
});
