export function shotInputSignature(draft){
  return JSON.stringify({video:draft.video,voiceAudioId:draft.voice?.audioId||''});
}

export function validateShots(shots,avatars){
  if(!Array.isArray(shots)||!shots.length)throw new Error('请至少保留一个镜头');
  const ids=new Set(avatars.map(avatar=>avatar.id));
  return shots.map((shot,index)=>{
    if(!shot||!ids.has(shot.avatarId))throw new Error('镜头'+(index+1)+'的形象不存在，请重新选择');
    if(typeof shot.duration!=='number'||!Number.isFinite(shot.duration)||shot.duration<=0)throw new Error('镜头'+(index+1)+'的时长必须是大于0的有效秒数');
    return {avatarId:shot.avatarId,duration:shot.duration};
  });
}

export function distributeShotDurations(duration,count){
  if(!Number.isFinite(duration)||duration<=0)throw new Error('驱动音频没有可用时长，请重新选择音频');
  if(!Number.isSafeInteger(count)||count<1)throw new Error('请先添加镜头');
  // 以十分之一秒分配余数，保证各镜头相差不超过0.1秒且总和不漂移。
  const ticks=Math.round(duration*10);
  if(!Number.isSafeInteger(ticks)||ticks<count)throw new Error('音频过短，无法为每个镜头分配至少0.1秒');
  const base=Math.floor(ticks/count),remaining=ticks%count;
  return Array.from({length:count},(_,index)=>(base+(index<remaining?1:0))/10);
}

export function moveShot(shots,from,to){
  const result=shots.slice();
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=result.length||to<0||to>=result.length)return result;
  const [shot]=result.splice(from,1);result.splice(to,0,shot);return result;
}

export function shotTotal(shots){
  return Math.round((shots||[]).reduce((total,shot)=>total+(Number.isFinite(shot.duration)&&shot.duration>0?shot.duration:0),0)*1000)/1000;
}
