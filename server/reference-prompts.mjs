// 原软件界面可见模板全文；参考模型仅作来源记录，不自动作为执行配置。
export const referencePrompts=[
  {
    "id": "reference-copy-v840",
    "name": "原软件默认文案写作提示词",
    "description": "从已打开的原软件默认模板完整提取，适用于原文改写。",
    "type": "copy",
    "content": "# 你是一位文案改写助手，全文字数要与原文案字数没有什么差距。\n\n                ## 写作限制和特征\n                -禁止输出的词：“原文”“作者”“文章”等词，攻击性强、侮辱性强的词（滚吧、找爸爸去、废物）、骂人的词（傻子、垃圾、蠢蛋），ai常用词（如“这波操作”、“666”）\n                -用词口语化，句式有短句、情绪浓烈，\n                -不要输出前言和介绍，也不能直白的指责。\n                -写作的内容不要引用提示词的要求。\n\n                ## 写作要求\n                1、第一段直接照抄原文的第一句话作为文章开头，一个字也不能改，必须控制30个字以内，绝对禁止照抄的第一句话超过30个字，超过30个字在不影响句子连贯的情况下截停。\n\n                2、后面的内容要具体叙述具体行为，每一个具体动作都不能跳过，可以直接使用原文句子，但是不能完全一致，从原文案的内容里面，用不同的角度切入叙述，确保内容完整，可以使用同义字进行替换，重组结构。\n\n                3、最后一段可以直接使用原文的最后一段，如果有身份信息的内容，就不要写出来，**例如：我是某某，后续内容主页观看。**",
    "purposes": [
      "rewrite"
    ],
    "builtin": true,
    "source": {
      "kind": "reference-visible",
      "version": "8.4.0",
      "sha256": "e65728140d323c295ebe5dcf522c88e3efcfa169c5ee4afc9d7cfff0ae160054",
      "referenceModel": "doubao-seed-2-1-lite-260915",
      "evidence": "evidence/reference/prompt-audit/copy-default.txt"
    }
  },
  {
    "id": "reference-title-v840",
    "name": "原软件标题写作提示词",
    "description": "从原软件标题写作页完整提取，标题12字以内、描述50字以内。",
    "type": "title",
    "content": "请为以下内容生成一个吸引人的标题，要求简洁有力，能够吸引用户点击，标题字数控制在12字以内，描述控制在50字以内：",
    "builtin": true,
    "titleLimit": 12,
    "descriptionLimit": 50,
    "source": {
      "kind": "reference-visible",
      "version": "8.4.0",
      "sha256": "1686527122a398cdeaf17742372aff81274748403cbb8304f89ad2b8217b305a",
      "evidence": "evidence/reference/prompt-audit/title-visible.txt"
    }
  }
];
