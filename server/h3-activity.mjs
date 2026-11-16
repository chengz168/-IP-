export function h3ActivityText(activity){
 if(activity?.kind==='musetalk-local-v1'){
  const prefix=Number.isSafeInteger(activity.shotIndex)&&activity.shotIndex>=0&&Number.isSafeInteger(activity.shotCount)&&activity.shotCount>activity.shotIndex?`第 ${activity.shotIndex+1}/${activity.shotCount} 镜头 · `:'';
  if(activity.stage==='inferred'&&Number.isSafeInteger(activity.completed)&&Number.isSafeInteger(activity.total))return prefix+`口型生成 ${activity.completed}/${activity.total} 帧`;
  return prefix+({ready:'本地口型环境检查通过',source_frames_ready:'形象动作帧已准备',audio_features_ready:'驱动音频特征已准备',inference_started:'正在生成本地口型'}[activity.stage]||'正在处理本地口型');
 }
 if(!activity||activity.kind!=='comfy-h3-activity-v1')return '';
 const prefix=Number.isInteger(activity.segmentIndex)&&Number.isInteger(activity.segmentCount)?`第 ${activity.segmentIndex+1}/${activity.segmentCount} 段 · `:'';
 const phases={waiting:'等待模型执行',executing:'模型执行中',sampling:'模型采样',disconnected:'进度连接中断，正在查询原任务',unavailable:'进度连接不可用，正在查询原任务',collecting:'正在取回并核验视频'};
 const phase=phases[activity.phase];if(!phase)return '';
 return prefix+(activity.phase==='sampling'?`采样 ${activity.value}/${activity.max}`:activity.phase==='executing'?activity.nodeLabel||phase:phase);
}
