// 字幕保持源视频时间轴，输出片段同时携带素材源偏移，剪掉静音后仍能继续对应画面。
function pipTimeline(edit,sourceDuration,keep){
  if(!edit.pipEnabled)return [];
  const mode=edit.pipMode??'continuous',speed=Number(edit.speed);
  if(!['continuous','captions'].includes(mode))throw new Error('画中画模式无效');
  if(!Number.isFinite(speed)||speed<.5||speed>2)throw new Error('画中画播放速度无效');
  const duration=keep.reduce((sum,r)=>sum+r.end-r.start,0)/speed;
  if(mode==='continuous'){
    if(!edit.pipId)throw new Error('请先选择全程画中画素材，或关闭画中画');
    return [{assetId:edit.pipId,row:null,start:0,end:duration,sourceOffset:0,rate:1}];
  }
  if(!edit.captions?.length)throw new Error('请先生成或导入字幕，再配置逐句画中画');
  const rows=edit.captions.map((r,i)=>({...r,row:i+1})).filter(r=>r.pipId);
  if(!rows.length)throw new Error('请先为字幕分配画中画素材，或关闭画中画');
  for(const r of rows){
    if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>sourceDuration+.001)throw new Error(`第${r.row}行画中画时间超出视频或无效`);
  }
  const sorted=rows.slice().sort((a,b)=>a.start-b.start);
  for(let i=1;i<sorted.length;i++)if(sorted[i].start<sorted[i-1].end)throw new Error(`第${sorted[i-1].row}行与第${sorted[i].row}行画中画时间重叠，请先调整字幕`);
  const clips=[];let offset=0;
  for(const interval of keep){
    for(const r of rows){const start=Math.max(r.start,interval.start),end=Math.min(r.end,interval.end);if(end>start)clips.push({assetId:r.pipId,row:r.row,start:(offset+start-interval.start)/speed,end:(offset+end-interval.start)/speed,sourceOffset:start-r.start,rate:speed});}
    offset+=interval.end-interval.start;
  }
  if(!clips.length)throw new Error('已分配画中画的字幕全部位于被裁掉的静音中，请重新分配');
  return clips.sort((a,b)=>a.start-b.start);
}

async function preparePip(media,edit,sourceDuration,keep,stream){
  const clips=pipTimeline(edit,sourceDuration,keep);if(!clips.length)return {clips,groups:[],height:0};
  const size=Number(edit.pipSize??.35),position=edit.pipPosition??'bottom-right';
  if(!Number.isFinite(size)||size<.15||size>.7)throw new Error('画中画比例需为0.15至0.7');
  if(!['bottom-right','top-right','bottom-left'].includes(position))throw new Error('画中画位置无效');
  const groups=[];let height=0;
  for(const assetId of new Set(clips.map(c=>c.assetId))){
    const asset=media.store.asset(assetId);if(!['video','image'].includes(asset.type))throw new Error('画中画请选择视频或图片');
    const info=await media.probe(asset.path),video=info.streams.find(s=>s.codec_type==='video');
    if(!video||!Number.isFinite(Number(video.width))||Number(video.width)<=0||!Number.isFinite(Number(video.height))||Number(video.height)<=0)throw new Error('画中画素材没有有效画面');
    const width=Math.round(Number(stream.width)*size/2)*2,h=Math.ceil(width*Number(video.height)/Number(video.width)/2)*2;
    if(h>Number(stream.height)*.8)throw new Error('画中画过高，请降低尺寸比例');
    height=Math.max(height,h);groups.push({asset,width,clips:clips.filter(c=>c.assetId===assetId)});
  }
  return {clips,groups,height,position};
}

function appendPipInputs(plan,args,index){
  for(const group of plan.groups){group.input=index++;args.push(...(group.asset.type==='image'?['-loop','1']:['-stream_loop','-1']),'-i',group.asset.path);}
  return index;
}

function appendPipFilters(plan,filters,base){
  let output=base,serial=0;
  const position=plan.position==='top-right'?'W-w-20:20':plan.position==='bottom-left'?'20:H-h-20':'W-w-20:H-h-20';
  for(const [g,group] of plan.groups.entries()){
    const roots=group.clips.map((_,i)=>`ps${g}_${i}`);
    filters.push(`[${group.input}:v]scale=${group.width}:-2,setsar=1,setpts=PTS-STARTPTS`+(roots.length>1?`,split=${roots.length}`:'')+roots.map(r=>`[${r}]`).join(''));
    for(const [i,clip] of group.clips.entries()){
      const id=serial++,pip='pc'+id,next='po'+id;
      const offset=group.asset.type==='image'?0:clip.sourceOffset;
      filters.push(`[${roots[i]}]trim=start=${offset}:end=${offset+(clip.end-clip.start)*clip.rate},setpts=(PTS-STARTPTS)/${clip.rate}+${clip.start}/TB[${pip}]`);
      filters.push(`[${output}][${pip}]overlay=${position}:eof_action=pass:repeatlast=0:enable='gte(t,${clip.start})*lt(t,${clip.end})'[${next}]`);output=next;
    }
  }
  return output;
}
module.exports={pipTimeline,preparePip,appendPipInputs,appendPipFilters};
