// 以下正文依据原版客户端静态代码重建；不代表服务器内部提示词。
export const referenceClientSource = Object.freeze({
 kind: 'reference-client-static',
 rendererSha256: '6ec9ec8c7a163ff8045f01d17a66274d632c31e46814e47668dbad1f22cc6dcb',
 evidence: 'evidence/reference/generation-hints-20261115/prompt-functions.json',
 serverInternalKnown: false,
});

export const referenceOutputConstraints = [
 '【输出格式强约束】',
 '1. 只输出最终文案正文，不得输出标题。',
 '2. 不得输出任何话题标签/文案标签（如 #xxx、【xxx】等）。',
 '3. 不得输出 emoji 表情。',
 '4. 不得输出解释、过程、分析、注释或任何与文案无关的内容。',
 '5. 输出内容不用换行',
].join('\n');

export function withReferenceOutputConstraints(prompt) {
 return prompt?.includes('【输出格式强约束】') ? prompt : prompt + '\n\n' + referenceOutputConstraints + '\n';
}

export function referenceRewritePrompt({text, template, wordLimit}) {
 const limit = wordLimit ? `【字数限制要求：请忽略以下用户附加要求中可能存在的字数要求的部分，严格遵循 ${wordLimit} 字进行文案输出。】\n\n` : '';
 return withReferenceOutputConstraints(template
  ? limit + ' 以下是用户附加的要求：' + template + '\n\n请根据以下要求改写文案：\n原始文案：' + text + '\n\n请直接输出改写后的文案内容，不要包含任何解释或额外信息。'
  : limit + '请帮我改写以下文案，使其更加吸引人、生动有趣，保持原意的同时提升表达效果：\n\n原文案：' + text + '\n\n请直接输出改写后的文案内容，不要包含任何解释或额外信息。');
}

export function referenceMarketingPrompt({name, selling, audience, promotion, persona, template, wordLimit}) {
 const limit = wordLimit ? `【字数限制要求：请严格将改写后的文案控制在 ${wordLimit} 字左右。\n\n` : '';
 return withReferenceOutputConstraints(limit + (template ? '【风格/要求设定】：\n' + template + '\n\n' : '')
  + '以下是用户的产品信息，根据要求创作一篇吸引人的短视频口播文案：\n产品名称：' + (name || '未提供')
  + '\n产品卖点：' + (selling || '未提供') + '\n适用人群：' + (audience || '未提供')
  + '\n优惠活动：' + (promotion || '未提供') + '\n人设风格：' + (persona || '未提供')
  + '\n\n要求：\n1. 语言生动有趣，富有感染力，开头要能吸引人，直接戳痛点或抛出反常识观点。\n2. 突出产品卖点和优惠信息\n3. 符合指定的人设风格（如有）\n\n请直接输出文案内容，不要包含任何解释或额外信息。');
}

export function referenceKeywordTopicsPrompt({keyword, persona, customPersona, audience, count = 5, history = []}) {
 let prompt = '你是短视频爆款选题策划专家，擅长为个人IP设计真人出镜口播短视频选题。\n\n用户输入：\n关键词：' + keyword.trim()
  + '\n人设方向：' + (String(persona || '').trim() || '未提供') + '\n我的人设：' + (String(customPersona || '').trim() || '未提供')
  + '\n目标人群：' + (audience?.trim() || '未提供') + '\n平台：按通用口播短视频/抖音爆款逻辑处理\n\n请生成' + count
  + '个适合真人口播短视频的选题。\n\n要求：\n1. 选题必须适合口播。\n2. 选题要利于打造个人IP，能体现观点、经验、专业度、真实经历或方法论。\n3. 每个选题都要符合爆款逻辑，例如痛点、反常识、避坑、误区、清单、对比、故事、争议观点。\n4. 标题要像短视频标题，不要像文章标题。\n5. 不要使用绝对化、夸大承诺、违规引导表达。\n6. 如果提供了【我的人设】，请优先围绕该人设的身份、经验、表达风格和内容边界设计选题。\n7. 只返回 JSON，不要返回 Markdown。\n8. topics 数组必须刚好返回 ' + count
  + ' 条。\n9. 不要返回开头钩子或 hook 字段，开头钩子会在生成文案时再设计。\n10. JSON 必须能被 JSON.parse 直接解析，不要尾逗号，不要注释，不要在 JSON 前后添加任何解释。';
 if (history.length) prompt += '\n\n【本轮已生成过的选题】\n' + history.map((title, index) => index + 1 + '. ' + title).join('\n') + '\n\n请避开以上选题，不要生成标题相同或角度高度相似的内容。';
 return prompt + '\n\nJSON 格式：\n{\n  "keyword_analysis": "这个关键词适合做个人IP的内容机会分析，100字以内",\n  "topics": [\n    {\n      "title": "选题标题",\n      "persona_angle": "这个选题如何强化个人IP"\n    }\n  ]\n}';
}

export function referenceTopicCopyPrompt({keyword, persona, customPersona, audience, title, personaAngle, wordLimit}) {
 return withReferenceOutputConstraints('你是一个专业的短视频口播文案创作者。请根据以下选题创作一篇适合真人出镜的口播短视频文案。\n\n关键词：' + keyword.trim()
  + '\n人设方向：' + (String(persona || '').trim() || '未提供') + '\n我的人设：' + (String(customPersona || '').trim() || '未提供')
  + '\n目标人群：' + (audience?.trim() || '未提供') + '\n\n选题标题：' + title + '\n人设角度：' + (personaAngle || '未提供')
  + '\n\n创作要求：\n1. 基于选题标题设计一个爆款开头钩子，开头3秒必须抓人，直接戳痛点或抛出反常识观点。\n2. 中段要有个人IP表达，体现经验、观点、专业判断或方法论。\n3. 语言口语化，有短视频节奏，适合真人直接照着拍。\n4. 不要夸大承诺，不使用绝对化、违规或高风险表达。\n5. 如果提供了【我的人设】，请优先贴合该人设的身份、经历和表达风格。\n6. 篇幅控制在' + (Number(wordLimit) || 200) + '字左右。');
}
