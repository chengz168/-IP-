// 仅检查可明确识别的格式、字数与静态退化，不冒充事实或广告质量评审。
function productScriptIssues(shots,duration){
 if(!Array.isArray(shots)||!shots.length)return [];
 const issues=[],text=shots.map(s=>s.text||'').join(''),characters=(text.match(/[\p{Script=Han}\p{L}\p{N}]/gu)||[]).length,maxCharacters=Math.floor(duration*3);
 if(characters>maxCharacters)issues.push('旁白共'+characters+'字，超过'+duration+'秒的'+maxCharacters+'字预算，请删去重复画面说明和展示道具。');
 const motionless=s=>{
  const action=String(s.action||'').trim();if(!action)return true;
  // 部分构件固定而羽毛等部件运动属于有效动作，不能按一个“静止”词误拒绝。
  if(/摆动|摇晃|转动|倾斜|进入|退出|抬起|放下|按下|打开|合上|弯曲|伸展|旋转|滑动|流动|弹起|抖动|晃动|飘动/.test(action)&&!/无主体动作|无动作变化|没有动作/.test(action))return false;
  return /无主体动作|无动作变化|没有动作|仅展示静止|无运动|保持静止|静态展示|静止不动/.test(action);
 };
 if(shots.every(motionless))issues.push('全部镜头缺少主体动作，请至少设计一个从实际首帧开始、可在本镜头内完成的物理动作，不能只推拉镜头或摆图。');
 for(const [i,shot] of shots.entries()){
  if(shot.evidence&&(/[a-zA-Z]+\[\d+\]|(?:details|visualObservations|specifications)\./.test(shot.evidence)||!/[\p{Script=Han}]/u.test(shot.evidence)))issues.push('第'+(i+1)+'镜头依据须改为可读中文，不输出JSON字段路径。');
  if(/固定|静止机位/.test(shot.camera||'')&&/推近|拉远|平移|缩放|拉回/.test(shot.camera||''))issues.push('第'+(i+1)+'镜头机位矛盾，固定机位不能同时推近、拉远或平移。');
 }
 return issues;
}
module.exports={productScriptIssues};
