const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../server/store.cjs');
const {toTemplateAss,templateOptions}=require('../server/template-subtitles.cjs');
const {parseAuxiliary,generateAuxiliary}=require('../server/subtitle-auxiliary.cjs');
const {remapCaptions}=require('../server/silence.cjs');
const {SubtitleFonts}=require('../server/subtitle-fonts.cjs');
const {nativeSubtitleFontFiles}=require('../server/subtitle-output.mjs');

test('旧任务缺少关键词开关仍能渲染支持高亮的模板，默认不要求辅助关键词',async t=>{
  t.mock.method(SubtitleFonts.prototype,'catalog',()=>[{source:'local',file:nativeSubtitleFontFiles.yellow_white_bounce,family:'fixture',id:'fixture'}]);
  const edit={subtitleTemplate:'yellow_white_bounce',subtitleOffsetY:0},before=JSON.stringify(edit),store={data:{settings:{}}};
  const options=await templateOptions(edit,store);
  assert.equal(options.template.keywordSupported,true);assert.equal(options.keywords,false);
  const result=await toTemplateAss([{start:0,end:2,text:'认真做好每一步'}],608,1056,edit,store);
  assert.equal(result.metadata.keywords,false);assert.match(result.ass,/Dialogue:/);assert.equal(JSON.stringify(edit),before);
});

test('模板关键词开关仅接受布尔值或旧数据缺省值',async t=>{
  t.mock.method(SubtitleFonts.prototype,'catalog',()=>[{source:'local',file:nativeSubtitleFontFiles.yellow_white_bounce,family:'fixture'}]);
  const edit={subtitleTemplate:'yellow_white_bounce',subtitleOffsetY:0},store={data:{settings:{}}};
  for(const value of [null,0,1,'false','true',[],{}])await assert.rejects(templateOptions({...edit,subtitleKeywords:value},store),/关键词高亮设置无效/);
  assert.equal((await templateOptions({...edit,subtitleKeywords:true},store)).keywords,true);
  assert.equal((await templateOptions({...edit,subtitleKeywords:false},store)).keywords,false);
});

test('不支持关键词的模板对旧数据和显式开启均保持不高亮',async t=>{
  const {subtitleTemplates}=await import('../server/subtitle-templates.mjs');
  const template=subtitleTemplates.find(item=>!item.keywordSupported&&nativeSubtitleFontFiles[item.id]);
  assert.ok(template);
  t.mock.method(SubtitleFonts.prototype,'catalog',()=>[{source:'local',file:nativeSubtitleFontFiles[template.id],family:'fixture'}]);
  for(const subtitleKeywords of [undefined,false,true])assert.equal((await templateOptions({subtitleTemplate:template.id,subtitleOffsetY:0,subtitleKeywords},{data:{settings:{}}})).keywords,false);
});

test('模板不增加旧任务默认渲染分支，原文修改使旧译文和关键词失效',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'superip-template-test-'));
  try{const store=new Store(dir),draft=store.draft();assert.equal(draft.edit.subtitleMode,undefined);draft.edit.resultId='prior-result';draft.edit.captions=[{start:0,end:2,text:'原文',auxiliary:{sourceText:'原文',translation:'Original',keywords:['原文']}}];store.save();const next=structuredClone(draft);next.edit.captions[0].text='新文字';const saved=store.updateDraft(next);assert.equal(saved.edit.captions[0].auxiliary,undefined);assert.equal(saved.edit.resultId,'');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('真实辅助文本校验数量、序号、空译文、错误JSON和不在原文中的关键词',()=>{
  const rows=[{start:0,end:1,text:'认真做好每一步'}];
  assert.equal(parseAuxiliary('[{"index":0,"translation":"Make every step count."}]',rows,'translation')[0].auxiliary.translation,'Make every step count.');
  assert.deepEqual(parseAuxiliary('[{"index":0,"keywords":[]}]',rows,'keywords')[0].auxiliary.keywords,[]);
  for(const [value,kind]of [['{}','translation'],['not json','keywords'],['[{"index":1,"translation":"Text"}]','translation'],['[{"index":0,"translation":""}]','translation'],['[{"index":0,"keywords":["不存在"]}]','keywords']])assert.throws(()=>parseAuxiliary(value,rows,kind));
});
test('辅助文本禁止未经配置的远端地址，取消信号在发起模型请求前生效',async()=>{
  const providers={config:()=>({baseUrl:'https://example.com/v1',model:'none'}),text:()=>assert.fail('不应发送远端请求')};
  const draft={edit:{captions:[{start:0,end:1,text:'测试'}]}};
  await assert.rejects(generateAuxiliary(providers,draft,'translation',{}),/本机文本服务/);
  providers.config=()=>({baseUrl:'http://127.0.0.1:11434',model:'existing'});const control=new AbortController();control.abort();
  await assert.rejects(generateAuxiliary(providers,draft,'keywords',{signal:control.signal}),/abort/i);
});
test('剪口切割字幕仍保留源文对应的辅助文本',()=>{
  const rows=[{start:0,end:4,text:'认真做好每一步',auxiliary:{sourceText:'认真做好每一步',translation:'Make every step count.',keywords:['认真']}}];
  const remapped=remapCaptions(rows,[{start:0,end:1},{start:3,end:4}]);assert.equal(remapped.length,2);assert.ok(remapped.every(row=>row.auxiliary.sourceText===row.text));
});
test('模板选择参数非法时在读取字体和生成媒体之前失败',async()=>{
  const store={data:{settings:{}}};await assert.rejects(templateOptions({subtitleTemplate:'invalid'},store),/模板无效/);
  await assert.rejects(templateOptions({subtitleTemplate:'3d_flip',subtitleTemplateY:NaN,subtitleKeywords:true},store),/上下位置/);
  await assert.rejects(toTemplateAss([],0,1920,{},store),/尺寸或倍速/);
});
test('重新生成关键词清除旧输入原串，并保留有效译文',()=>{
  const rows=[{start:0,end:1,text:'认真做好每一步',auxiliary:{sourceText:'认真做好每一步',translation:'Make every step count.',keywords:['认真'],keywordsInput:'认真,'}}];
  const result=parseAuxiliary('[{"index":0,"keywords":["每一步"]}]',rows,'keywords')[0];assert.equal(result.auxiliary.keywordsInput,undefined);assert.equal(result.auxiliary.translation,'Make every step count.');assert.deepEqual(result.auxiliary.keywords,['每一步']);
});
