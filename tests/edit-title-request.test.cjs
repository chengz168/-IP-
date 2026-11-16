const test=require('node:test'),assert=require('node:assert/strict');
const moduleReady=import('../server/edit-title-request.mjs');
const draft=()=>({id:'test',language:'zh',finalText:'把同主题读书卡片归组，再写小标题。',edit:{sourceId:'video',title:'原主标题',subtitle:'原副标题',captions:[{text:'字幕来源'}]}});

test('剪辑标题按已确认文案、改写、原稿、字幕回退，空白不阻断回退',async()=>{
 const m=await moduleReady,d=draft(),before=structuredClone(d);assert.equal(m.editTitleText(d),d.finalText);d.finalText='  ';d.rewrite='改写';d.sourceText='原稿';assert.equal(m.editTitleText(d),'改写');d.rewrite='';assert.equal(m.editTitleText(d),'原稿');d.sourceText='';d.edit.captions=[{text:'  第一句 '},{content:'第二句'},null,{text:' '}];assert.equal(m.editTitleText(d),'第一句\n第二句');assert.equal(before.finalText,'把同主题读书卡片归组，再写小标题。');
 assert.equal(m.canGenerateEditTitle(d),true);d.edit.sourceId='';assert.equal(m.canGenerateEditTitle(d),false);d.video={assetId:'generated'};assert.equal(m.canGenerateEditTitle(d),true);d.edit.captions=[];assert.equal(m.canGenerateEditTitle(d),false);
});
test('视频、字幕回退正文、语言和手工标题变化均阻止迟到覆盖',async()=>{
 const m=await moduleReady;
 for(const change of [d=>d.edit.sourceId='new',d=>d.language='en',d=>d.edit.captions[0].text='改变字幕',d=>d.edit.title='手工修改']){const d=draft();d.finalText='';const before=m.editTitleSignature(d);change(d);assert.notEqual(m.editTitleSignature(d),before);}
 const d=draft(),signature=m.editTitleSignature(d);d.edit.captions[0].text='未使用字幕不影响正文';assert.equal(m.editTitleSignature(d),signature);
});
test('原版剪辑标题提示词保留双行标签和4至8字要求，语言标签按区域回退',async()=>{
 const m=await moduleReady,d=draft(),prompt=m.editTitlePrompt(d);assert(prompt.startsWith('请根据视频文案生成新版灵动剪辑画面上方的双行标题。\n\n要求：\n目标语言：中文\n标题内容都必须使用中文。\n返回格式的字段名仍使用中文，字段值使用目标语言。\n主标题：4-8 个字'));assert(prompt.endsWith(d.finalText+'\n\n只输出：\n主标题：xxx\n副标题：xxx'));assert(!prompt.includes('JSON'));d.language='en-US';assert.equal(m.editTitleLanguage(d),'英语');d.language='zh-HK';assert.equal(m.editTitleLanguage(d),'粤语');d.language='中文';assert.equal(m.editTitleLanguage(d),'中文');
});
test('实际Provider请求使用原版提示正文、温度0.8和300上限，不再混入JSON包装',async()=>{
 const {Providers}=require('../server/providers.cjs'),{generateTitle}=require('../server/title-generation.cjs'),d=draft(),before=JSON.stringify(d),bodies=[],p=new Providers({data:{settings:{provider:{baseUrl:'http://127.0.0.1:11434',model:'test',textProtocol:'ollama',textMaxTokens:'2048'}}}},null,{get:async()=>''});
 p.request=async(url,options)=>{bodies.push(JSON.parse(options.body));return {json:async()=>({message:{content:'主标题：卡片分组技巧\n副标题：笔记更好整理'},done_reason:'stop'})};};
 const result=await generateTitle(p,d,{});assert.equal(bodies.length,1);assert.deepEqual(bodies[0].options,{num_predict:300,temperature:.8});assert.equal(bodies[0].format,undefined);assert.equal(bodies[0].messages[0].content,'');assert.equal(bodies[0].messages[1].content,(await moduleReady).editTitlePrompt(d));assert.equal(result.title,'卡片分组技巧');assert.equal(result.subtitle,'笔记更好整理');assert.equal(result.quality.accepted,false);assert.equal(result.parity.streaming,false);assert.equal(JSON.stringify(d),before);
});
test('模型格式失败保留请求回包，缺视频不发请求，取消不写原稿',async()=>{
 const {generateTitle}=require('../server/title-generation.cjs'),d=draft(),before=JSON.stringify(d);let calls=0;
 const p={config:()=>({baseUrl:'http://127.0.0.1:11434',model:'test'}),text:async()=>{calls++;return {text:'主标题：只有一行',request:{model:'test'}};}};
 await assert.rejects(generateTitle(p,d,{}),e=>e.evidence.rawText==='主标题：只有一行'&&e.evidence.request.model==='test');assert.equal(calls,1);d.edit.sourceId='';await assert.rejects(generateTitle(p,d,{}),/视频或文案/);assert.equal(calls,1);d.edit.sourceId='video';p.text=async()=>{throw new Error('请求已停止');};await assert.rejects(generateTitle(p,d,{}),/已停止/);assert.equal(JSON.stringify(d),before);
});
test('中文标签解析支持全角半角冒号和CRLF，仍拒绝空标题',()=>{
 const {parseTitle}=require('../server/title-generation.cjs');assert.deepEqual(parseTitle('主标题: 卡片归组\r\n副标题：方便复述'),{title:'卡片归组',subtitle:'方便复述'});for(const raw of ['主标题：\n副标题：没有主标题','主标题：只有一行','{错误格式}'])assert.throws(()=>parseTitle(raw));
});
