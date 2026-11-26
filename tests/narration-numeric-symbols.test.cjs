const {test}=require('node:test');
const assert=require('node:assert/strict');
const {alignNarrationShots}=require('../server/story-narration.cjs');
const {mapNarrationReference,numericSignature}=require('../server/narration-reference.cjs');
const {mapSubtitleReference}=require('../server/subtitle-reference-mapping.cjs');
const recognition=text=>({segments:[{start:0,end:5,text}]});
const shot=text=>[{id:'shot',text}];
const rejected=[
 ['板厚1.2毫米。','板厚12毫米。'],['板厚12毫米。','板厚1.2毫米。'],['板厚.5毫米。','板厚5毫米。'],
 ['占比12%。','占比12。'],['占比12。','占比12%。'],
 ['占比１２％。','占比１２。'],['占比12‰。','占比12%。'],
 ['温度-12度。','温度12度。'],['温度−12度。','温度+12度。'],
 ['温度负十二度。','温度十二度。'],['温度负一。','温度一。'],
 ['板厚一点二毫米。','板厚十二毫米。'],['占比百分之十二。','占比十二。'],
 ['长度10里米。','长度10厘米。'],['长度10毫米。','长度10厘米。'],
 ['占比百分之十二点五。','占比百分之十二点六。']
];
test('严格旁白路径在去标点前保护小数百分比负号和中文量值',async()=>{
 for(const [actual,reference]of rejected){
  const raw=recognition(actual),before=structuredClone(raw);
  await assert.rejects(alignNarrationShots(shot(reference),reference,raw,5),/数字或否定/);
  await assert.rejects(alignNarrationShots(shot(reference),reference,raw,5,{allowReferenceMapping:true}),/数字或否定/);
  assert.deepEqual(raw,before);
 }
});
test('显式旁白映射与字幕映射不能借拼音相同或去标点放行量值变化',async()=>{
 for(const [actual,reference]of rejected){
  await assert.rejects(mapNarrationReference(shot(reference),reference,recognition(actual),5),/数字或否定/);
  await assert.rejects(mapSubtitleReference([{id:'row',start:0,end:5,text:actual}],reference),/数字或否定/);
 }
});
test('全角字形繁简小数点负号规范与普通标点差异保留原有映射规则',async()=>{
 for(const [actual,reference]of [
  ['板厚１２．５毫米。','板厚12.5毫米！'],
  ['占比１２％。','占比12%。'],
  ['温度−12度。','温度-12度。'],
  ['板厚一點二毫米。','板厚一点二毫米。'],
  ['占比百分之十二點五。','占比百分之十二点五。'],
  ['这些板材，厚度10毫米。','这些板材厚度10毫米！']
 ]){
  assert.equal(numericSignature(actual),numericSignature(reference));
  const out=await alignNarrationShots(shot(reference),reference,recognition(actual),5,{allowReferenceMapping:true});
  assert.equal(out.requiresReview,true);
  const subtitle=await mapSubtitleReference([{id:'row',start:0,end:5,text:actual}],reference);
  assert.equal(subtitle.suggestions[0].start,0);assert.equal(subtitle.suggestions[0].end,5);
 }
});
test('自然词形中的疑似数词仍走既有回听保护，不误判一起和同音设备名为量值',async()=>{
 const actual='大家一起看一看版面让镜头以晃而过再看看八炉',reference='大家一起看一看板面让镜头一晃而过再看看扒炉';
 assert.equal(numericSignature(actual),numericSignature(reference));
 const out=await mapNarrationReference(shot(reference),reference,recognition(actual),5);
 assert.equal(out.requiresReview,true);assert(out.referenceMapping.ambiguousNumeralChanges.length);
});
