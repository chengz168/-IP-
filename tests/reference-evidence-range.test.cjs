const test=require('node:test'),assert=require('node:assert/strict');
const {transcriptChunks,validateAnalysis}=require('../server/reference-analysis.cjs');

const text='我們先不談，不能漏掉否定字。'.repeat(12)+'现在切换简体，保留原始转写。'.repeat(12)+'最后提醒核对来源。'.repeat(12);
function report(){const chunks=transcriptChunks(text);return {summary:'按来源先后整理表达结构。',hook:{basis:'none',kind:'未识别',quote:'',visualSamples:[],transcriptRange:[],explanation:'没有确认明确钩子。'},sections:chunks.map(c=>({basis:'transcript',label:'第'+c.sample+'段',purpose:'分析本片段表达作用。',quote:'',visualSamples:[],transcriptRange:[c.sample,c.sample]})),ending:{basis:'transcript',quote:'',visualSamples:[],transcriptRange:[chunks.length-1,chunks.length-1],explanation:'结尾提醒核对来源。'},reusableStructure:['背景—分析—提醒'],uncertainties:['仅基于转写。']};}

test('编号从原文取回简繁混合与否定字，真实时间轴映射并保留逐字来源',()=>{
 const chunks=transcriptChunks(text),out=validateAnalysis(report(),{text,segments:[{text,start:1,end:50}]},51);
 assert.equal(chunks.map(c=>c.text).join(''),text);assert.equal(out.sections.map(s=>s.quote).join(''),text);
 assert.equal(out.sections[0].start,1);assert.equal(out.sections.at(-1).end,50);assert.ok(out.sections[0].quote.includes('我們先不談'));
 for(const chunk of chunks)assert.equal(text.slice(chunk.start,chunk.end),chunk.text);
});

test('编号定位重复文本不会冒用前一次位置，无有效轴仍不造时间',()=>{
 const out=validateAnalysis(report(),{text},51);assert.equal(out.sections[1].start,null);assert.equal(out.sections[1].end,null);
 const repeated='重复'.repeat(50),source=repeated.repeat(4),a=report();a.sections=[{...a.sections[0],transcriptRange:[2,2]}];a.ending={...a.ending,basis:'none',transcriptRange:[]};
 const timed=validateAnalysis(a,{text:source,segments:Array.from({length:4},(_,i)=>({text:repeated,start:i,end:i+1}))},4);
 assert.equal(timed.sections[0].start,2);assert.equal(timed.sections[0].end,3);
 const emoji='😀'.repeat(101)+'结束';const chunks=transcriptChunks(emoji);assert.equal(chunks[0].text,'😀'.repeat(100));assert.equal(chunks[1].start,200);assert.equal(chunks.map(c=>c.text).join(''),emoji);
});

test('编号越界、倒序、重叠、非整数、混入视觉依据都必须拒绝',()=>{
 for(const range of [[-1,0],[0,999],[1,0],[0.1,1],[0],[0,1,2],null,'0']){const a=report();a.sections[0].transcriptRange=range;assert.throws(()=>validateAnalysis(a,{text},51),/第1段.*编号/);}
 for(const range of [[0,0],[0,1]]){const a=report();a.sections[1].transcriptRange=range;assert.throws(()=>validateAnalysis(a,{text},51),/第2段.*顺序/);}
 const a=report();a.sections[0].basis='visual';assert.throws(()=>validateAnalysis(a,{text},51),/编号/);
});

test('编号与改写摘录冲突拒绝，旧逐字引用仍接受，漏否定字不能模糊匹配',()=>{
 const a=report();a.sections[0].quote=transcriptChunks(text)[0].text.replaceAll('不談','談');assert.throws(()=>validateAnalysis(a,{text},51),/第1段.*不一致/);
 const b=report();b.sections=[{basis:'transcript',quote:'我們先談',label:'漏字',purpose:'错误示例'}];assert.throws(()=>validateAnalysis(b,{text},51),/第1段.*不在原始转写/);
 b.sections[0].quote='我們先不談';assert.equal(validateAnalysis(b,{text},51).sections[0].quote,'我們先不談');
});

test('编号仍检查钩子在开头与结尾在末尾',()=>{
 const a=report();a.hook={...a.hook,basis:'transcript',transcriptRange:[transcriptChunks(text).length-1,transcriptChunks(text).length-1]};assert.throws(()=>validateAnalysis(a,{text},51),/开头/);
 const b=report();b.ending.transcriptRange=[0,0];assert.throws(()=>validateAnalysis(b,{text},51),/结尾/);
});
