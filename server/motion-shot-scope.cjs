// 整集编排保留在审计原文中，不能反复追加成当前单镜的画面指令。
function scopeMotionSource(source){
 const effective=structuredClone(source),omitted=[];
 const localRequirements=[source.visual,source.instruction].filter(value=>typeof value==='string').join('\n');
 const screenExcluded=/(?:不出现|不展示|不显示|不包含|没有|禁止出现|禁止展示)(?:电脑|屏幕|显示器|文档窗口)(?:[、，。；\s]|$)/u.test(localRequirements);
 for(const field of ['style','storyInstructions']){
  if(typeof effective[field]!=='string')continue;
  const clauses=effective[field].match(/[^。！？；;\n]+[。！？；;\n]?/gu)||[];
  effective[field]=clauses.map(clause=>{
   // 只有明确的多场景编排才移开；“全片围绕某个主题”等普通内容要求仍保留。
   const wholeStory=/(?:整集|整片|全片|全剧).{0,10}(?:围绕|依次|包含|分为).{0,160}(?:[二三四五六七八九十两多]|[2-9]\d*)个(?:具体)?(?:情境|场景|镜头|部分)|(?:[一二三四五六七八九十两多各]|\d+)个?镜头.{0,14}(?:分别|不同景别|依次|：|:)|(?:只需|共用).{0,160}(?:这[一二三四五六七八九十两\d]+项资产|这些资产)/u.test(clause);
   const alternating=clause.match(/(?:中景|近景|远景|特写)(?:和|与|、)(?:中景|近景|远景|特写)(?:镜头)?(?:交替|切换)/u);
   // 不删除明确的禁止性规则，也不按普通的“然后”误删本镜连续动作。
   const protectedConstraint=/(?:不要|不得|禁止|避免|不允许|不能|必须|保持|保留)/u.test(clause);
   const negativeAlternation=alternating&&/(?:不要|不得|禁止|避免|不允许|不能)\s*$/u.test(clause.slice(0,alternating.index));
   // 本镜明确排除显示设备时，整集的屏幕内容描述不能反向要求生成一个窗口；后面的禁令保留。
   const screenDescription=screenExcluded&&!protectedConstraint&&clause.match(/^\s*(?:电脑屏幕|显示器屏幕|屏幕|文档窗口)(?:为|是|呈现|显示)[^，,。！？；;\n]+[，,]?/u);
   if(screenDescription){omitted.push({field,text:screenDescription[0].trim(),reason:'本镜明确排除的显示设备内容'});return clause.slice(screenDescription[0].length).replace(/^[，,\s]+/u,'');}
   if(!protectedConstraint&&wholeStory){omitted.push({field,text:clause.trim(),reason:'跨镜头编排或整集资产清单'});return '';}
   if(!negativeAlternation&&alternating){omitted.push({field,text:alternating[0],reason:'跨镜头景别切换'});return clause.replace(alternating[0],'').replace(/([，,])\s*[，,]/gu,'$1').replace(/^[，,\s]+/u,'');}
   return clause;
  }).join('').trim();
 }
 return {effective,omitted};
}
module.exports={scopeMotionSource};
