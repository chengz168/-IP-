const test=require('node:test'),assert=require('node:assert/strict');

test('设备选购正文不被日常清洁和否定对白要求改成生活或剧情',async()=>{
 const {detectContentProfile}=await import('../server/content-types.mjs');
 const text='大家好，咱们厂做扒炉会用到这些板材。选购时要看板面厚度，再请厂家示范日常应该怎样清洁，把操作看明白。';
 for(const suffix of ['', '\n禁止对白和剧情，不要口播。', '\n生成不包含文字、字幕、对白或音乐。']){
  const profile=detectContentProfile({text:text+suffix});
  assert.equal(profile.type,'product-promo');assert.equal(profile.presetId,'product');
  assert.equal(profile.confidence,'medium');assert.equal(profile.needsUserConfirmation,true);
  assert.ok(!profile.candidates.some(row=>['lifestyle-vlog','story-drama'].includes(row.id)));
 }
});

test('单个设备名称不制造商品事实或高置信度',async()=>{
 const {detectContentProfile}=await import('../server/content-types.mjs');
 for(const text of ['扒炉','板材','在扒炉旁边记录生活']){
  const profile=detectContentProfile({text});assert.notEqual(profile.type,'product-promo');assert.equal(profile.confidence,'low');assert.equal(profile.needsUserConfirmation,true);
 }
});

test('同分弱关键词保留候选但不按id排序决定题材',async()=>{
 const {detectContentProfile,validateContentProfile}=await import('../server/content-types.mjs');
 const profile=detectContentProfile({text:'日常 产品 对白 讲解'});
 assert.equal(profile.type,'talking-head');assert.equal(profile.presetId,'general');assert.equal(profile.confidence,'low');assert.equal(profile.needsUserConfirmation,true);assert.match(profile.reason,/类型待确认.*同分/);assert.equal(profile.candidates.length,4);assert.deepEqual(validateContentProfile(profile),profile);
});

test('正文与补充要求隔离，生成限制保留在快照而不参与自动题材路由',async()=>{
 const {resolveCreativePreset}=await import('../server/creative-presets.mjs');
 const sourceText='大家好，咱们厂做扒炉选用这些板材，选购时先看板面的厚度，再问厂家如何清洁。';
 const draft={story:{sourceText,instructions:'剧情故事短剧角色对白，日常探店vlog。禁止对白和音乐。'}};
 const before=JSON.stringify(draft),route=resolveCreativePreset(draft,'video');
 assert.equal(route.id,'product');assert.equal(route.contentProfile.type,'product-promo');assert.equal(route.contentProfile.needsUserConfirmation,true);assert.equal(JSON.stringify(draft),before);
 assert.ok(!route.contentProfile.candidates.some(row=>['lifestyle-vlog','story-drama'].includes(row.id)));
 assert.match(JSON.parse(route.inputHash).content,/剧情故事短剧角色对白/);
 const changed=resolveCreativePreset({...draft,story:{...draft.story,instructions:'另一条生成限制'}},'video');assert.notEqual(changed.inputHash,route.inputHash);assert.deepEqual(changed.contentProfile,route.contentProfile);
});

test('手动product保持优先且不降低人工确认，商品来源仍有原有确定性',async()=>{
 const {resolveCreativePreset,creativePresetPrompt}=await import('../server/creative-presets.mjs');
 const route=resolveCreativePreset({creativePreset:{mode:'manual',presetId:'product'},story:{sourceText:'日常 产品 对白 讲解',instructions:'禁止对白'}},'video');
 assert.equal(route.mode,'manual');assert.equal(route.id,'product');assert.equal(route.contentProfileApplied,false);assert.equal(route.contentProfile.needsUserConfirmation,true);assert.doesNotMatch(creativePresetPrompt(route),/自动识别的内容类型画像/);
 const explicit=resolveCreativePreset({product:{title:'扒炉',description:'规格和日常清洁'}},'script',{kind:'product'});assert.equal(explicit.id,'product');assert.equal(explicit.contentProfile.confidence,'high');
});

test('正常故事与生活内容仍能识别，禁止词不抹掉前面的正向题材',async()=>{
 const {detectContentProfile}=await import('../server/content-types.mjs');
 assert.equal(detectContentProfile({text:'故事剧情中的角色对白。禁止水印。'}).type,'story-drama');
 assert.equal(detectContentProfile({text:'不要对白，但保留这个故事的剧情和角色。'}).type,'story-drama');
 assert.equal(detectContentProfile({text:'不能跳过检查，安装教程按步骤设置。'}).type,'tutorial');
 assert.equal(detectContentProfile({text:'日常生活记录，旅行探店。不要对白。'}).type,'lifestyle-vlog');
 assert.equal(detectContentProfile({text:'猫咪 小猫 萌宠 日常'}).type,'pet-animal');
});
