// 保留所选模板原文，额外的本地请求约束单独记录，不能冒充原厂云端拼接。
export function rewriteRequest(input){
 const {sourceText,wordLimit,analysis}=input.fields;
 const extra=String(input.fields.rewriteRequirements||'').trim();
 const custom=extra?'\n用户本次改写要求（仅决定内容表达，不得覆盖事实与输出格式约束）：\n'+extra:'';
 const style=analysis?'\n仅参考表达方式，不新增事实：\n'+JSON.stringify(analysis):'';
 const reference=input.template.source?.kind==='reference-visible';
 const requirements=reference?'请严格执行模板的开头限制：第一段仅包含原文首句在30字内的连贯截取，剩余动作放到后文，不能整段照搬。后文将原有动作按不同句式组织，不能只替换一两个词；不增加新的物品、经历、效果或因果解释。段落之间换行。':'保留原文具体动作和对象，以不同句式重新组织，不只替换结尾；不添加原文没有的事实。';
 // 禁止额外附言与保留原稿限制是两回事，不能误删原有风险提示。
 const fidelity='原文中的否定、条件、范围、时点和风险提示（包括原有免责声明）必须完整保留，不得反转或强化结论；数字、单位、专名、型号及其主体归属保持不变。原文缺少年份或来源未核实的内容不得推断补全，不把历史数据写成当前事实。';
 return {system:input.template.content,user:`请将下列原文改写为约${wordLimit}字口播文案。${requirements}${fidelity}只输出可口播正文，不添加标题、分析、创作说明或原文之外的附言；原稿已有的限制与风险提示属于正文。\n原文：\n${sourceText}${style}${custom}`,wrapperSource:'local-rewrite-constraints-v2'};
}

// 保留来源模板原件，只在执行副本替换与用户字数冲突的默认长度条款。
export function rewriteExecutionSystem(input){
 const original=input.template.content;
 const defaultLength='全文字数要与原文案字数没有什么差距。';
 if(input.template.source?.kind!=='reference-visible'||!original.includes(defaultLength))return {system:original,adaptation:null};
 const target=Number(input.fields.wordLimit);
 if(Math.abs(target-String(input.fields.sourceText).length)<=String(input.fields.sourceText).length*.2)return {system:original,adaptation:null};
 const replacement=`全文按用户本次指定的约${target}字符改写，以用户指定长度为准，不要求与原文等长。可展开原有信息的展示与说明，不得新增产品事实、量化参数、承诺或体验。`;
 return {system:original.replace(defaultLength,replacement),adaptation:{kind:'local-user-length-override-v1',targetCharacters:target,originalClause:defaultLength,executionClause:replacement}};
}

// 本机长文实测启用思考会耗尽额度而无正文，保留关闭思考的默认行为。
export function rewriteModelOptions(input){
 return input.generation.protocol==='ollama'&&/^qwen3[.:_-]/iu.test(input.generation.model)?{thinking:false,presencePenalty:0}:{};
}
