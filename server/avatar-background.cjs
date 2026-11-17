const crypto=require('node:crypto'),fs=require('node:fs');

const SCENES=[
 {id:'business',label:'商务办公空间',keywords:['商业','企业','公司','职场','管理','投资','金融','社保','企业家','会议'],prompt:'自然写实的现代商务办公空间，落地窗、柔和日光、浅木色与中性灰材质，背景有克制的办公桌和远处虚化的会议区'},
 {id:'finance',label:'金融资讯演播室',keywords:['股票','基金','证券','行情','市场','经济','财富','指数','社保重仓'],prompt:'自然写实的金融资讯演播室，深蓝与暖灰色调，远处有低对比度数据屏和灯带，屏幕内容不可读且不出现品牌标识'},
 {id:'space',label:'航天科技展厅',keywords:['航天','火箭','卫星','太空','航空','宇宙','科技','芯片','人工智能','AI'],prompt:'自然写实的航天科技展厅，远处陈列抽象火箭模型和结构展台，冷白与蓝色环境光，细节真实但不抢主体'},
 {id:'health',label:'健康生活空间',keywords:['健康','医疗','养生','营养','健身','睡眠','心理','医院'],prompt:'自然写实的明亮健康生活空间，浅色墙面、绿植和干净的木质家具，柔和自然光，安静可信'},
 {id:'education',label:'知识讲解空间',keywords:['教育','学习','课程','知识','读书','考试','学校','方法'],prompt:'自然写实的知识讲解空间，书架、木桌和柔和窗光，背景层次清晰、整洁克制'},
 {id:'travel',label:'旅行目的地',keywords:['旅行','旅游','景区','城市','酒店','出行','攻略','风景'],prompt:'自然写实的旅行目的地环境，具有地域感的建筑或自然景观，远景虚化，光线真实自然'},
 {id:'food',label:'餐饮美食空间',keywords:['美食','餐饮','餐厅','菜','烹饪','食材','咖啡'],prompt:'自然写实的餐饮空间，温暖侧光、整洁的桌面和轻微景深，画面真实有生活气息'},
 {id:'home',label:'生活家居空间',keywords:['家居','家庭','育儿','生活','装修','收纳','日常'],prompt:'自然写实的舒适家居空间，柔和自然光、浅色材质和少量生活物件，避免杂乱'}
];
const DEFAULT={id:'neutral',label:'自然写实讲解空间',prompt:'自然写实的简洁讲解空间，浅色墙面、柔和窗光、少量绿植和木质材质，背景干净且有真实空间层次'};
const ENGLISH_SCENES={business:'a modern quiet office interior, large windows, soft daylight, neutral gray and light wood',finance:'a realistic financial news studio, muted navy and warm gray, distant abstract unbranded data panels without readable text',space:'a realistic aerospace science exhibition hall, distant abstract rocket and satellite exhibits, cool white and soft blue ambient light',health:'a bright calm wellness interior with light walls, wood furniture and a few plants',education:'a quiet study room with bookshelves, a wooden desk and soft window light',travel:'a realistic scenic travel environment with distant architecture and landscape',food:'a realistic tidy restaurant interior with warm side lighting',home:'a comfortable realistic living room with soft daylight, light materials and few objects',neutral:'a clean realistic presentation room with light walls, soft window light, subtle plants and wood materials'};
const NEGATIVE='人物、脸、身体、手、人体残影、文字、字幕、Logo、水印、品牌标识、可读屏幕文字、拼贴、分屏、边框、过度虚化、塑料质感、卡通、畸变、低清晰度';
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
const sha256=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
function sourceText(input={}){return normalize(input.finalText||'');}
function extractContentTheme(input={}){
 const text=sourceText(input),lower=text.toLowerCase();
 // 较长且具体的主题词优先于商业、企业这类宽泛词；结果只用于提供可修改方案。
 const matches=SCENES.map(scene=>({scene,score:scene.keywords.reduce((sum,key)=>sum+(text.includes(key)||lower.includes(key.toLowerCase())?key.length**2:0),0)})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
 const primary=matches[0]?.scene||DEFAULT, tags=[...new Set(matches.slice(0,3).map(row=>row.scene.id))];
 return {sourceText:text,sourceHash:sha256(text),primary:{id:primary.id,label:primary.label},tags,matchedKeywords:matches.slice(0,3).flatMap(row=>row.scene.keywords.filter(key=>text.includes(key))),matchScore:matches[0]?.score||0,method:'deterministic-keyword-v1'};
}
function buildNaturalBackgroundPrompt(input={}){
 const theme=input.theme||extractContentTheme(input),scene=SCENES.find(row=>row.id===theme.primary?.id)||DEFAULT,variant=input.variant||'wide';
 const aspect=input.aspect||'9:16',shape=aspect==='16:9'?'横屏16:9':aspect==='1:1'?'方形1:1':aspect==='4:3'?'横屏4:3':aspect==='3:4'?'竖屏3:4':'竖屏9:16';
 // 正向构图只描述空场景；提及后续讲解者可能诱导纯文生图模型额外生成人物。
 const framing={wide:`${shape}的中远景，空旷的中央地面和两侧展陈，左右保持干净留白`,depth:`${shape}的中景，空间有前中后景层次，中心区域低对比度`,light:`${shape}的中景，柔和侧光和自然阴影，中央空旷区域照明均匀且不出现强反光`}[variant]||`${shape}的自然写实中景`;
 const prompt=[scene.prompt,framing,'空场景环境摄影，整个空间空无一人。真实透视、自然材质、轻微景深。中央前景完整空旷，无前景遮挡物。',`Architectural interior photography of ${ENGLISH_SCENES[scene.id]||ENGLISH_SCENES.neutral}. A completely vacant, unoccupied environment. Empty central floor, exhibits arranged only along the sides, architectural photography before opening hours. No people, no faces, no human body, no text, no readable signs, no logos. Natural perspective, believable materials, subdued contrast, soft realistic light. Symbolic fictional environment, not a documentary photo of a named institution or real site.`].join('。')+'。';
 return {prompt,negativePrompt:NEGATIVE,theme,variant,sourceHash:theme.sourceHash,aspect:input.aspect||'9:16',engineHint:'story-image'};
}
function buildBackgroundCandidates(input={}){
 const theme=extractContentTheme(input);if(!theme.sourceText)throw Error('请先确认文案后再生成内容背景');if(typeof input.avatarId!=='string'||!input.avatarId.trim())throw Error('生成内容背景需要绑定原人物形象');
 const variants=['wide','depth','light'];return variants.map((variant,index)=>{const built=buildNaturalBackgroundPrompt({...input,theme,variant});return {...built,id:`background-${index+1}`,avatarId:input.avatarId,label:`${theme.primary.label}·${variant==='wide'?'开阔':variant==='depth'?'层次':'柔光'}`,rank:index+1,source:{kind:'confirmed-finalText',sourceTextHash:theme.sourceHash,avatarId:input.avatarId,prompt:built.prompt,negativePrompt:built.negativePrompt,engineHint:built.engineHint}};});
}
function validateBackgroundSelection(selection,theme){if(!selection||typeof selection.assetId!=='string'||!selection.assetId.trim())throw Error('请选择已生成的背景候选');if(selection.sourceHash!==theme.sourceHash)throw Error('文案已变化，请重新生成背景候选');return {assetId:selection.assetId,sourceHash:selection.sourceHash};}
const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const objectHash=value=>sha256(JSON.stringify(value));
class AvatarBackground{
 constructor({store,media,providers,generator}){this.store=store;this.generator=generator||new(require('./story-generator.cjs').StoryGenerator)(store,media,providers);}
 snapshot({id,avatarId}){
  const draft=this.store.draft(id),text=draft.finalText;
  if(!draft.confirmed||typeof text!=='string'||!text.trim())throw Error('请先确认文案后再生成内容背景');
  const avatar=this.store.data.avatars.find(row=>row.id===avatarId);if(!avatar)throw Error('请选择有效的原人物形象');
  const source=this.store.asset(avatar.assetId);if(source.type!=='video')throw Error('所选人物没有有效视频素材');
  return {kind:'avatar-content-background-v1',draftId:draft.id,avatarId,avatarHash:objectHash(avatar),sourceAssetId:source.id,sourceVideoSha256:fileHash(source.path),sourceHash:sha256(text),sourceTextHash:sha256(text),finalText:text};
 }
 current(snapshot){try{return objectHash(this.snapshot({id:snapshot.draftId,avatarId:snapshot.avatarId}))===objectHash(snapshot);}catch{return false;}}
 plan(input){const snapshot=this.snapshot(input),rows=buildBackgroundCandidates({avatarId:snapshot.avatarId,finalText:snapshot.finalText,aspect:input.aspect||'9:16'});return {source:snapshot,candidates:rows.map(row=>({...row,sourceHash:snapshot.sourceHash,source:{...row.source,sourceTextHash:snapshot.sourceHash}}))};}
 async generate(input,ctx={}){
  ctx.signal?.throwIfAborted();const plan=this.plan(input),candidate=plan.candidates.find(row=>row.id===input.candidateId);if(!candidate)throw Error('请选择当前文案的背景方案');
  const protocol=this.generator.config?.().storyImageProtocol||this.store.data.settings?.provider?.storyImageProtocol||'comfy';if(protocol!=='comfy')throw Error('文案背景本批只支持本地ComfyUI图片模型，请切换本地协议后重试');
  if(input.sourceHash!==plan.source.sourceHash)throw Error('文案已变化，请重新获取背景方案');
  const instruction=input.instruction===undefined?'':input.instruction;if(typeof instruction!=='string'||instruction.length>4000)throw Error('背景补充要求需在4000字以内');
  // 提示词是可追溯的生成输入；真实画面仍须用户预览，不能把提示词要求等同于模型保证。
  const prompt=[candidate.prompt,instruction?`用户补充的背景环境要求：${instruction}`:'',`排除内容：${NEGATIVE}`].filter(Boolean).join('\n');
  const target={kind:'avatar-content-background-v1',source:plan.source,candidateId:candidate.id,label:candidate.label,prompt,negativePrompt:NEGATIVE,instruction,qualityAccepted:false};
  const generationInput={draftId:plan.source.draftId,aspect:candidate.aspect,prompt,style:'自然写实摄影，真实透视和自然材质',instruction:'仅生成空场景，禁止人物、文字、水印、品牌及前景遮挡。中央地面保持空旷。',references:[],revision:0,target,inputHash:objectHash(target)};
  const asset=await this.generator.image(generationInput,ctx);return {asset,candidate:{...candidate,prompt},source:plan.source,stale:!this.current(plan.source),qualityAccepted:false};
 }
 async recover(run,ctx={}){
  const input=run.remote?.input,target=input?.target;if(target?.kind!=='avatar-content-background-v1')throw Error('该任务不是文案背景生成');
  const asset=await this.generator.recover(run,ctx);return {asset,source:target.source,candidate:{id:target.candidateId,label:target.label,prompt:target.prompt},stale:!this.current(target.source),qualityAccepted:false};
 }
 resolve({id,avatarId,assetId}){
  const asset=this.store.asset(assetId);if(asset.type!=='image')throw Error('人物背景必须为图片素材');
  const evidence=asset.storyGeneration?.target;if(evidence?.kind!=='avatar-content-background-v1')throw Error('所选图片不是生成的文案背景，请通过自选背景入口选用');
  if(evidence.source.draftId!==id||evidence.source.avatarId!==avatarId||!this.current(evidence.source))throw Error('文案、人物或源视频已变化，请重新生成或显式改为自选背景');
  return {asset,evidence,sha256:fileHash(asset.path)};
 }
}
module.exports={AvatarBackground,SCENES,NEGATIVE,sourceText,extractContentTheme,buildNaturalBackgroundPrompt,buildBackgroundCandidates,validateBackgroundSelection};
