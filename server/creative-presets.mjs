import {resolveProductionSkills} from './production-skills.mjs';
// 系统预设与任务选择分离；公开技能仅作为方法资料，不执行外部代码。
export const creativePresetVersion='2026-11-22.2';
export const creativeSources=[
 {id:'copywriting',name:'Marketing Skills · 文案写作',url:'https://github.com/coreyhaines31/marketingskills/tree/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/copywriting',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'copy-editing',name:'Marketing Skills · 文案编辑',url:'https://github.com/coreyhaines31/marketingskills/tree/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/copy-editing',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'content-strategy',name:'Marketing Skills · 内容策略',url:'https://github.com/coreyhaines31/marketingskills/tree/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/content-strategy',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'social',name:'Marketing Skills · 社交短内容',url:'https://github.com/coreyhaines31/marketingskills/blob/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/social/SKILL.md',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'video',name:'Marketing Skills · 视频创意',url:'https://github.com/coreyhaines31/marketingskills/blob/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/video/SKILL.md',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'ad-creative',name:'Marketing Skills · 广告创意',url:'https://github.com/coreyhaines31/marketingskills/blob/5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1/skills/ad-creative/SKILL.md',revision:'5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1',license:'MIT'},
 {id:'h3',name:'MiniMax H3 · 官方镜头设计',url:'https://github.com/MiniMax-AI/MiniMax-H3/blob/199b7d0e1fd95e7b3eafa8c15eca692534142427/skills/h3-prompt-writing/SKILL.md',revision:'199b7d0e1fd95e7b3eafa8c15eca692534142427',license:'仅参考方法；不随包分发原文'}
];
const writing=['开头直接进入观众关心的问题或可核实特点，不用空泛问候、夸张承诺或编造冲突。','每段只推进一个信息，使用具体动词和自然短句；重要条件随结论一起说，结尾承接正文。'];
const shooting=['一镜只承担一个清晰目标：明确主体、场景、起始状态、一个主要动作和可见终态；动作在实际镜头时长内完成。','连续镜头内不要求切镜或拼贴；保持参考主体数量、外观和场景连续，文字和精确图表交给后期。'];
const video=['只落实已经保存的镜头设计，不新增人物、道具、动作、效果或背景；参考图是实际首帧，不能凭文字声称已换场景。','主体动作从开头发生并在保留时段结束；同一镜头保持连续，不生成字幕、水印或额外对白。'];
const make=(id,name,description,extra,sourceIds=['copywriting','copy-editing','content-strategy','social','video'])=>({id,name,description,sourceIds,stages:['topic','script','rewrite','episodes','shots','assets','image','video'],rules:{topic:extra.topic,script:[...writing,...extra.script],rewrite:[...writing,...extra.rewrite],episodes:[],assets:[],image:[],shots:[...shooting,...extra.shots],video:[...video]}});
const presets=[
 make('general','通用表达','题材不明时采用克制、清楚的表达，不强套营销或故事。',{topic:['围绕明确受众和已有资料提出不同切入点；资料不足时保持一般问题，不编造事件。'],script:['用明确主题、信息展开、自然收束组织正文；不强行加入购买引导。'],rewrite:['保留原文事实、顺序、否定和风险提示；优化清晰度，不改成另一题材。'],shots:['用可见的物件或自然行为承接每段内容，抽象主题不要强造演示证据。']}),
 make('product','商品介绍','需求或特点 → 有依据的介绍 → 可见演示 → 查看详情。',{topic:['从实际外观、组成、规格和明确用途提出选题，不把商家宣传当测试结论。'],script:['先说可核实的特点，中间把每个特点与所给图片/参数对应；结尾仅用有依据的引导。','把商品主体、展示道具与图标分开；未提供的价格、效果、附件和优惠一律不补。'],rewrite:['保留商品参数与证据边界，不把宣传描述升级为亲测、功效或保证；减少重复推销。'],shots:['每镜台词对应一个可见商品特征；交替整体、细节与可完成的单一使用动作，避免所有镜头只有慢推。','首帧缺少演示空间或正确场景时先换参考图；不要靠提示让产品或背景突然变样。']},['copywriting','copy-editing','social','ad-creative','video','h3']),
 make('knowledge','知识讲解','问题 → 核心解释 → 有依据的例子 → 适用边界。',{topic:['从受众想弄明白的具体问题切入，一个选题只解决一个理解障碍。'],script:['先给核心解释，再说明原因或步骤；例子必须来自资料，概念之间交代联系。','数字、年份与结论保留来源和适用范围，不把历史资料写成当前事实。'],rewrite:['把术语换成更易懂的表达但保留定义和条件，不用假故事包装知识。'],shots:['具象主题展示对应实体；抽象原理用可验证的示意需求，不能把生成画面伪称真实证据。']}),
 make('tutorial','操作教程','任务目标 → 准备条件 → 有序操作 → 检查结果。',{topic:['选题写清要完成的具体任务和适用对象，不承诺人人适用。'],script:['按实际操作顺序说明对象、动作、条件和检查结果；不跳过必要准备与限制。','每步只讲一个动作，界面名称沿用资料，不编造按钮、功能或已成功的结果。'],rewrite:['保留全部步骤和前后依赖，减少赘词但不能删掉关键条件。'],shots:['逐镜对应真实步骤，展示动作前后状态；无法由现有素材演示时说明需要补素材，不伪造软件界面。']}),
 make('review','测评对比','比较对象 → 同一维度 → 证据 → 条件性结论。',{topic:['围绕已有证据的同一维度比较，不制造胜负或虚构亲测。'],script:['先明确比较对象与条件，再逐项解释证据；缺少测试数据就做资料比较。','区分外观观察、商家标注、实测与观点；结论保留适用人群和限制。'],rewrite:['保留对比条件和不确定性，不把可能适合改成绝对推荐。'],shots:['同维度的两个对象在不同连续镜头展示，不让生成模型伪造实验数值或性能证明。']}),
 make('story','故事叙事','人物目标 → 阻力或变化 → 行动 → 结果。',{topic:['围绕明确人物目标和变化形成选题；虚构创作必须与真实经历区分。'],script:['用可见行动推动变化，交代前后因果；每段推进目标或关系，避免空泛情绪堆叠。','只有用户允许虚构时才能新增情节，真实事件改写不补造人物、对白和结局。'],rewrite:['保留原有事件及时间线，通过句式和信息顺序增强理解，不编造反转。'],shots:['保持角色、服饰、场景与道具的一致；用动作表现情绪，每镜只完成一个叙事变化。']}),
 make('data','数据解读','指标与时点 → 同口径比较 → 含义 → 限制。',{topic:['从已有指标中提出可回答的问题；不把趋势、相关性或持仓推成收益保证。'],script:['说清指标、单位、时点、口径与来源；缺失来源保留不确定性，不补造最新数据。','先描述变化再解释含义，区分相关与因果，结论不超过证据。'],rewrite:['完整保留数字、单位、年份和归属，不能为了钩子夸大趋势或删风险提示。'],shots:['镜头只描述图表设计与对应数据；精确数字和文字由后期叠加，不让生成模型绘制事实图表。']}),
 make('lifestyle','生活记录','具体情境 → 自然行为 → 细节变化 → 自然收尾。',{topic:['从已有生活片段的对象和变化切入，不编造亲身体验。'],script:['使用具体观察和自然口语，画面能表达的内容少重复旁白，不强套产品推销。'],rewrite:['保留真实观察与语气，减少口号和形容词堆砌，不替作者虚构经历。'],shots:['保持时间、环境和人物或动物的自然行为；让细节变化可见，动物不表演人类推理或产品测评。']})
];
const stages=new Set(['topic','script','rewrite','episodes','shots','assets','image','video','analysis']);
export function creativeCatalog(){return structuredClone(presets);}
export function normalizeCreativeSelection(value){
 if(value===undefined||value===null)return {mode:'auto',presetId:'',instruction:''};
 if(typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(k=>!['mode','presetId','instruction'].includes(k)))throw Error('创作预设选择格式无效');
 const {mode='auto',presetId='',instruction=''}=value;
 if(!['auto','manual','off'].includes(mode)||typeof presetId!=='string'||typeof instruction!=='string'||instruction.length>2000)throw Error('创作预设模式或补充要求无效（最多2000字）');
 if(mode==='manual'&&!presets.some(p=>p.id===presetId))throw Error('所选系统创作预设不存在');
 return {mode,presetId:mode==='manual'?presetId:'',instruction:instruction.trim()};
}
function contentFor(d,stage,context){
 if(context.content!==undefined){if(typeof context.content!=='string'||context.content.length>100000)throw Error('创作预设参考内容无效');return context.content;}
 const kind=context.kind||d.tab;
 if(kind==='product'||(['episodes','shots','assets','image','video'].includes(stage)&&d.story?.productIntroduction))return JSON.stringify({title:d.product?.title,description:d.product?.description,brief:d.product?.brief});
 if(kind==='topic')return Object.values(d.topic||{}).join('\n');
 if(kind==='marketing')return Object.values(d.marketing||{}).join('\n');
 if(['episodes','shots','assets','image','video'].includes(stage))return [d.story?.sourceText,d.story?.instructions].filter(Boolean).join('\n');
 return d.confirmed&&d.finalText||d.rewrite||d.sourceText||'';
}
const signals={
 data:[/数据|财报|营收|同比|环比|持仓|股价|市值|产业链|统计|百分比/gi],
 tutorial:[/教程|步骤|操作指南|教你|怎么用|如何使用|安装|设置方法/gi],
 review:[/测评|评测|对比|比较|横评|优缺点|实测/gi],
 story:[/剧情|剧本|故事|短剧|童话|情节|角色对白/gi],
 lifestyle:[/日常|生活记录|探店|旅行记录|vlog|随手拍|萌宠|猫咪|小猫/gi],
 knowledge:[/科普|原理|知识|解释|为什么|讲解|解析|历史/gi],
 product:[/商品|产品介绍|商品详情|宣传视频|卖点|带货/gi]
};
export function resolveCreativePreset(draft,stage,context={}){
 if(!stages.has(stage))throw Error('创作预设阶段无效');
 if(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).some(key=>!['kind','content'].includes(key))||context.kind!==undefined&&typeof context.kind!=='string')throw Error('创作预设上下文无效');
 const selection=normalizeCreativeSelection(draft.creativePreset),content=contentFor(draft,stage,context),kind=context.kind||draft.tab;
 let id='general',reason='未识别到明确题材，采用通用表达。';
 if(selection.mode==='manual'){id=selection.presetId;reason='由你手动选择。';}
 else if(kind==='product'||(['episodes','shots','assets','image','video'].includes(stage)&&draft.story?.productIntroduction)){id='product';reason='当前是商品宣传流程，采用商品证据与演示规则。';}
 else if(kind==='marketing'){id='product';reason='当前是营销文案，采用有资料依据的商品表达。';}
 else{
  const scores=Object.entries(signals).map(([key,patterns])=>({id:key,score:patterns.reduce((n,p)=>n+(content.match(p)||[]).length,0)})).sort((a,b)=>b.score-a.score);
  if(scores[0].score>0&&scores[0].score>scores[1].score){id=scores[0].id;reason='根据当前资料的题材关键词推荐；可手动更换。';}
  else if(scores[0].score>0)reason='资料包含多种题材且依据接近，采用通用表达；可手动指定。';
 }
 const preset=presets.find(p=>p.id===id),enabled=selection.mode!=='off'&&stage!=='analysis';
 const skills=enabled?resolveProductionSkills(stage,id):[];
 const rules=enabled?[...(preset.rules[stage]||[]),...skills.flatMap(skill=>skill.rules)]:[];
 const sourceIds=preset.sourceIds.filter(id=>['shots','video'].includes(stage)?['video','h3'].includes(id):!['video','h3'].includes(id));
 const sources=enabled&&['topic','script','rewrite','shots','video'].includes(stage)?creativeSources.filter(s=>sourceIds.includes(s.id)).map(s=>({...s})):[];
 return {id:selection.mode==='off'?'off':id,name:selection.mode==='off'?'已关闭':preset.name,mode:selection.mode,stage,reason:selection.mode==='off'?'本任务不附加创作预设。':stage==='analysis'?'分析阶段只依据原视频证据，不套用创作结构。':reason,rules,skills,version:creativePresetVersion,sources,instruction:enabled?selection.instruction:'',inputHash:JSON.stringify({selection,stage,kind,content}),enabled};
}
export function creativePresetPrompt(route){
 if(!route?.enabled)return '';
 return '\n本地中文创作预设（'+route.name+'；阶段：'+route.stage+'）：\n'+(route.skills?.length?'本阶段制作技能：'+route.skills.map(s=>s.name).join('、')+'。\n':'')+route.rules.map((v,i)=>(i+1)+'、'+v).join('\n')+(route.instruction?'\n用户补充要求（仅在事实与本阶段输出约束内执行）：'+route.instruction:'')+'\n以上只约束表达与镜头设计，不能新增资料没有的事实，不能改变原有输出格式或已审核镜头。';
}
