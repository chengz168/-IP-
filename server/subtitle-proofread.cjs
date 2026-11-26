const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const reference=(d,data)=>require('./subtitle-reference.mjs').trustedSubtitleReference(d,data,hash);
function signature(d,data){return hash(JSON.stringify({id:d.id,source:d.edit.sourceId||d.video.assetId,reference:reference(d,data),captions:d.edit.captions}));}
function units(text){const result=[];let offset=0;for(const value of text){if(/[\p{L}\p{N}]/u.test(value))result.push({value:value.normalize('NFKC').toLowerCase(),start:offset,end:offset+value.length});offset+=value.length;}return result;}
// 只对齐原有字符；回溯边界用于切分参考稿，不生成或移动字幕时间。
function align(a,b){
 const n=a.length,m=b.length,trace=new Uint8Array((n+1)*(m+1));let previous=Uint16Array.from({length:m+1},(_,i)=>i),current=new Uint16Array(m+1);
 for(let j=1;j<=m;j++)trace[j]=2;
 for(let i=1;i<=n;i++){current[0]=i;trace[i*(m+1)]=1;for(let j=1;j<=m;j++){let cost=previous[j-1]+(a[i-1].value===b[j-1].value?0:1),direction=0;if(previous[j]+1<cost){cost=previous[j]+1;direction=1;}if(current[j-1]+1<cost){cost=current[j-1]+1;direction=2;}current[j]=cost;trace[i*(m+1)+j]=direction;}[previous,current]=[current,previous];}
 const distance=previous[m],steps=[];let i=n,j=m;while(i||j){const direction=trace[i*(m+1)+j];steps.push(direction);if(direction===0){i--;j--;}else if(direction===1)i--;else j--;}
 const boundaries=new Uint32Array(n+1);i=0;j=0;for(const direction of steps.reverse()){if(direction!==1)j++;if(direction!==2)i++;boundaries[i]=j;}
 return {distance,boundaries};
}
function preview(d,data,{allowReferenceMapping=false}={}){
 if(typeof allowReferenceMapping!=='boolean')throw Error('是否允许可信稿字幕映射必须为布尔值');
 const ref=reference(d,data),rows=d.edit.captions;if(!ref?.text.trim())throw Error('没有与当前视频对应的可信讲稿：请先确认第二步正文并使用该稿配音生成视频，或选用已合成的当前集；导入视频可继续手工回听校对');
 if(!Array.isArray(rows)||!rows.length||rows.length>1000||rows.some(r=>typeof r.text!=='string'||!r.text.trim()||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start))throw Error('字幕内容或时间无效，请先修正后校对');
 if(rows.some((r,i)=>i&&r.start<rows[i-1].end-.001))throw Error('字幕时间轴重叠或顺序错误，请先修正后校对');
 const a=rows.flatMap(r=>units(r.text)),b=units(ref.text);if(!a.length||!b.length||a.length>4000||b.length>4000)throw Error('本次校对支持4000字以内的有效讲稿和字幕，请拆分后处理');
 if(allowReferenceMapping){const inputSignature=signature(d,data);return require('./subtitle-reference-mapping.cjs').mapSubtitleReference(rows,ref.text).then(({mapping,suggestions,recognition})=>({version:3,algorithm:'explicit-reference-character-pinyin-v1',signature:inputSignature,reference:ref,referenceSha256:hash(ref.text),originalCaptions:structuredClone(rows),mappingInput:{kind:'saved-caption-rows',...recognition},referenceMapping:mapping,similarity:mapping.similarity,suggestions,requiresListening:true,limitation:'仅按已保存字幕与可信稿映射字形，原ASR另存于执行记录；保留原字幕边界，不证明实际发音或发言正确，请逐条回听。'+mapping.limitation}));}
 const {distance,boundaries}=align(a,b),similarity=1-distance/Math.max(a.length,b.length);
 if(similarity<.7)throw Error('字幕与第二步文案相似度不足，可能不是同一份讲稿，未生成替换建议');
 let offset=0;const suggestions=rows.map((row,index)=>{
  const original=units(row.text),start=boundaries[offset],end=boundaries[offset+original.length];offset+=original.length;
  let proposed='';if(end>start){const rawStart=b[start].start,rawEnd=end<b.length?b[end].start:ref.text.length;proposed=ref.text.slice(rawStart,rawEnd).trim();}
  const revised=units(proposed),local=original.length&&revised.length?1-align(original,revised).distance/Math.max(original.length,revised.length):0;
  // 长度突变与低匹配句保留待人工处理，不能借用相邻时间塞入缺失段落。
  const ratio=revised.length/original.length,warnings=[];if(local<.65)warnings.push('本句匹配不足，需手工核对');if(ratio>1.35||ratio<.65)warnings.push('文案片段长度差异较大，无法确认对应发言时间');if(index===0&&start>0)warnings.push('文案开头没有对应字幕，请手工核对缺失内容');
  const numbers=text=>text.match(/[\p{N}]+(?:[.．][\p{N}]+)?/gu)?.join('|')||'';
  const negatives=text=>text.match(/不|没|无|非|勿|未|别|禁止/g)?.join('')||'';
  if(numbers(row.text)!==numbers(proposed))warnings.push('数字变化，请回听确认');if(negatives(row.text)!==negatives(proposed))warnings.push('否定表述变化，请回听确认');
  return {index,start:row.start,end:row.end,original:row.text,proposed,similarity:local,changed:row.text!==proposed,eligible:!!proposed&&local>=.65&&ratio<=1.35&&ratio>=.65&&!(index===0&&start>0),warnings};
 });
 return {version:2,algorithm:'local-character-alignment-v1',signature:signature(d,data),reference:ref,referenceSha256:hash(ref.text),originalCaptions:structuredClone(rows),similarity,suggestions,limitation:'建议只按讲稿校对字幕，不能证明实际读音或发言正确；请逐句回听后选择。'};
}
function apply(d,result,selected,data){
 if(signature(d,data)!==result.signature)throw Error('任务、视频、文案或字幕已变化，请重新校对，当前字幕已保留');
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length)throw Error('请至少选择一条需要应用的校对建议');
 const rows=structuredClone(d.edit.captions);for(const index of selected){const suggestion=result.suggestions.find(s=>s.index===index);if(!Number.isSafeInteger(index)||!suggestion?.eligible||!suggestion.changed)throw Error('选择包含无效或匹配不足的字幕建议，请重新核对');rows[index].text=suggestion.proposed;delete rows[index].auxiliary;}
 return rows;
}
module.exports={preview,apply,signature,hash};
