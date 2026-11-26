// 统一来源和内容类型画像。它只做可解释的路由建议，不把类型猜测当成内容事实。
export const contentTypeVersion='2026-11-26.1';

const definitions=[
 {id:'talking-head',name:'口播表达',presetId:'general',outputMode:'spoken',aliases:['口播','讲解','出镜'],requires:['已确认正文','可选人物视频或配音'],pipeline:['script','rewrite','voice','avatar','subtitle','edit'],rules:['台词是主叙事，画面只承担人物表达、示范或辅助信息。']},
 {id:'product-promo',name:'商品宣传',presetId:'product',outputMode:'product',aliases:['商品','产品','带货','种草','详情页'],requires:['商品详情或已核实商品图','商品卖点依据','可选图标素材'],pipeline:['product-script','voice','product-video','subtitle','edit'],rules:['商品外观、规格和功效边界必须来自已核实资料；原图和动态镜头分开核对。']},
 {id:'tutorial',name:'操作教程',presetId:'tutorial',outputMode:'spoken',aliases:['教程','步骤','操作','安装','设置'],requires:['完整步骤或可复现素材'],pipeline:['script','shots','assets','voice','video','subtitle','edit'],rules:['每镜只完成一个动作，保留前置条件和检查结果。']},
 {id:'knowledge',name:'知识讲解',presetId:'knowledge',outputMode:'spoken',aliases:['科普','原理','解释','解析','知识'],requires:['可核实资料和适用范围'],pipeline:['script','voice','assets','video','subtitle','edit'],rules:['区分资料事实、解释和推测，不把相关性写成因果。']},
 {id:'review',name:'测评对比',presetId:'review',outputMode:'spoken',aliases:['测评','评测','对比','横评','优缺点'],requires:['比较对象和同口径证据'],pipeline:['script','shots','assets','voice','video','subtitle','edit'],rules:['先锁定比较维度，再给条件性结论，不虚构亲测数据。']},
 {id:'data-explainer',name:'数据解读',presetId:'data',outputMode:'spoken',aliases:['数据','财报','营收','同比','统计','产业链'],requires:['指标、单位、时点和来源'],pipeline:['script','assets','voice','video','subtitle','edit'],rules:['精确数字和图表由后期叠加，生成模型不能代替事实图表。']},
 {id:'story-drama',name:'故事短剧',presetId:'story',outputMode:'narrative',aliases:['故事','剧情','短剧','对白','角色'],requires:['人物目标、场景和事件边界'],pipeline:['episodes','shots','assets','image','video','subtitle','edit'],rules:['保持角色、服装、道具和场景连续，每镜只推进一个叙事变化。']},
 {id:'lifestyle-vlog',name:'生活记录',presetId:'lifestyle',outputMode:'spoken-or-narrative',aliases:['日常','生活记录','vlog','旅行','探店'],requires:['真实场景或可核实观察'],pipeline:['script','shots','assets','voice','video','subtitle','edit'],rules:['用具体观察组织内容，不把模型推测写成亲历事实。']},
 {id:'pet-animal',name:'宠物与动物',presetId:'lifestyle',outputMode:'narrative',aliases:['宠物','猫咪','小猫','狗狗','萌宠','动物'],requires:['动物真实素材或明确生成参考'],pipeline:['script','shots','assets','image','video','subtitle','edit'],rules:['保持动物外观和行为连续，不让动物承担人类对白或未经支持的产品测评。']},
 {id:'non-verbal-visual',name:'非口播画面叙事',presetId:'general',outputMode:'visual',aliases:['非口播','画面展示','氛围','音乐视频','纯画面'],requires:['参考画面或分镜文字','可选音乐/音效'],pipeline:['episodes','shots','assets','image','video','subtitle','edit'],rules:['以画面和动作推进，不把歌词、画面观察或模型推测冒充口播事实。']}
];

const normalize=value=>String(value||'').trim().toLowerCase();
// 生成限制不是题材证据；只移除当前否定分句，保留逗号后的正向正文。
export const contentTopicText=value=>normalize(value).replace(/(?:禁止|不要|避免|无需|不得|不能|不包含|不生成|不出现|无对白|无台词|无口播)[^，,。！？；;\n]*/g,'').replace(/日常(?=(?:应该|需要|要|的)?(?:怎样|如何|怎么)?(?:清洁|清理|保养|维护|使用))/g,'');
const textOf=input=>[...new Set([input?.title,input?.description,input?.brief,input?.text,input?.sourceText,input?.transcript?.text,input?.analysis?.summary].filter(value=>typeof value==='string'))].join('\n');
const scoreDefinition=(definition,text,input)=>{
 let score=0;const hits=[];for(const alias of definition.aliases){if(text.includes(normalize(alias))){score+=alias.length>2?3:1;hits.push(alias);}}
 // 设备或板材与选购/规格介绍共同出现才提供商品上下文；单个设备名不代表带货。
 if(definition.id==='product-promo'&&/(?:扒炉|烤炉|板材|板面)/.test(text)&&/(?:选购|厂家|咱们厂|我们厂|规格|厚度|毫米)/.test(text)){score+=2;hits.push('设备或板材的选购与规格介绍');}
 if(definition.id==='product-promo'&&(input?.sourceKind==='product-page'||input?.hasProductFacts===true)){score+=20;hits.push('商品资料来源');}
 if(definition.id==='non-verbal-visual'&&['music-visual','visual'].includes(input?.analysis?.contentType)){score+=20;hits.push('画面主体分析');}
 if(definition.id==='talking-head'&&input?.analysis?.contentType==='spoken'){score+=4;hits.push('主体台词分析');}
 if(definition.id==='lifestyle-vlog'&&input?.analysis?.contentType==='mixed')score+=2;
 return {id:definition.id,score,hits:[...new Set(hits)]};
};

export function contentTypeCatalog(){return structuredClone(definitions);}
export function contentTypeById(id){const item=definitions.find(row=>row.id===id);return item?structuredClone(item):null;}
export function detectContentProfile(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('内容类型输入无效');
 const sourceKind=input.sourceKind||'text';
 // 配乐歌词不能成为题材判断依据；只用经过依据校验的画面分析摘要。
 const visual=['music-visual','visual'].includes(input?.analysis?.contentType);
 const text=contentTopicText(visual?input?.analysis?.summary:textOf(input));
 const ranked=definitions.map(item=>scoreDefinition(item,text,input)).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const top=ranked[0],second=ranked[1];
 // 没有任何命中依据时使用通用口播候选，避免按字母排序误判为数据解读。
 const fallback=definitions.find(item=>item.id==='talking-head')||definitions[0];
 const tied=top.score>0&&top.score===second.score;
 const definition=input.sourceKind==='product-page'||input.hasProductFacts===true?definitions.find(item=>item.id==='product-promo'):visual?definitions.find(item=>item.id==='non-verbal-visual'):top.score>0&&!tied?definitions.find(item=>item.id===top.id)||fallback:fallback;
 const selected=ranked.find(item=>item.id===definition.id);
 const explicitSource=input.sourceKind==='product-page'||input.hasProductFacts===true||visual;
 // 单个弱关键词只能给低置信度；领先分数不能凭空增加命中证据。
 const confidence=explicitSource?'high':top.score>=4&&top.hits.length>=2&&top.score>second.score*1.8?'high':top.score>=2&&top.score>second.score?'medium':'low';
 const candidates=ranked.filter(item=>item.score>0).slice(0,4).map(item=>({id:item.id,name:definitions.find(row=>row.id===item.id).name,score:item.score,hits:item.hits}));
 const reason=tied&&!explicitSource?'类型待确认：多种类型命中依据同分，暂用通用候选；请核对候选类型后手动选择。':selected.hits.length?('命中：'+selected.hits.join('、')):(input?.analysis?.contentType?('依据参考视频分析类型：'+input.analysis.contentType):'没有命中明确类型词，采用通用候选。');
 return {version:contentTypeVersion,sourceKind,type:definition.id,name:definition.name,presetId:definition.presetId,outputMode:definition.outputMode,confidence,reason,candidates,requires:[...definition.requires],pipeline:[...definition.pipeline],rules:[...definition.rules],needsUserConfirmation:confidence!=='high'};
}

export function contentTypePrompt(profile){
 if(!profile)return '';
 const names={script:'文案',rewrite:'改写',voice:'配音',avatar:'人物口型',subtitle:'字幕',edit:'剪辑',shots:'分镜',assets:'资产',episodes:'拆集',image:'图片',video:'视频','product-script':'商品脚本','product-video':'商品视频'};
 return `\n自动识别的内容类型画像（只用于路由建议，不是事实）：${profile.name}（置信度${{high:'高',medium:'中',low:'低'}[profile.confidence]}）。\n来源：${{'product-page':'商品资料','reference-video':'参考视频',text:'当前正文'}[profile.sourceKind]||'当前资料'}。建议制作链路：${profile.pipeline.map(step=>names[step]||'制作步骤').join('→')}。\n当前类型约束：${profile.rules.join('；')}\n识别结果仍需核对；如果素材与类型不符，应保留不确定性并要求补充素材。`;
}

export function validateContentProfile(profile){
 if(!profile||profile.version!==contentTypeVersion||!definitions.some(item=>item.id===profile.type)||typeof profile.sourceKind!=='string')throw Error('内容类型画像无效');
 if(!['low','medium','high'].includes(profile.confidence)||!Array.isArray(profile.pipeline)||!Array.isArray(profile.rules))throw Error('内容类型画像缺少路由信息');
 const definition=definitions.find(item=>item.id===profile.type);
 for(const key of ['name','presetId','outputMode','pipeline','rules','requires'])if(JSON.stringify(profile[key])!==JSON.stringify(definition[key]))throw Error('内容类型画像与系统类型目录不一致');
 if(profile.needsUserConfirmation!==(profile.confidence!=='high')||typeof profile.reason!=='string'||!Array.isArray(profile.candidates)||profile.candidates.some(row=>!definitions.some(item=>item.id===row.id&&item.name===row.name)||!Number.isFinite(row.score)||row.score<=0||!Array.isArray(row.hits)||row.hits.some(hit=>typeof hit!=='string')))throw Error('内容类型画像的识别依据无效');
 return structuredClone(profile);
}
