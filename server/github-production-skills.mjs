// 只适配已核对许可的公开方法，不执行上游脚本，也不改变本产品输出契约。
export const githubProductionSkillsVersion='2026-11-23.1';
export const githubProductionSkillSources=[
 {id:'github-video-design',name:'Video Toolkit · 视频画面设计',repository:'digitalsamba/claude-code-video-toolkit',revision:'5430de721de2d162e0ee5c02e6d824d7e774c359',path:'.claude/skills/video-design/SKILL.md',license:'MIT'},
 {id:'github-ads-creative',name:'Claude Ads · 商品创意证据',repository:'AgriciDaniel/claude-ads',revision:'fc3908e786c318776df89a3a098333da377364be',path:'skills/ads-creative/SKILL.md',license:'MIT'}
].map(source=>({...source,url:'https://github.com/'+source.repository+'/blob/'+source.revision+'/'+source.path,usage:'公开方法的中文适配；不执行上游工具，不代表效果已验收。'}));
const make=(id,name,description,stages,typeIds,sourceId,rules,stageRules={})=>{
 const source=githubProductionSkillSources.find(item=>item.id===sourceId);
 return {id,name,description,stages,typeIds,sourceIds:[sourceId],rules,stageRules,execution:'prompt',version:githubProductionSkillsVersion,origin:{project:source.name,revision:source.revision,files:[source.path],usage:source.usage}};
};
const skills=[
 make('product-evidence-mapping','商品卖点与画面证据','让开场、卖点和演示对应同一商品资料，避免空泛推销。',['script','rewrite','shots'],['product'],'github-ads-creative',[
  '把每个商品特点对应到已提供详情、图片或真实演示：开场提出具体用途，中段说明一个有资料依据的特点，再用对应画面承接。资料不足就减少断言，不能编造性能、亲测、价格、优惠或销量。',
  '区分创意表达、画幅适配和真实投放效果；不能凭脚本好看声称转化率提升。图标只作信息辅助，不能替代商品实物或充当检测证明。'
 ],{shots:['逐镜写清本镜要让观众看懂的一个特点以及可见依据。整体、细节与使用动作按内容需要组合，不把相同商品图的不同缩放当成不同创意；没有正确参考素材时不可虚构演示结果。']}),
 make('visual-story-focus','叙事画面与单镜焦点','先定本段信息，再设计一个主要视觉主体，减少无意义装饰。',['shots','image'],[],'github-video-design',[
  '每镜只保留一个主要视觉焦点，构图服务当前台词或动作；相邻镜头延续已确认主体、空间和视觉基调。背景、光线和色彩变化必须有场景或叙事依据，不逐镜随机换风格。',
  '先决定画面让观众看懂什么，再选择整体、细节或动作景别；已有主体本身能够说明内容时，不增加无关装饰、悬浮图标或无依据的背景。精确文字与数字交给后期，不让生图模型绘制事实图表。'
 ],{image:['首帧只呈现本镜动作起点与必要环境；为人物、商品和后期字幕保留可用空间，避免主体被画幅边缘截断。不能为构图美化而改变真实商品形状、部件或开孔结构。']})
];
export function githubProductionSkillCatalog(){return structuredClone(skills);}
export function resolveGithubProductionSkills(stage,typeId){return githubProductionSkillCatalog().filter(skill=>skill.stages.includes(stage)&&(!skill.typeIds.length||skill.typeIds.includes(typeId))).map(skill=>({...skill,rules:[...skill.rules,...(skill.stageRules[stage]||[])]}));}
