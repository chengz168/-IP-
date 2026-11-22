import {processIssues} from './content-quality.mjs';
// 仅拦截明确可匹配的后台说明与凭空第一人称经历，不冒称完成通用事实核验。
export function assessTopics(input,items){
 const source=Object.values(input.fields||{}).join('\n'),issues=[];
 for(const [index,item] of items.entries()){
  const text=item.title+'\n'+item.hook+'\n'+item.personaAngle;
  for(const issue of processIssues(source,text))issues.push('选题'+(index+1)+'：'+issue);
  for(const pattern of [/(?:资料里|资料中|资料)(?:提到|给出|指出|提供|显示|里有|里的)/gu,/(?:很多|不少|经常有|常有)(?:同事|朋友|客户|粉丝|人)(?:都)?问我/gu,/(?:我(?:亲自|亲身|自己)?(?:实测|亲测|试用过)|作为(?:分享经验的)?助手|通用个人IP(?:的视角|视角))/gu]){
   for(const match of text.matchAll(pattern))if(!source.includes(match[0]))issues.push('选题'+(index+1)+'含资料未支持的经历或后台说明：'+match[0]);
  }
 }
 return {status:issues.length?'rejected':'needs-review',accepted:false,issues:[...new Set(issues)],scope:'只检查明确的后台说明和第一人称经历模式，吸引力及事实完整性仍需审看'};
}
