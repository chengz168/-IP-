const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDraft}=require('../server/store.cjs'),proofread=require('../server/subtitle-proofread.cjs'),{wrapLines}=require('../server/subtitles.cjs');

function fixture(){
 const d=createDraft();d.confirmed=true;d.video.assetId=d.edit.sourceId='paragraph-video';
 d.finalText='大家好。\r\n \r\n今天来看看扒炉。\n\n\n厚度有10毫米、12毫米和16毫米。';
 d.edit.captions=[{id:'one',start:.1,end:4,text:'大家好今天来看看扒炉'},{id:'two',start:4,end:8,text:'厚度有10毫米、12毫米和16毫米'}];
 const data={assets:[{id:'paragraph-video',storyGeneration:{narrationAssetId:'audio'}},{id:'audio',speech:{request:{textSha256:proofread.hash(d.finalText),textLength:d.finalText.length}}}]};return {d,data};
}

for(const mapping of [false,true])test((mapping?'可信稿映射':'字符校对')+'只压缩建议的段落空行，保留正常换行、原稿和字幕时间',async()=>{
 const {d,data}=fixture(),before=structuredClone(d),result=await proofread.preview(d,data,{allowReferenceMapping:mapping});
 assert.deepEqual(d,before);assert.equal(result.reference.text,before.finalText);assert.deepEqual(result.originalCaptions,before.edit.captions);
 assert.equal(result.suggestions[0].proposed,'大家好。\n今天来看看扒炉。');
 assert(result.suggestions.every(s=>!/(?:\r?\n[\t ]*){2,}/.test(s.proposed)));
 assert(result.suggestions.every(s=>wrapLines(s.proposed,18).every(row=>row.trim())));
 const rows=proofread.apply(d,result,[0,1],data);
 assert.deepEqual(rows.map(({id,start,end})=>({id,start,end})),before.edit.captions.map(({id,start,end})=>({id,start,end})));
 for(const word of ['10毫米','12毫米','16毫米'])assert(rows[1].text.includes(word));
 assert.deepEqual(d,before);
});
