// 保留所选模板原文，额外的本地请求约束单独记录，不能冒充原厂云端拼接。
export function rewriteRequest(input){
 const {sourceText,wordLimit,analysis}=input.fields;
 const style=analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(analysis):'';
 const reference=input.template.source?.kind==='reference-visible';
 const requirements=reference?'请严格执行模板的开头限制：第一段仅包含原文首句在30字内的连贯截取，剩余动作放到后文，不能整段照搬。后文将原有动作按不同句式组织，不能只替换一两个词；不增加新的物品、经历、效果或因果解释。段落之间换行。':'保留原文具体动作和对象，以不同句式重新组织，不只替换结尾；不添加原文没有的事实。';
 // 禁止额外附言与保留原稿限制是两回事，不能误删原有风险提示。
 const fidelity='原文中的否定、条件、范围、时点和风险提示（包括原有免责声明）必须完整保留，不得反转或强化结论；数字、单位、专名、型号及其主体归属保持不变。原文缺少年份或来源未核实的内容不得推断补全，不把历史数据写成当前事实。';
 return {system:input.template.content,user:`请将下列原文改写为约${wordLimit}字口播文案。${requirements}${fidelity}只输出可口播正文，不添加标题、分析、创作说明或原文之外的附言；原稿已有的限制与风险提示属于正文。\n原文：\n${sourceText}${style}`,wrapperSource:'local-rewrite-constraints-v2'};
}
