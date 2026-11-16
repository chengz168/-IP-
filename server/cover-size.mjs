export const coverFormats=[
  {id:'portrait',label:'竖版 9:16',width:1080,height:1920},
  {id:'landscape',label:'横版 16:9',width:1920,height:1080},
  {id:'square',label:'方形 1:1',width:1080,height:1080},
];
// 旧任务没有场景尺寸时仍按原竖版处理，未知尺寸不能静默降级。
export function coverSize(scene){
  if(!scene)return {width:1080,height:1920};
  const format=coverFormats.find(item=>item.width===scene.width&&item.height===scene.height);
  if(!format)throw new Error('封面画幅无效，请选择竖版、横版或方形');
  return {width:format.width,height:format.height};
}
export function formatForVideo(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  return coverFormats.find(item=>Math.abs(width/height-item.width/item.height)<.02)||null;
}
export function displayVideoSize(video){
  if(!video?.width||!video?.height)throw new Error('视频没有有效画面尺寸');
  const rotation=Number(video.tags?.rotate??video.side_data_list?.find(item=>item.rotation!==undefined)?.rotation)||0;
  return Math.abs(rotation)%180===90?{width:video.height,height:video.width}:{width:video.width,height:video.height};
}
