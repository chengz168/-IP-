const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('真实C识别保持走一走和幾分鐘完整，正文及原始词时间不变',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/caption-C-phrase-recognition.json'),'utf8'));
 const before=JSON.stringify(fixture.recognition),rows=recognitionRows(fixture.recognition,fixture.duration,{maxChars:6});
 assert.deepEqual(rows.slice(0,2),[{start:0,end:.5,text:'晚上出來'},{start:.5,end:1.12,text:'走一走'}]);
 assert(rows.some(row=>row.text==='先給自己留'&&row.start===3.72&&row.end===4.56));
 assert(rows.some(row=>row.text==='幾分鐘'&&row.start===4.56&&row.end===5.02));
 assert.equal(rows.map(row=>row.text).join(''),fixture.recognition.segments.map(row=>row.text).join(''));
 assert.equal(JSON.stringify(fixture.recognition),before);
 const starts=new Set(fixture.recognition.segments.flatMap(row=>row.words.map(word=>word.start))),ends=new Set(fixture.recognition.segments.flatMap(row=>row.words.map(word=>word.end)));
 assert(rows.every(row=>starts.has(row.start)&&ends.has(row.end)&&Array.from(row.text).length<=6));
});

test('重复否定式与数量时间单位沿真实完整词调整，不改变标点',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const cases=[
  [['今天','这事','好','不','好'],['今天这事','好不好']],
  [['现在','先准备','三','分钟，'],['现在先准备','三分钟，']],
  [['现在','先准备','2','小时。'],['现在先准备','2小时。']]
 ];
 for(const [parts,expected]of cases){const words=parts.map((word,i)=>({word,start:i*.2,end:(i+1)*.2}));const rows=recognitionRows({segments:[{start:0,end:words.at(-1).end,text:parts.join(''),words}]},10,{maxChars:6});assert.deepEqual(rows.map(row=>row.text),expected);}
});

test('跨停顿或标点、词不可拆、合并超限及非时间名词保持原分组',async()=>{
 const {recognitionRows}=await import('../server/caption-recognition.mjs');
 const cases=[
  {parts:['晚上','出来','走','一走'],gap:1.2,max:6,expected:['晚上出来走','一走']},
  {parts:['晚上','出来','走，','一走'],max:6,expected:['晚上出来走，','一走']},
  {parts:['晚上','出来走','一走'],max:6,expected:['晚上出来走','一走']},
  {parts:['现在','走','一走吧'],max:3,expected:['现在走','一走吧']},
  {parts:['现在','先准备','三','方案，'],max:6,expected:['现在先准备三','方案，']}
 ];
 for(const c of cases){const words=c.parts.map((word,i)=>({word,start:i*.2+(i===c.parts.length-1?(c.gap||0):0),end:(i+1)*.2+(i===c.parts.length-1?(c.gap||0):0)}));const rows=recognitionRows({segments:[{start:0,end:words.at(-1).end,text:c.parts.join(''),words}]},10,{maxChars:c.max});assert.deepEqual(rows.map(row=>row.text),c.expected);}
});
