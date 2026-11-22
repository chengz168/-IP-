// 从视频工厂制作方法适配；只提供中文规则，不执行第三方脚本或复制上游节点契约。
export const productionSkillsVersion='2026-11-22.3';
export const creativeStageNames={topic:'选题',script:'文案',rewrite:'改写',episodes:'拆集',shots:'分镜',assets:'资产提取',image:'图片',video:'视频',voice:'配音',subtitles:'字幕',compose:'剪辑合成',review:'交付复核'};
const origin={project:'视频工厂',revision:'815f29ff9a17e89c68e9c7a479237a5ba56e2b32',files:['src/storage/production-skills.js','src/storage/production-resources.js','src/storage/skills-store.js'],usage:'项目内制作方法的中文适配；未复制上游输出字段，不执行外部代码。'};
const skill=(id,name,description,stages,rules,sourceIds=[],typeIds=[],execution='prompt')=>({id,name,description,stages,rules,sourceIds,typeIds,execution,version:productionSkillsVersion,origin});
const skills=[
 skill('audience-hook','受众与开场设计','先确认观众要解决的问题，再选择有依据的开场。',['topic','script'],['根据已知受众和内容目标确定一个具体问题；开场用可见特点、问题或变化引入。商品可用需求与证据，知识先解释问题，故事用人物目标，不把所有题材都套成带货。'],['builtin-short-video','builtin-production-script-continuity']),
 skill('script-continuity','剧本结构与叙事连续','让台词、画面与事件因果相互对应。',['script'],['先固定受众、时长、人物与已知事实，再组织可见事件与对应台词。每段推进一个信息或行动，区分旁白与人物对白；保留已确认设定与因果，不为钩子编造经历。'],['builtin-production-script-continuity']),
 skill('rewrite-clarity','口语改写与事实保留','减少念稿感，同时保留原文条件和信息。',['rewrite'],['按原句含义调整语序和短句，让停顿服从语义；保留事实、否定、数字与限制，不添加亲测、对白或结局。已确认台词未经用户采用不得暗改。'],['builtin-short-video','builtin-production-speech-performance']),
 skill('episode-planning','拆集与分集规划','按自然边界分集，完整覆盖原稿。',['episodes'],['只划分完整原稿，按场景、主题或事件变化选择自然边界；原文按顺序出现一次且完整覆盖，不摘要、不改写、不提前写后集。集数和边界服从本应用给定字段，不能照搬其他工具的输出格式。'],['builtin-production-episodes']),
 skill('shot-staging','分镜调度与镜间衔接','把情绪和概念落实为单镜可见动作。',['shots'],['每镜明确主体、起始状态、一个主要动作及结束状态，景别必须能看见动作，固定机位不同时要求环绕。相邻镜检查视线、左右站位、持物手、道具位置和主光方向；不把后镜状态提前画出。'],['builtin-production-shot-staging']),
 skill('asset-binding','资产识别与复用','从当前镜头提取人物、场景与道具，并绑定真实标识。',['assets'],['只提取本次画面和动作中的具体人物或动物、完整场所和可移动道具。光线、景别、情绪与运镜不是独立资产；相同实体跨镜复用，名称相似不能代替身份核对。已有实体复用允许清单中的准确真实ID；新实体使用本次结果内唯一临时key，由服务端校验后分配真实ID。空复用清单不代表不能提取新实体。每个所选镜头都须绑定至少一个有画面依据的具体实体；不能虚构实体、已有素材或图片文件。'],['builtin-production-prop-state','builtin-production-scene-space']),
 skill('reference-continuity','角色服装与道具一致','固定外观与结构，让首帧保留动作起点。',['image'],['分别锁定人物身份、当前服装配色和道具形态，描述本镜动作开始前的姿态、构图与光线。产品结构、颜色与标识以真实参考为准，缺视角不补造；文字描述与实际绑定素材分开，没有真实参考不能声称锁定身份。'],['builtin-production-reference-continuity','builtin-production-prop-state','builtin-production-scene-space']),
 skill('video-motion','镜头动作与视频连续性','沿用首帧，按本镜时长完成一个清晰动作。',['video'],['从实际首帧出发描述动作起点、方向与终态，主体运动和机位运动分开；只制作当前镜头，不重演前后剧情。沿用服装、道具、持物手与光色，不用“同一个”代替必要外观描述。仅采用适配器实际绑定的图片、时长和声音能力，提示词不能开启多参考、尾帧或克隆。'],['builtin-production-video-motion']),
 skill('speech-performance','配音口语与表演','核对说话人、语义停顿、重音与自然听感。',['voice'],['按已确认台词核对说话人和时长，试听停顿、语义重音和情绪变化；改台词须显式采用。只调整当前配音服务实际支持的参数；本清单不向音频模型注入文字标签，不能凭提示词开启情绪或克隆。'],['builtin-production-speech-performance'],[],'checklist'),
 skill('subtitle-readability','字幕节奏与可读性','检查真实台词、分行、时间和画幅安全区。',['subtitles'],['依据实际音轨和已确认台词检查专有名词、语义分行、重叠与结束时间；检查竖屏安全区及对比度。逐镜估时不能冒称字级对齐，精确字幕交后期制作并审看。'],['builtin-production-subtitle-readability'],[],'checklist'),
 skill('edit-rhythm','合成节奏与声画检查','按镜头顺序与实际时长检查声画衔接。',['compose'],['核对已确认镜头顺序、实际时长、切点、黑场、静音与音画超时；不能静默截断台词或拉伸人物凑时长。转场与配乐仅采用已有参数，检查建议不等于编辑操作已执行。'],['builtin-production-edit-rhythm'],[],'checklist'),
 skill('delivery-proof','制作证据与交付复核','分别审查技术规格与内容质量，列出未检查项。',['review'],['分别核对内容完整、角色服装、道具动作、非预期文字、声音字幕与技术规格。没有实际看图、看视频或听音的项目必须标未检查，文件存在和请求成功不能代表作品质量通过。保留人工确认，不自动发布。'],['builtin-production-quality-evidence','builtin-production-delivery-proof'],[],'checklist')
];
skills[0].stageRules={topic:['标题是一句明确的选题；开头钩子只写一句可直接说给观众的话，不写“资料提到”“模型”“创作要求”等后台说明。人设角度用一句简短制作方向，不能自称助手或把人设解释写成旁白。不虚构“很多同事问我”“我亲测”等经历。']};
export function productionSkillCatalog(){return structuredClone(skills);}
export function resolveProductionSkills(stage,typeId){return productionSkillCatalog().filter(s=>s.execution==='prompt'&&s.stages.includes(stage)&&(!s.typeIds.length||s.typeIds.includes(typeId))).map(s=>({...s,rules:[...s.rules,...(s.stageRules?.[stage]||[])]}));}
