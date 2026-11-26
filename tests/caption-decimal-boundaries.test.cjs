const {test}=require('node:test'),assert=require('node:assert/strict');

test('历史真实数字词1368.94保持同条，不把小数点当句号或生成词内时间',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const parts=[['三',103.92,104.2],['大',104.2,104.38],['账',104.38,104.52],['户',104.52,104.7],['合',104.7,104.96],['计',104.96,105.12],['重',105.12,105.3],['仓',105.3,105.46],['大',105.46,105.68],['约',105.68,105.84],['13',105.84,106.18],['68.',106.18,106.94],['94',107.36,107.58],['万',107.58,107.9],['股',107.9,108.4]];
 const words=parts.map(([word,start,end])=>({word,start,end})),source={segments:[{start:103.92,end:108.4,text:words.map(w=>w.word).join(''),words}]},before=structuredClone(source);
 const rows=recognitionRows(source,200,{maxChars:6});
 assert(rows.some(row=>row.text==='1368.94'&&row.start===105.84&&row.end===107.58));
 assert.equal(rows.map(row=>row.text).join(''),source.segments[0].text);assert.deepEqual(source,before);
 const starts=new Set(words.map(w=>w.start)),ends=new Set(words.map(w=>w.end));assert(rows.every(row=>starts.has(row.start)&&ends.has(row.end)));
});

test('小数百分比及全角数字完整，非数值句点和独立数字保持现有分组',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 for(const [parts,maxChars,expected]of [
  [['增长','26','.','6','%','。'],6,['增长','26.6%。']],
  [['增长','２６','．','６','％','。'],6,['增长','２６．６％。']],
  [['第一句.','第二句。'],18,['第一句.','第二句。']],
  [['组合','604','113'],6,['组合604','113']],
  [['当前','1368','.','94'],3,['当前','1368.94']]
 ]){const words=parts.map((word,i)=>({word,start:i*.2,end:(i+1)*.2})),source={segments:[{start:0,end:words.at(-1).end,text:parts.join(''),words}]};assert.deepEqual(recognitionRows(source,10,{maxChars}).map(r=>r.text),expected);}
});

test('历史跨段小数仅在短停顿的识别断句合并，手工恢复及长停顿不改变',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const segments=[{start:113.86,end:116.5,text:'三大帳戶合計重倉約1368.'},{start:116.92,end:117.7,text:'94萬股'}],before=structuredClone(segments);
 assert.deepEqual(recognitionRows({segments},300,{maxChars:6}),[{start:113.86,end:117.7,text:'三大帳戶合計重倉約1368.94萬股'}]);
 assert.deepEqual(recognitionRows({segments},300),segments);assert.deepEqual(segments,before);
 const paused=[segments[0],{...segments[1],start:117.2,end:118}];assert.deepEqual(recognitionRows({segments:paused},300,{maxChars:6}),paused);
 for(const rows of [
  [{start:0,end:1,text:'第一句.'},{start:1,end:2,text:'94萬股'}],
  [{start:0,end:1,text:'编号1368'},{start:1,end:2,text:'94件'}],
  [{start:0,end:1,text:'编号1368。'},{start:1,end:2,text:'94件'}]
 ])assert.deepEqual(recognitionRows({segments:rows},10,{maxChars:6}),rows);
});
