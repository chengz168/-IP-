const crypto=require('node:crypto');

const digest=text=>crypto.createHash('sha256').update(String(text||'')).digest('hex');
const count=(text,pattern)=>(String(text||'').match(pattern)||[]).length;

// 题材类型与制作方式分开判断；只按文案里可见的结构和制作指令作解释性路由。
function detectVideoRoute(draft={},context={}){
 const text=String(draft.finalText||'').trim();
 const cues=[];
 const sceneCount=count(text,/(?:^|\n)\s*(?:[【\[])?(?:场景\s*[一二三四五六七八九十\d：:]|(?:内景|外景|地点)\s*[：:]|第[一二三四五六七八九十\d]+场|场\s*[：:]|镜头\s*[一二三四五六七八九十\d])/g);
 const labels=[...text.matchAll(/(?:^|\n)\s*([\u3400-\u9fffA-Za-z0-9_]{1,12})(?:[（(][^\n）)]{1,20}[）)])?\s*[：:]/g)].map(row=>row[1]).filter(label=>! /^(?:场景|地点|时间|内景|外景|镜头|旁白|画外音|配音|标题|正文|品牌|价格|材质|规格|尺寸|厚度|参数|颜色|卖点|步骤|注意|文案|画面|动作|音效|字幕|产品|商品|型号|建议|原因|优点|缺点|提示|总结|结论|操作|第一|第二|第三)/.test(label));
 const dialogueCount=labels.length,speakerCount=new Set(labels).size;
 const directionCount=count(text,/(?:镜头.{0,12}(?:移到|切到|转向|对准|给到|拉近|推进)|近景|特写|远景|全景|画面(?:切换|转到|出现)|(?:展示|演示|操作|清理)过程|拿起.{0,12}(?:展示|查看|对准)|先展示|再展示)/g);
 const sequenceCount=count(text,/(?:随后|紧接着|与此同时|另一边|转场到|切换到|此时|突然|没想到|就在这时)/g);
 const productBacked=!!(draft.product?.scriptRunId&&String(draft.product.title||'').trim()&&draft.product.shots?.some(shot=>shot.imageId));
 const directedVisual=directionCount>=2;
 const explicitDrama=sceneCount>=2||speakerCount>=2&&dialogueCount>=2;
 const explicitVisual=/(?:纯画面|无旁白|不需要口播|非口播|没有旁白)/.test(text);
 const narrativeActions=count(text,/(?:推开|走进|走出|转身|递给|接过|追上|抱住|拿起|放下|抬头|低头|跑向|赶到|发现|打开)/g);
 let mode='single',confidence='low',reason=text?'没有检测到明确场景、对白或展示指令，暂按人物讲解处理；可手动调整。':'等待确认最终文案后自动判断。',kind='spoken';
 if(productBacked){mode='product';kind='product';confidence='high';reason='当前任务已关联商品脚本和镜头商品图，进入商品宣传流程。';}
 else if(explicitDrama){mode='story';confidence='high';reason=`检测到${sceneCount?`场景/镜头标记 ${sceneCount} 处`:'角色对白结构'}，适合进入分集分镜流程。`;}
 else if(explicitVisual){mode='story';confidence='high';reason='最终文案明确要求以画面叙事或不使用口播。';}
 else if(directedVisual){mode='story';confidence='medium';reason=`检测到镜头、特写或演示指令 ${directionCount} 处，进入分镜展示，可在合成时使用第三步旁白。`;}
 else if(sequenceCount>=2&&narrativeActions>=3){mode='story';confidence='medium';reason=`检测到${sequenceCount}处事件转换和${narrativeActions}处人物动作，建议通过分镜呈现事件。`;}
 else if(/多镜头口播|切换不同形象|多个形象轮流/.test(text)){mode='multi';confidence='high';reason='文案明确要求多镜头口播或切换形象。';}
 if(mode==='story')kind=explicitDrama?'drama':directedVisual?'demonstration':explicitVisual?'visual':'narrative';
 if(sceneCount)cues.push(`场景/镜头标记 ${sceneCount} 处`);
 if(dialogueCount)cues.push(`对白行 ${dialogueCount} 处`);
 if(directionCount)cues.push(`画面/演示指令 ${directionCount} 处`);
 if(sequenceCount)cues.push(`事件/场景转换 ${sequenceCount} 处`);
 if(productBacked)cues.push('已有商品脚本与镜头商品图');
 if(explicitVisual)cues.push('明确无口播/画面叙事要求');
 const plan=context.plan===undefined?require('./video-production-plan.cjs').currentPlan(draft):context.plan;
 if(plan&&!/多镜头口播|切换不同形象|多个形象轮流/.test(text))return {version:'video-route-v2',sourceHash:plan.inputHash,mode:plan.mode,kind:plan.kind,confidence:plan.confidence,reason:plan.reason,cues:plan.cues,textLength:text.length,narrationMode:plan.narrationMode,productionPlan:plan};
 const reference=context.reference;
 if(reference&&['music-visual','visual'].includes(reference.contentType)&&!explicitDrama&&!/(?:本人|真人|数字人|主持人).{0,8}(?:出镜|口播)/.test(text)){mode='story';kind='visual';confidence='high';reason='当前关联的参考报告以画面为主，进入分镜创作；采样不代表逐帧动作验证。';cues.push('有效参考画面结构');}
 return {version:'video-route-v2',sourceHash:digest(JSON.stringify({text,reference:reference||null})),mode,kind,confidence,reason,cues,textLength:text.length,narrationMode:['spoken','demonstration','narrative','product'].includes(kind)?'upstream':'none'};
}

function effectiveVideoRoute(draft={}){
 const detected=detectVideoRoute(draft),policy=draft.video?.routing?.policy==='auto'?'auto':'manual';
 if(policy==='manual')return {...detected,policy,mode:['single','multi','story','product'].includes(draft.video?.mode)?draft.video.mode:detected.mode,recommendedMode:detected.mode,suggestion:detected.reason,reason:'沿用手动选择的制作方式。',manualOverride:true};
 return {...detected,policy,recommendedMode:detected.mode,suggestion:detected.reason,manualOverride:false};
}

function applyVideoRoute(draft,{select=true,...context}={}){
 draft.video??={};
 const route=detectVideoRoute(draft,context),policy=draft.video.routing?.policy==='auto'?'auto':'manual';
 if(select&&policy==='auto'&&draft.confirmed&&draft.finalText?.trim())draft.video.mode=route.mode;
 draft.video.routing={version:route.version,policy,mode:draft.video.mode,recommendedMode:route.mode,kind:route.kind,sourceHash:route.sourceHash,confidence:route.confidence,reason:policy==='manual'?'沿用手动选择的制作方式。':route.reason,suggestion:route.reason,cues:route.cues,narrationMode:route.narrationMode,...(route.productionPlan?{productionPlan:route.productionPlan}:{})};
 return draft;
}

module.exports={detectVideoRoute,effectiveVideoRoute,applyVideoRoute};
