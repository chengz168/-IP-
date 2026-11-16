// 保留所选模板原文，额外的本地请求约束单独记录，不能冒充原厂云端拼接。
export function rewriteRequest(input){
 const {sourceText,wordLimit,analysis}=input.fields;
 const style=analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(analysis):'';
 const reference=input.template.source?.kind==='reference-visible';
 const requirements=reference?'请严格执行模板的开头限制：第一段仅包含原文首句在30字内的连贯截取，剩余动作放到后文，不能整段照搬。后文将原有动作按不同句式组织，不能只替换一两个词；不增加新的物品、经历、效果或因果解释。段落之间换行。':'保留原文具体动作和对象，以不同句式重新组织，不只替换结尾；不添加原文没有的事实。';
 return {system:input.template.content,user:`请将下列原文改写为约${wordLimit}字口播文案。${requirements}只输出可口播正文，不写标题、分析、创作说明或免责声明。\n原文：\n${sourceText}${style}`,wrapperSource:'local-rewrite-constraints-v1'};
}
