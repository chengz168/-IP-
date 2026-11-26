const crypto=require('node:crypto');
const pinyinPackage=require('pinyin'),pinyin=pinyinPackage.default||pinyinPackage;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const letters=text=>Array.from(String(text||'')).filter(char=>/[\p{L}\p{N}]/u.test(char));
const normalized=char=>char.normalize('NFKC').toLowerCase();
const reading=char=>/\p{Script=Han}/u.test(char)?pinyin(char,{style:pinyin.STYLE_NORMAL,heteronym:false})?.[0]?.[0]||char:normalized(char);
const thresholds=Object.freeze({similarity:.92,localSimilarity:.85,minLengthRatio:.95,maxLengthRatio:1.05,maxGap:2,maxCharacters:4000});

// 数值比较先于去标点；小数点、百分号、正负号及已知单位都参与签名，只规范全角与繁简写法。
function numericSignature(text){
 const value=String(text||'').normalize('NFKC').replace(/[−﹣]/gu,'-').replace(/點/gu,'点').replace(/負/gu,'负').replace(/萬/gu,'万').replace(/億/gu,'亿').replace(/兩/gu,'两').replace(/鐘/gu,'钟').replace(/週/gu,'周').replace(/個/gu,'个').replace(/張/gu,'张').replace(/小時/gu,'小时').replace(/分鐘/gu,'分钟').replace(/\s/gu,'');
 const han='零〇一二三四五六七八九十百千万亿两',units='平方毫米|平方厘米|平方米|毫升|毫米|厘米|千米|公斤|千克|分钟|小时|秒钟|米|克|斤|升|元|角|秒|天|周|月|年|台|件|张|股|倍|个|款|次';
 const number=`(?:[0-9]+(?:[.点][0-9${han}]+)?|[${han}]+[.点][0-9${han}]+|[${han}]+)`;
 const pattern=new RegExp(`百分之[正负+-]?${number}|[正负+-]?(?:[0-9]+(?:[.点][0-9${han}]+)?|\\.[0-9]+)(?:[%‰]|${units})?|[正负+-]?[${han}]+[.点][0-9${han}]+(?:[%‰]|${units})?|[正负+-]?[${han}]+(?:%|‰|${units})|[正负+-][${han}]+|[正负+-]?[${han}]{2,}`,'gu');
 return JSON.stringify((value.match(pattern)||[]).map(token=>token.replace(/^负/u,'-').replace(/^正/u,'+').replace(/点/gu,'.')));
}
function assertNumericFidelity(actual,reference){
 if(numericSignature(actual)!==numericSignature(reference))throw Error('识别与确认稿存在数字或否定表述变化（含小数、百分比、正负号或单位），必须先回听核对，未映射识别切点');
}

// 量化表达与否定语义严格保护；词形中的疑似数词另留歧义记录，不能当作已经回听。
function protectedSequence(text){
 const value=String(text).normalize('NFKC');
 const expression=/[0-9]+(?:\.[0-9]+)?[%％]?|[零〇一二三四五六七八九十百千万萬亿億两兩]+(?:毫米|厘米|千米|米|公斤|千克|克|斤|元|角|分|个|個|款|次|秒|小时|小時|分钟|分鐘|天|周|週|月|年|台|件|张|張|股|倍)|[零〇一二三四五六七八九十百千万萬亿億两兩]{2,}|不|没|沒|无|無|非|勿|未|别|別|禁止/gu;
 return (value.match(expression)||[]).map(word=>letters(word).map(reading).join(':')).join('|');
}
const sensitiveChar=char=>/[0-9不没沒无無非勿未别別]/u.test(char||'');
function quantitativePositions(chars){
 const positions=new Set(),text=chars.join(''),pattern=/[0-9]+|[零〇一二三四五六七八九十百千万萬亿億两兩]+(?:毫米|厘米|千米|米|公斤|千克|克|斤|元|角|分|个|個|款|次|秒|小时|小時|分钟|分鐘|天|周|週|月|年|台|件|张|張|股|倍)|[零〇一二三四五六七八九十百千万萬亿億两兩]{2,}/gu;
 for(const match of text.matchAll(pattern)){const start=Array.from(text.slice(0,match.index)).length;for(let index=start;index<start+Array.from(match[0]).length;index++)positions.add(index);}
 return positions;
}
function align(source,target){
 const n=source.length,m=target.length,trace=new Uint8Array((n+1)*(m+1)),a=source.map(reading),b=target.map(reading);
 let previous=Float64Array.from({length:m+1},(_,index)=>index),current=new Float64Array(m+1);
 for(let j=1;j<=m;j++)trace[j]=2;
 for(let i=1;i<=n;i++){
  current[0]=i;trace[i*(m+1)]=1;
  for(let j=1;j<=m;j++){
   const same=normalized(source[i-1])===normalized(target[j-1]),phonetic=a[i-1]===b[j-1];
   let cost=previous[j-1]+(same?0:phonetic?.12:1),direction=0;
   if(previous[j]+1<cost){cost=previous[j]+1;direction=1;}
   if(current[j-1]+1<cost){cost=current[j-1]+1;direction=2;}
   current[j]=cost;trace[i*(m+1)+j]=direction;
  }
  [previous,current]=[current,previous];
 }
 const steps=[];let i=n,j=m;
 while(i||j){const direction=trace[i*(m+1)+j];steps.push(direction);if(direction!==2)i--;if(direction!==1)j--;}
 steps.reverse();i=0;j=0;
 const points=[{source:0,target:0}],differences=[];let mismatches=0,maxGap=0,gap=0;
 for(const direction of steps){
  const from=i,to=j,original=direction===2?'':source[i],reference=direction===1?'':target[j];
  if(direction!==2)i++;if(direction!==1)j++;
  const phonetic=direction===0&&a[from]===b[to];
  if(direction!==0||!phonetic)mismatches++;
  gap=direction===0?0:gap+1;maxGap=Math.max(maxGap,gap);
  if(original!==reference)differences.push({sourceOffset:from,referenceOffset:to,original,reference,kind:direction===1?'asr-extra-character':direction===2?'reference-extra-character':phonetic?'same-reading-character':'different-reading-character'});
  points.push({source:i,target:j});
 }
 return {points,differences,similarity:1-mismatches/Math.max(n,m),maxGap};
}

async function mapNarrationReference(shots,episodeText,recognition,duration,{allowEstimated=false}={}){
 if(typeof allowEstimated!=='boolean')throw Error('是否允许估计边界必须为布尔值');
 if(!Array.isArray(shots)||!shots.length||shots.map(shot=>shot.text).join('')!==episodeText)throw Error('镜头台词没有逐字覆盖确认正文，未映射识别切点');
 if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('当前集旁白时长须大于0且不超过600秒');
 const {recognitionRows,validatedWords}=await import('./caption-recognition.mjs');
 const rows=recognitionRows(recognition,duration),rawText=rows.map(row=>row.text).join(''),source=letters(rawText),target=letters(episodeText);
 assertNumericFidelity(rawText,episodeText);
 if(!source.length||!target.length||Math.max(source.length,target.length)>thresholds.maxCharacters)throw Error('可信稿映射仅支持4000字以内的非空正文与识别');
 const ratio=target.length/source.length;
 if(ratio<thresholds.minLengthRatio||ratio>thresholds.maxLengthRatio)throw Error('识别与确认稿长度变化过大，可能缺句，未映射识别切点');
 if(protectedSequence(rawText)!==protectedSequence(episodeText))throw Error('识别与确认稿存在数字或否定表述变化，必须先回听核对，未映射识别切点');
 const mapped=align(source,target);
 const sourceQuantitative=quantitativePositions(source),targetQuantitative=quantitativePositions(target);
 // 数值或否定词即使全稿总数相同，位置变化仍不能借普通字符编辑距离放行。
 if(mapped.differences.some(item=>(sensitiveChar(item.original)||sensitiveChar(item.reference))&&protectedSequence(item.original)!==protectedSequence(item.reference)))throw Error('识别与确认稿存在数字或否定表述位置变化，必须先回听核对，未映射识别切点');
 if(mapped.differences.some(item=>((item.original&&sourceQuantitative.has(item.sourceOffset))||(item.reference&&targetQuantitative.has(item.referenceOffset)))&&(!item.original||!item.reference||reading(item.original)!==reading(item.reference))))throw Error('识别与确认稿存在量化表达位置变化，必须先回听核对，未映射识别切点');
 if(mapped.similarity<thresholds.similarity||mapped.maxGap>thresholds.maxGap)throw Error('识别与确认稿匹配不足或存在缺句，未映射识别切点');
 const counts=shots.map(shot=>letters(shot.text).length);if(counts.some(count=>!count))throw Error('镜头台词缺少可映射的正文文字');
 const units=[];let cursor=0,wordBoundaryCount=0;
 for(let index=0;index<rows.length;index++){
  const row=rows[index],words=validatedWords(recognition.segments[index],duration);
  for(const item of words||[{start:row.start,end:row.end,word:row.text}]){
   const count=letters(item.word).length;if(!count)continue;
   units.push({from:cursor,to:cursor+count,start:item.start,end:item.end,method:words?'asr-word-end':'asr-segment-end'});cursor+=count;if(words)wordBoundaryCount++;
  }
 }
 const offsets=[0];for(const count of counts)offsets.push(offsets.at(-1)+count);
 const at=offset=>{const points=mapped.points.filter(point=>point.target===offset);if(!points.length)throw Error('确认稿切点没有对应识别位置');return {min:points[0].source,max:points.at(-1).source,extraReference:mapped.differences.some(item=>item.kind==='reference-extra-character'&&(item.referenceOffset===offset||item.referenceOffset===offset-1))};};
 // 同时检查每镜局部匹配，防止长稿的高平均分掩盖短镜头的缺失内容。
 for(let index=0;index<shots.length;index++){
  const from=at(offsets[index]).min,to=at(offsets[index+1]).max,original=source.slice(from,to),reference=target.slice(offsets[index],offsets[index+1]);
  if(!original.length||align(original,reference).similarity<thresholds.localSimilarity)throw Error('第'+(index+1)+'镜头局部匹配不足，未映射识别切点');
 }
 let estimatedBoundaries=0;
 const boundaries=[{frame:0,method:'audio-start'}];
 for(let index=1;index<offsets.length-1;index++){
  const position=at(offsets[index]),used=position.max,unit=units.find(item=>used>item.from&&used<=item.to);
  if(!unit)throw Error('确认稿镜头无法对应有效识别边界');
  let time,method;
  if(position.min===position.max&&!position.extraReference&&used===unit.to){time=unit.end;method=unit.method;}
  else{
   if(!allowEstimated)throw Error('第'+index+'镜头映射切点落在识别词内部或差异处；请调整切点，或明确允许估算后重试');
   time=unit.start+(unit.end-unit.start)*(used-unit.from)/(unit.to-unit.from);
   method=position.min!==position.max||position.extraReference?'reference-ambiguous-boundary-estimate':unit.method==='asr-word-end'?'asr-word-interpolation-estimate':'asr-segment-interpolation-estimate';estimatedBoundaries++;
  }
  boundaries.push({frame:Math.round(time*24),method,sourceOffset:used,referenceOffset:offsets[index]});
 }
 boundaries.push({frame:Math.ceil(duration*24),method:'audio-end-frame-ceiling'});
 const timed=shots.map((shot,index)=>{const start=boundaries[index].frame/24,end=boundaries[index+1].frame/24;if(end-start<.1)throw Error('第'+(index+1)+'镜头映射时长不足0.1秒，请先合并镜头');return {shotId:shot.id,start,end,duration:end-start,startMethod:boundaries[index].method,endMethod:boundaries[index+1].method};});
 const limitations=timed.filter(shot=>shot.duration<4||shot.duration>15).map(shot=>({shotId:shot.shotId,duration:shot.duration,reason:'当前普通H3单镜头支持4至15秒，请先拆分或合并镜头；未裁剪旁白'}));
 const ambiguousNumeralChanges=mapped.differences.filter(item=>/[零〇一二三四五六七八九十百千万萬亿億两兩]/u.test(item.original+item.reference));
 const limitation='这是确认稿与原始识别的字符及单字拼音映射，不证明实际发音或内容正确；同音多音字及词形中的疑似数词存在歧义，须逐镜回听。仅明确量化表达受数值保护，音频、确认正文及原始识别均未改写。';
 return {version:1,method:estimatedBoundaries?'asr-reference-with-explicit-interpolation':'asr-reference-character-pinyin-boundaries',duration,timelineDuration:timed.at(-1).end,estimatedBoundaries,wordBoundaryCount,allowEstimated,requiresReview:true,limitations,shots:timed,referenceMapping:{version:1,algorithm:'conservative-character-pinyin-dp-v1',thresholds:{...thresholds},recognitionSha256:hash(JSON.stringify(recognition)),recognitionText:rawText,referenceSha256:hash(episodeText),referenceText:episodeText,similarity:mapped.similarity,lengthRatio:ratio,differences:mapped.differences,ambiguousNumeralChanges,segmentCount:rows.length,wordCount:wordBoundaryCount,boundaries:boundaries.map(item=>({...item})),requiresListening:true,limitation}};
}
module.exports={mapNarrationReference,numericSignature,assertNumericFidelity};
