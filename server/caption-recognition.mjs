// 兼容服务也可能返回无效时间轴；只有可编辑、可烧录的结果才允许进入任务。
export function validatedWords(row,duration){
 if(row.words===undefined)return undefined;
 if(!Array.isArray(row.words)||!row.words.length||row.words.length>20000)throw Error('识别词级时间轴为空或超过上限，当前字幕已保留');
 let end=row.start;
 const words=row.words.map(item=>{
  if(typeof item.word!=='string'||!item.word.trim()||!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<row.start-.001||item.end<item.start||item.start<end-.001||item.end>row.end+.001||(Number.isFinite(duration)&&item.start>=duration))throw Error('识别词级时间轴无效，当前字幕已保留');
  end=item.end;return {start:item.start,end:Number.isFinite(duration)?Math.min(duration,item.end):item.end,word:item.word};
 });
 const compact=text=>text.replace(/\s/gu,'');
 if(compact(words.map(item=>item.word).join(''))!==compact(row.text))throw Error('识别词级文字不完整，当前字幕已保留');
 return words;
}

// 小数可能被识别为多个数字词；只合并明确的小数与百分号，沿用原词首尾时间。
function decimalWords(words){
 const result=[],decimal=/^[0-9０-９]+[.．][0-9０-９]+[%％]?$/u;
 for(let i=0;i<words.length;i++){
  let end=i;
  while(end<words.length&&/^[0-9０-９.．%％]+$/u.test(words[end].word)&&(end===i||words[end].start-words[end-1].end<=.65))end++;
  if(end===i){result.push(words[i]);continue;}
  const run=words.slice(i,end),text=run.map(word=>word.word).join('');
  if(run.length>1&&decimal.test(text))result.push({start:run[0].start,end:run.at(-1).end,word:text});
  else result.push(...run);
  i=end-1;
 }
 return result;
}

// 数量与明确单位合为完整识别词组，短模板允许整组超长，绝不创造词内时间。
function quantityWords(words){
 const text=words.map(item=>item.word).join(''),spans=[];let offset=0;
 for(const word of words){spans.push({from:offset,to:offset+word.word.length});offset+=word.word.length;}
 const pattern=/(?:[0-9０-９]+(?:[.．][0-9０-９]+)?|[零〇一二三四五六七八九十百千万萬亿億两兩几幾]+)(?:平方毫米|平方厘米|平方米|毫升|毫米|厘米|千米|公斤|千克|分钟|分鐘|小时|小時|秒钟|秒鐘|米|克|斤|升|元|角|秒|天|周|週|月|年|台|件|张|張|股|倍|个|個|款|次)/gu;
 const ends=new Map();let startIndex=0,endIndex=0;
 for(const match of text.matchAll(pattern)){
  while(startIndex<spans.length&&spans[startIndex].to<=match.index)startIndex++;
  endIndex=Math.max(startIndex,endIndex);while(endIndex<spans.length&&spans[endIndex].to<match.index+match[0].length)endIndex++;
  const from=startIndex,to=endIndex;
  if(from<0||to<=from)continue;
  if(words.slice(from+1,to+1).some((word,index)=>word.start-words[from+index].end>.65))continue;
  ends.set(from,Math.max(ends.get(from)||from,to));
 }
 const result=[];
 for(let index=0;index<words.length;index++){
  let end=ends.get(index)||index;
  for(let cursor=index+1;cursor<=end;cursor++)end=Math.max(end,ends.get(cursor)||cursor);
  result.push(end===index?words[index]:{start:words[index].start,end:words[end].end,word:words.slice(index,end+1).map(item=>item.word).join('')});index=end;
 }
 return result;
}

// 只使用识别器实际返回的词边界，绝不按字数平均分配时间。
function splitWords(row,words,maxChars){
 words=quantityWords(decimalWords(words));
 const rows=[],groups=[];let group=[];
 const text=()=>group.map(item=>item.word).join('').trim();
 const flush=()=>{if(group.length&&group.at(-1).end>group[0].start){rows.push({start:group[0].start,end:group.at(-1).end,text:text()});groups.push(group);group=[];}};
 for(const word of words){
  if(group.length&&Array.from((text()+word.word).trim()).length>maxChars)flush();
  group.push(word);
  if(/[，,。.!！?？;；:：]$/u.test(word.word.trim()))flush();
 }
 flush();
 if(group.length){if(!rows.length)return [{start:row.start,end:row.end,text:row.text.trim()}];rows.at(-1).text+=text();rows.at(-1).end=Math.max(rows.at(-1).end,group.at(-1).end);groups.at(-1).push(...group);}
 // 仅回收同句紧邻的极短汉字尾，移动整个识别词，保持字数上限与真实时间边界。
 const letters=value=>Array.from(value).filter(ch=>/[\p{L}\p{N}]/u.test(ch)).length;
 const joined=items=>items.map(item=>item.word).join('').trim();
 for(let i=1;i<rows.length;i++){
  const tail=rows[i],previous=rows[i-1],left=groups[i-1],right=groups[i];
  if(letters(tail.text)!==1||!/[\p{Script=Han}]/u.test(tail.text)||tail.end-tail.start>.35||tail.start-previous.end>.3||/[，,。.!！?？;；:：]$/u.test(previous.text)||left.length<2)continue;
  const moved=left.at(-1),remaining=left.slice(0,-1),combined=[moved,...right];
  if(letters(joined(remaining))<2||letters(joined(combined))<2||Array.from(joined(combined)).length>maxChars||remaining.at(-1).end<=remaining[0].start||moved.start>=tail.end)continue;
  left.pop();right.unshift(moved);previous.text=joined(left);previous.end=left.at(-1).end;tail.text=joined(right);tail.start=right[0].start;
 }
 // 保护明确的重复短语和数量加时间单位，只移动完整识别词，不猜测词内时间。
 for(let i=1;i<rows.length;i++){
  const tail=rows[i],previous=rows[i-1],left=groups[i-1],right=groups[i];
  if(left.length<2||tail.start-previous.end>.3||/[，,。.!！?？;；:：]$/u.test(previous.text))continue;
  const moved=left.at(-1),word=moved.word.trim(),tailText=joined(right);
  const repeated=/^\p{Script=Han}$/u.test(word)&&(tailText.startsWith('一'+word)||tailText.startsWith('不'+word));
  const quantity=/^[零〇一二三四五六七八九十百千万萬亿億两兩几幾\d]+$/u.test(word);
  const timeUnit=/^(?:分钟|分鐘|小时|小時|秒钟|秒鐘|秒|天|周|週|月|年)[，,。.!！?？;；:：\s]*$/u.test(tailText);
  if(!repeated&&!(quantity&&timeUnit))continue;
  const remaining=left.slice(0,-1),combined=[moved,...right];
  if(letters(joined(remaining))<2||Array.from(joined(combined)).length>maxChars||remaining.at(-1).end<=remaining[0].start||moved.start>=tail.end)continue;
  left.pop();right.unshift(moved);previous.text=joined(left);previous.end=left.at(-1).end;tail.text=joined(right);tail.start=right[0].start;
 }
 return rows;
}

// 手动和后台流程共用断句配置，防止同一模板产生不同字幕节奏。
export function recognitionOptions(edit={}){
 return {maxChars:edit.subtitleMode==='template'?6:Number(edit.subtitleMaxChars)||18};
}

export function recognitionRows(result,duration,{maxChars}={}){
 if(!Array.isArray(result?.segments)||!result.segments.length)throw Error('服务只返回文字，没有时间轴，请导入SRT字幕');
 if(result.segments.length>10000)throw Error('字幕条目过多，请拆分视频后识别');
 let previousEnd=0;
 if(maxChars!==undefined&&(!Number.isInteger(maxChars)||maxChars<3||maxChars>80))throw Error('字幕断句长度无效');
 const rows=result.segments.flatMap((row,index)=>{
  if(typeof row.text!=='string'||!row.text.trim()||!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||row.start<previousEnd-.001||(Number.isFinite(duration)&&duration>0&&(row.end>duration+.15||row.start>=duration)))throw Error('第'+(index+1)+'条识别字幕内容或时间无效，当前字幕已保留，请重试或导入SRT');
  previousEnd=row.end;
  const words=validatedWords(row,Number.isFinite(duration)&&duration>0?duration:Infinity);
  if(words&&maxChars!==undefined)return splitWords(row,words,maxChars);
  return [{start:row.start,end:Number.isFinite(duration)&&duration>0?Math.min(row.end,duration):row.end,text:row.text.trim()}];
 });
 // 缺省参数也用于恢复手工字幕；仅在显式识别断句时修复跨段小数。
 if(maxChars===undefined)return rows;
 // 兼容仅有句级时间的小数跨段结果，不把小数点当句号，也不推测段内时间。
 const joined=[];
 for(const row of rows){const previous=joined.at(-1);if(previous&&/[0-9０-９]+[.．]$/u.test(previous.text)&&/^[0-9０-９]+/u.test(row.text)&&row.start-previous.end<=.65){previous.text+=row.text;previous.end=row.end;}else joined.push({...row});}
 return joined;
}
