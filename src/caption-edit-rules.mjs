const minimum=.05;
const round=value=>Math.round(1000*(Number(value)||0))/1000;
const duration=row=>round(Math.max(minimum,Number(row.end)-Number(row.start)));

export function insertCaption(rows,index){
 const row=rows[index];if(!row)return;
 const start=round(row.end),next=rows[index+1];
 let end=next?round(Number(next.start)||start+1):round(start+1);
 if(end-start<minimum)end=round(start+minimum);
 // 原版无间隙也插入最短字幕，保留其他行及其素材，不自动移动下一行。
 rows.splice(index+1,0,{text:'',start,end});
}
export function deleteCaption(rows,index){if(rows.length>1)rows.splice(index,1);}
export function changeCaptionStart(rows,index,value){
 const row=rows[index];if(!row)return;
 row.start=Math.max(index>0?Number(rows[index-1].end)||0:0,Math.min(round(value),(Number(row.end)||0)-minimum));
}
export function changeCaptionEnd(rows,index,value,previous){
 const row=rows[index];if(!row)return;
 const end=Math.max(round(value),(Number(row.start)||0)+minimum),delta=end-(Number(previous)||0);
 row.end=end;
 for(let i=index+1;i<rows.length;i++){
  rows[i].start=round(Number(rows[i].start)+delta);rows[i].end=round(Number(rows[i].end)+delta);
 }
}

const isCharacter=value=>/[\p{L}\p{N}]/u.test(value);
function timeline(snapshot){
 const result=[];
 for(const sentence of snapshot?.sentences||[]){
  const words=sentence.words?.length?sentence.words:[sentence];
  for(const word of words){
   const chars=Array.from(String(word.text||'')).filter(isCharacter),start=(Number(word.start)||0)/1000,end=(Number(word.end)||0)/1000,step=Math.max(0,end-start)/(chars.length||1);
   chars.forEach((ch,i)=>result.push({ch:ch.toLowerCase(),start:start+step*i,end:start+step*(i+1)}));
  }
 }
 return result;
}
function matches(a,b){
 const grid=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)grid[i][j]=a[i]===b[j]?grid[i+1][j+1]+1:Math.max(grid[i+1][j],grid[i][j+1]);
 const pairs=[];let i=0,j=0;
 while(i<a.length&&j<b.length){if(a[i]===b[j]){pairs.push([i++,j++]);}else if(grid[i+1][j]>=grid[i][j+1])i++;else j++;}
 return pairs;
}
export function realignCaptionText(rows,index,snapshot){
 if(!rows[index]||!snapshot?.sentences?.length)return;
 const first=Math.max(0,index-1),last=Math.min(rows.length-1,index+1),left=(Number(rows[first].start)||0)-.6,right=(Number(rows[last].end)||0)+.6;
 const audio=timeline(snapshot).filter(c=>c.end>=left&&c.start<=right),text=[];
 for(let i=first;i<=last;i++)for(const ch of Array.from(String(rows[i].text||'')))if(isCharacter(ch))text.push({ch:ch.toLowerCase(),line:i,start:null,end:null});
 if(!text.length||!audio.length)return;
 const pairs=matches(text.map(c=>c.ch),audio.map(c=>c.ch));if(!pairs.length)return;
 for(const [a,b] of pairs){text[a].start=audio[b].start;text[a].end=audio[b].end;}
 // 原版在匹配字符之间插值，首尾未匹配字符贴近最近已匹配字符。
 for(let i=0;i<text.length;){
  if(text[i].start!==null){i++;continue;}
  let end=i;while(end<text.length&&text[end].start===null)end++;
  const before=text[i-1],after=text[end];
  for(let k=i;k<end;k++){
   if(before&&after){const step=(after.start-before.end)/(end-i+1);text[k].start=before.end+step*(k-i);text[k].end=before.end+step*(k-i+1);}
   else text[k].start=text[k].end=before?before.end:after.start;
  }
  i=end;
 }
 let previousEnd=first>0?Number(rows[first-1].end)||0:0;
 const nextStart=last<rows.length-1?Number(rows[last+1].start)||Infinity:Infinity;
 for(let i=first;i<=last;i++){
  const chars=text.filter(c=>c.line===i&&c.start!==null);
  const start=Math.max(chars.length?Math.min(...chars.map(c=>c.start)):Number(rows[i].start)||previousEnd,previousEnd);
  const end=Math.max(chars.length?Math.max(...chars.map(c=>c.end)):Number(rows[i].end)||start+minimum,start+minimum);
  rows[i].start=round(start);rows[i].end=round(end);previousEnd=end;
 }
 if(Number.isFinite(nextStart)&&rows[last].end>nextStart)rows[last].end=round(Math.max(rows[last].start+minimum,nextStart));
}

// 仅采用同任务同视频成功的真实识别记录；手动导入字幕没有识别快照。
export function captionAsrSnapshot(state,draft){
 const source=draft.edit.sourceId||draft.video.assetId;
 const run=state.runs?.find(run=>run.draftId===draft.id&&run.type==='transcribe'&&run.status==='succeeded'&&!run.output?.stale&&(run.output?.sourceAssetId||run.parameters?.assetId)===source&&run.output?.segments?.length);
 return run?{sentences:run.output.segments.map(row=>({text:row.text,start:row.start*1000,end:row.end*1000}))}:null;
}
export const captionDuration=duration;
