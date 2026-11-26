const {mapNarrationReference,assertNumericFidelity}=require('./narration-reference.cjs');
const pinyinPackage=require('pinyin'),pinyin=pinyinPackage.default||pinyinPackage;
const content=value=>Array.from(value).filter(char=>/[\p{L}\p{N}]/u.test(char));
const reading=char=>/\p{Script=Han}/u.test(char)?pinyin(char,{style:pinyin.STYLE_NORMAL,heteronym:false})?.[0]?.[0]||char:char.normalize('NFKC').toLowerCase();
function localSimilarity(a,b){
 const left=content(a).map(reading),right=content(b).map(reading);let previous=Uint16Array.from({length:right.length+1},(_,index)=>index);
 for(let i=1;i<=left.length;i++){const current=new Uint16Array(right.length+1);current[0]=i;for(let j=1;j<=right.length;j++)current[j]=Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+(left[i-1]===right[j-1]?0:1));previous=current;}
 return left.length&&right.length?1-previous[right.length]/Math.max(left.length,right.length):0;
}

// 显式校对复用旁白映射的数值、否定、长度及缺句保护，不调用模型或更改识别时间。
async function mapSubtitleReference(rows,reference){
 assertNumericFidelity(rows.map(row=>row.text).join(''),reference);
 // 长度单位改变也影响商品规格，阿拉伯数字相同不能据此放行单位变化。
 const quantities=text=>(text.normalize('NFKC').match(/(?:[0-9]+(?:\.[0-9]+)?|[零〇一二三四五六七八九十百千万萬亿億两兩]+)(?:平方毫米|平方厘米|平方米|毫升|毫米|厘米|千米|公斤|千克|分钟|分鐘|小时|小時|秒钟|秒鐘|米|克|斤|升|元|角|秒|天|周|週|月|年|台|件|张|張|股|倍|个|個|款|次)/gu)||[]).map(value=>content(value).map(reading).join(':')).join('|');
 if(quantities(rows.map(row=>row.text).join(''))!==quantities(reference))throw Error('字幕与可信稿存在数量或单位变化，请先回听核对，未生成映射建议');
 const recognition={segments:structuredClone(rows)},duration=rows.at(-1).end;
 const mapped=await mapNarrationReference([{id:'subtitle-reference',text:reference}],reference,recognition,duration);
 const mapping=mapped.referenceMapping,source=content(rows.map(row=>row.text).join('')),target=content(reference),points=new Map();
 let left=0,right=0;
 const record=()=>{const prior=points.get(left);points.set(left,{min:Math.min(prior?.min??right,right),max:Math.max(prior?.max??right,right)});};record();
 for(const difference of mapping.differences){
  while(left<difference.sourceOffset&&right<difference.referenceOffset){left++;right++;record();}
  if(difference.original)left++;if(difference.reference)right++;record();
 }
 while(left<source.length&&right<target.length){left++;right++;record();}
 if(left!==source.length||right!==target.length)throw Error('字幕可信稿映射边界不完整，当前字幕已保留');
 const rawOffsets=[];let rawOffset=0;for(const char of reference){if(/[\p{L}\p{N}]/u.test(char))rawOffsets.push(rawOffset);rawOffset+=char.length;}rawOffsets.push(reference.length);
 let offset=0;
 const suggestions=rows.map((row,index)=>{
  const count=content(row.text).length,start=points.get(offset),end=points.get(offset+count);offset+=count;
  // 只压缩讲稿连续段落换行，不能改写正文、原字幕或生成新的时间切点。
  const from=start?.max,to=end?.max,proposed=Number.isInteger(from)&&Number.isInteger(to)&&to>from?reference.slice(index===0&&from===0?0:rawOffsets[from],rawOffsets[to]).replace(/(?:\r?\n[\t ]*){2,}/g,'\n').trim():'';
  const similarity=localSimilarity(row.text,proposed),ambiguous=!start||!end||start.min!==start.max||end.min!==end.max,warnings=[];
  if(ambiguous)warnings.push('字幕边界包含识别增漏字，未确认文字对应时间，请手工回听');
  if(similarity<mapping.thresholds.localSimilarity)warnings.push('本条拼音匹配不足，请手工回听核对');
  const differences=mapping.differences.filter(item=>item.sourceOffset>=offset-count&&item.sourceOffset<offset);
  const changed=row.text!==proposed;
  if(changed)warnings.push('可信稿字形或同音校对建议，必须回听；不证明实际发音正确');
  if(differences.some(item=>mapping.ambiguousNumeralChanges.includes(item)))warnings.push('存在词形中的疑似数词变化，须确认其含义与读音');
  return {index,start:row.start,end:row.end,original:row.text,proposed,similarity,changed,eligible:!!proposed&&!ambiguous&&similarity>=mapping.thresholds.localSimilarity,warnings,differences,requiresListening:changed};
 });
 return {mapping:{...mapping,captionBoundariesPreserved:true},suggestions,recognition};
}
module.exports={mapSubtitleReference};
