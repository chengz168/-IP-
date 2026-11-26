const {test}=require('node:test'),assert=require('node:assert/strict');
const {wrapLines,toAss}=require('../server/subtitles.cjs');
const width=text=>Array.from(text).reduce((sum,ch)=>sum+(/[\u0000-\u007f]/.test(ch)?.6:1),0);

test('实际短句不再让最后的单字或句末标点独占第二行',()=>{
 for(const text of ['准备选购扒炉的朋友，可以一起看。先不急','这里有亚光的，也有亮镜面的，摆在一起，','再把镜头拉近，看看表面具体是什么样子。','让厂家把样品、厚度和具体配置对应起来，']){
  const rows=wrapLines(text,18);assert.equal(rows.join(''),text);
  assert(rows.every(row=>width(row)<=18+1e-7));assert(rows.every(row=>width(row)>=6));
  assert(rows.slice(1).every(row=>!row.match(/^[，。！？；：、,.!?;:]/)));
 }
});

test('正常显式换行和空段保留，不跨段重新均衡',()=>{
 assert.deepEqual(wrapLines('第一行。\r\n\r\n第二行。\n',18),['第一行。','','第二行。','']);
 assert.deepEqual(wrapLines('大家好。\n今天来看看扒炉。',18),['大家好。','今天来看看扒炉。']);
});

test('换行保留中文数字单位、小数、英文与原始字符',()=>{
 for(const max of [6,10,18]){
  const text='板材厚度有10毫米、12毫米和16毫米，型号ABC123，长1.25米。';
  const rows=wrapLines(text,max);assert.equal(rows.join(''),text);
  for(const token of ['10毫米','12毫米','16毫米','ABC123','1.25米'])assert(rows.some(row=>row.includes(token)),token+'不应在行间拆开');
  assert(rows.every(row=>width(row)<=max+1e-7));
 }
});

test('连续长英文数字可保底折行，Unicode字符不丢失且不超宽',()=>{
 for(const text of ['ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890','中文😀字幕\u{20000}示例'.repeat(9),'中'.repeat(200)]){
  const rows=wrapLines(text,6);assert.equal(rows.join(''),text);assert(rows.every(row=>width(row)<=6+1e-7));
 }
 for(const bad of [0,-1,Infinity,NaN])assert.throws(()=>wrapLines('字幕',bad),/宽度/);
});

test('单位被系统分成多词时，仍整体保护可容纳的数字与单位',()=>{
 for(const token of ['10分米','10万元','1.25平方米','12 千克']){
  const text='请看这个规格'+token+'，再核对参数。',rows=wrapLines(text,6);
  assert.equal(rows.join(''),text);assert(rows.some(row=>row.includes(token)),token+'应完整显示');
  assert(rows.every(row=>width(row)<=6+1e-7));
 }
});

test('数量优先的窄宽回退不会放宽普通词末的标点限制',()=>{
 for(const [text,max] of [['extraordinary，',8],['巧克力，',3]]){
  const rows=wrapLines(text,max);assert.equal(rows.join(''),text);
  assert(rows.every(row=>width(row)<=max+1e-7));assert(rows.every(row=>row!=='，'));
 }
 // 整个数量可放入、加后续逗号却超宽时，优先不拆数字单位，允许这一窄宽例外。
 assert.deepEqual(wrapLines('1.25平方米，',6),['1.25平方米','，']);
});

test('ASS只调整换行，字幕顺序、起止时间和数字保持',()=>{
 const text='这里有亚光的，也有亮镜面的，摆在一起，',row={start:1.23,end:4.56,text};
 const result=toAss([row],720,1280,{maxChars:18});
 assert.match(result,/Dialogue: 0,00:00:01.23,00:00:04.56/);
 assert(result.includes(wrapLines(text,18).join('\\N')));assert.equal(row.text,text);
});
