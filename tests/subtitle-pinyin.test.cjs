const test=require('node:test'),assert=require('node:assert/strict');
const {pinyinRows,pinyinProvider}=require('../server/subtitle-pinyin.cjs');
const {nativeSubtitleFontFiles,subtitleEngineVersion,subtitleOutputCurrent}=require('../server/subtitle-output.mjs');

test('真实固定词典的单字首音与原模板参数相同，不合成上下文读音',async()=>{
 const output=await pinyinRows(['重庆银行音乐长大','嗯女绿吕谁']);
 assert.deepEqual(output,[['zhòng','qìng','yín','háng','yīn','lè','cháng','dà'],['ňg','nǚ','lǜ','lǚ','shuí']]);
 assert.equal(require('pinyin/package.json').version,pinyinProvider.pinyinVersion);assert.equal(pinyinProvider.pinyinDictionaryParity,false);assert.equal(pinyinProvider.pinyinReferenceInstalledVersionVerified,false);
});
test('BMP边界仅按原模板覆盖范围标注，符号、代理对和换行逐字符留空',async()=>{
 const text='\u33ff㐀\u4dbf\u4dc0一鿿\ua000😀𠀀A1\r\n\t〇，';
 const result=(await pinyinRows([text]))[0],chars=Array.from(text);assert.equal(result.length,chars.length);
 assert.equal(result[1],'qiū');assert.equal(result[4],'yī');assert.equal(result[5],'鿿');
 for(const index of [0,3,6,7,8,9,10,11,12,13,14,15])assert.equal(result[index],'');
});
test('空列表与空行不增加注音，不修改输入',async()=>{
 const input=['','认真做好每一步','abc中文'],before=JSON.stringify(input);assert.deepEqual(await pinyinRows([]),[]);const result=await pinyinRows(input);assert.deepEqual(result[0],[]);assert.equal(result[2].length,5);assert.equal(JSON.stringify(input),before);
});
test('输入类型、条数及字符上限在处理前拒绝',async()=>{
 for(const value of [null,{},'正文',[1],[{}],Array(20001).fill(''),['字'.repeat(200001)]])await assert.rejects(pinyinRows(value),/文本|上限/);
});
test('已取消和处理中取消都拒绝，不返回半份注音',async()=>{
 const before=new AbortController();before.abort();await assert.rejects(pinyinRows(['正文'],{signal:before.signal}),/abort/i);
 const during=new AbortController(),pending=pinyinRows(['字'.repeat(200000)],{signal:during.signal});setImmediate(()=>during.abort());await assert.rejects(pending,/abort/i);
});
test('一次允许的20万字符可逐字完成，所有行保持对齐',async()=>{
 const input=Array(200).fill('你'.repeat(1000)),output=await pinyinRows(input);assert.equal(output.length,200);assert.ok(output.every(row=>row.length===1000&&row.every(s=>s==='nǐ')));
});
test('只使白色注音旧engine2结果失效，其他21模板保持有效',()=>{
 for(const id of Object.keys(nativeSubtitleFontFiles)){
  const draft={edit:{subtitlesEnabled:true,subtitleMode:'template',subtitleTemplate:id}},asset={renderedSubtitleTemplate:{templateId:id,engineVersion:2}},before=JSON.stringify({draft,asset});
  assert.equal(subtitleOutputCurrent(draft,asset),id!=='white_pinyin');assert.equal(subtitleEngineVersion(id),id==='white_pinyin'?3:2);assert.equal(JSON.stringify({draft,asset}),before);
  asset.renderedSubtitleTemplate.engineVersion=3;assert.equal(subtitleOutputCurrent(draft,asset),true);
 }
});
