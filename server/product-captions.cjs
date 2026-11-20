const pinyinPackage=require('pinyin'),pinyin=pinyinPackage.default||pinyinPackage;
const content=text=>Array.from(text).filter(char=>/[\p{L}\p{N}]/u.test(char));
const reading=char=>/\p{Script=Han}/u.test(char)?pinyin(char,{style:pinyin.STYLE_NORMAL,heteronym:false})?.[0]?.[0]||char:char.toLowerCase();
// 仅处理等长、极少读音差异的字幕；时间轴沿用识别结果，原始识别另行保留。
function productCaptions(rows,reference){
 const raw=rows.map(row=>row.text).join(''),detected=content(raw),expected=content(reference);
 const fail=()=>{throw Error('配音识别与确认稿差异较大，请检查配音或识别结果；未用估算时间轴替代');};
 if(!detected.length||detected.length!==expected.length)fail();
 const protectedWords=text=>(text.match(/[\p{N}]+|[零〇一二三四五六七八九十百千万亿两兩]+|不|没|沒|无|無|非|勿|未|别|別|禁止/gu)||[]).map(word=>content(word).map(reading).join('')).join('|');
 if(protectedWords(raw)!==protectedWords(reference))fail();
 const differences=detected.reduce((sum,char,index)=>sum+(reading(char)!==reading(expected[index])?1:0),0);
 if(differences>Math.min(2,Math.floor(expected.length*.03)))fail();
 const chars=Array.from(reference);let cursor=0;
 const captions=rows.map(row=>{const start=cursor,count=content(row.text).length;let used=0;while(cursor<chars.length&&used<count){if(/[\p{L}\p{N}]/u.test(chars[cursor]))used++;cursor++;}while(cursor<chars.length&&!/[\p{L}\p{N}]/u.test(chars[cursor]))cursor++;return {...row,text:chars.slice(start,cursor).join('').trim()};});
 if(cursor!==chars.length||captions.some(row=>!row.text))fail();
 const changed=rows.some((row,index)=>row.text!==captions[index].text);
 return {captions,proofreading:{method:'equal-length-reading-review-v1',changed,readingDifferences:differences,rawText:raw,referenceText:reference,requiresListening:changed,limitation:'字幕按确认稿校对，只保留原识别时间边界，不能据此证明实际发音正确。'}};
}
module.exports={productCaptions};
