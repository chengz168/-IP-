const copy=value=>JSON.parse(JSON.stringify(value));
// 按任务保留尚未保存的界面编辑，版本冲突时不把旧编辑静默丢弃。
export const storyUiDrafts=new Map();

export async function storyEpisodeFingerprint(story){const bytes=new TextEncoder().encode(JSON.stringify([story.sourceText,story.episodeCount,story.episodeDuration]));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');}

export function upstreamStoryText(draft){return String(draft?.finalText||draft?.rewrite||draft?.sourceText||'');}

export function storyEditorValue(draft){
  const saved=draft?.story||{};
  return copy({version:1,revision:0,sourceMode:'upstream',sourceText:upstreamStoryText(draft),episodeCount:1,episodeDuration:30,aspect:'9:16',style:'自然写实',instructions:'',narrationMode:'none',episodes:[],assets:[],...saved});
}

// 单资产可直接作为本地主参考；多资产必须显式选择仍在绑定中的资产。
export function storyPrimaryReferenceId(shot){
  const ids=shot?.assetIds||[];
  return ids.includes(shot?.primaryReferenceAssetId)?shot.primaryReferenceAssetId:ids.length===1?ids[0]:'';
}

// 控制项不支持时明确阻止提交，避免界面看似生效而服务实际忽略。
export function storyVideoControlProblems(shot,protocol='comfy-h3'){
  if(!shot)return [];
  const reasons=[];
  if(shot.videoSeed!==undefined&&shot.videoSeed!==null&&(!Number.isSafeInteger(shot.videoSeed)||shot.videoSeed<0||shot.videoSeed>4294967295))reasons.push('固定种子请输入0至4294967295的整数，留空则随机');
  if(protocol!=='comfy-h3'&&(shot.lastFrameId||shot.videoSeed!==undefined&&shot.videoSeed!==null))reasons.push('尾帧和固定种子目前仅支持本地H3；请清除控制项或切换本地模型');
  return reasons;
}

export function storyShotProblems(shot,assets,{video=false,imageProtocol,imageArchitecture}={}){
  if(!shot)return ['请先选择一个镜头'];
  const reasons=[];
  if(!shot.assetIds?.length)reasons.push('镜头尚未绑定人物、场景或道具资产');
  for(const id of shot.assetIds||[]){const asset=assets.find(item=>item.id===id);if(!asset)reasons.push('存在已移除的资产绑定');else if(!asset.selectedImageId)reasons.push('资产“'+asset.name+'”尚未确认图片');}
  if(!video&&imageProtocol==='comfy'&&imageArchitecture==='z-image-turbo'&&shot.assetIds?.length)reasons.push('Z-Image 仅支持纯文生图，不能使用已绑定参考；请选用已有首帧，或在服务设置切换支持参考的模型');
  else if(!video&&imageProtocol==='comfy'&&shot.assetIds?.length>1&&!storyPrimaryReferenceId(shot))reasons.push('请选择本地构图主参考');
  if(video&&!shot.selectedImageId)reasons.push('请先生成或导入镜头构图图，并确认选用');
  return [...new Set(reasons)];
}

export function createStoryShot(){return{id:crypto.randomUUID(),text:'',visual:'',action:'',camera:'',sound:'',duration:5,assetIds:[],primaryReferenceAssetId:'',imagePrompt:'',videoPrompt:'',images:[],selectedImageId:'',videos:[],selectedVideoId:''};}

export function createStoryAsset(kind='character'){return{id:crypto.randomUUID(),kind,name:kind==='scene'?'新场景':kind==='prop'?'新道具':'新人物',description:'',prompt:'',images:[],selectedImageId:''};}

export const storyKindLabel={character:'人物',scene:'场景',prop:'道具'};

// 进度只读取本集绑定及明确选用结果，不把生成候选或非空 ID 当成人工确认。
export function storySelectedCandidate(node,kind='image',media){
  const id=kind==='video'?node?.selectedVideoId:node?.selectedImageId,list=kind==='video'?node?.videos:node?.images;
  return !!id&&!!list?.some(item=>item.id===id&&item.status==='ready')&&(!media||media.some(item=>item.id===id&&item.type===kind));
}

export function storyEpisodeAssets(story,episode){
  const ids=new Set((episode?.shots||[]).flatMap(item=>item.assetIds||[]));
  return (story?.assets||[]).filter(item=>ids.has(item.id));
}

export function storyVersionConflict(error){return /创作内容已更新，请刷新后再保存|版本冲突|版本不一致/.test(String(error?.message??error??''));}

// 勾选范围独立于详情查看，提交前再次与当前筛选取交集，避免隐藏项被一起提交。
export function storyScopedSelection(ids,items){const selected=new Set(ids||[]);return (items||[]).filter(item=>selected.has(item.id)).map(item=>item.id);}
export function storyAssetNeedsGeneration(asset){return !asset?.selectedImageId&&!asset?.images?.some(item=>item.status==='ready');}
export function storyBatchStatusLabel(status){return {queued:'等待生成',running:'正在生成',succeeded:'已生成候选，待确认',failed:'生成失败',unknown:'结果待确认，请查原任务',cancelled:'已停止',skipped:'未提交'}[status]||status||'状态未提供';}
export function storyBatchSummary(run){
  if(!run)return {items:[],counts:{total:0,finished:0,succeeded:0,failed:0,unknown:0,skipped:0,cancelled:0},active:false,uncertain:false};
  const active=['running','queued'].includes(run.status),items=!active&&run.output?.items?run.output.items:run.parameters?.batchItems||run.batchItems||run.output?.items||[],ids=run.parameters?.batchAssetIds||[],counts={total:Math.max(ids.length,items.length),finished:0,succeeded:0,failed:0,unknown:0,skipped:0,cancelled:0};
  for(const item of items)if(['succeeded','failed','unknown','skipped','cancelled'].includes(item.status)){counts[item.status]++;counts.finished++;}
  return {items,counts,active,uncertain:run.status==='unknown'||counts.unknown>0};
}

export function storyEpisodeProgress(story,episode,options={}){
  const shots=episode?.shots||[],assets=storyEpisodeAssets(story,episode),media=options.media;
  const assetReady=assets.filter(item=>storySelectedCandidate(item,'image',media)),frameReady=shots.filter(item=>storySelectedCandidate(item,'image',media)),videoReady=shots.filter(item=>storySelectedCandidate(item,'video',media));
  const missingBinding=shots.find(item=>!item.assetIds?.length||item.assetIds.some(id=>!(story.assets||[]).some(asset=>asset.id===id)));
  const counts={shots:shots.length,assets:assets.length,assetsReady:assetReady.length,framesReady:frameReady.length,videosReady:videoReady.length};
  const stages=[
    {id:'shots',label:'分镜',detail:shots.length+' 个镜头',done:!!shots.length,tab:'episodes'},
    {id:'assets',label:'资产确认',detail:assetReady.length+' / '+assets.length+' 项',done:!!shots.length&&!missingBinding&&assetReady.length===assets.length,tab:'assets'},
    {id:'frames',label:'首帧确认',detail:frameReady.length+' / '+shots.length+' 镜头',done:!!shots.length&&frameReady.length===shots.length,tab:'videos'},
    {id:'videos',label:'视频确认',detail:videoReady.length+' / '+shots.length+' 镜头',done:!!shots.length&&videoReady.length===shots.length,tab:'videos'},
    {id:'compose',label:'合成',detail:episode?.resultId?'已有成片，待检查':'待合成',done:!!episode?.resultId,tab:'videos'}
  ];
  const target=(tab,extra={})=>({tab,episodeId:episode?.id||'',...extra});
  let next;
  if(options.sourceChanged)next={stage:'shots',label:'检查来源并重新拆集',reason:'当前来源尚未确认或已变化，请先核对来源。',target:target('episodes',{section:'source'})};
  else if(!episode)next={stage:'shots',label:'前往指定集数拆集',reason:'先填写剧本与集数，再逐集制作。',target:target('episodes',{section:'source'})};
  else if(!shots.length)next={stage:'shots',label:'前往拆分本集镜头',reason:'本集尚无分镜，拆分后再提取资产。',target:target('episodes',{section:'episode'})};
  else if(missingBinding)next={stage:'assets',label:'检查镜头资产绑定',reason:'本集存在未绑定或引用缺失资产的镜头。',target:target('videos',{shotId:missingBinding.id,section:'bindings'})};
  else if(assetReady.length<assets.length){const asset=assets.find(item=>!storySelectedCandidate(item,'image',media));next={stage:'assets',label:'确认资产：'+asset.name,reason:asset.images?.some(item=>item.status==='ready')?'已有图片候选，请预览并明确选用。':'先生成或导入资产图片，再预览确认。',target:target('assets',{assetId:asset.id,section:'asset'})};}
  else if(frameReady.length<shots.length){const shot=shots.find(item=>!storySelectedCandidate(item,'image',media));next={stage:'frames',label:'确认镜头 '+(shots.indexOf(shot)+1)+' 首帧',reason:shot.images?.some(item=>item.status==='ready')?'首帧已有候选，预览确认后才能生成视频。':'先生成或选用本镜头首帧。',target:target('videos',{shotId:shot.id,section:'frame'})};}
  else if(videoReady.length<shots.length){const shot=shots.find(item=>!storySelectedCandidate(item,'video',media));next={stage:'videos',label:'确认镜头 '+(shots.indexOf(shot)+1)+' 视频',reason:shot.videos?.some(item=>item.status==='ready')?'已有视频候选，请完整预览后选用。':'使用已确认首帧生成本镜头动态视频。',target:target('videos',{shotId:shot.id,section:'motion'})};}
  else if(options.narrationMissing)next={stage:'compose',label:'选择本集旁白',reason:'当前旁白方式需要本集音频，多集请逐集指定。',target:target('videos',{section:'composition'})};
  else next={stage:'compose',label:episode.resultId?'检查当前集成片':'前往合成当前集',reason:episode.resultId?'请检查完整播放、声音与镜头连续性，再交接剪辑。':'各镜头已明确选用，合成前仍由后台核对有效性。',target:target('videos',{section:'composition'})};
  if(options.sourceChanged)for(const stage of stages)stage.done=false;
  return {counts,stages,next};
}
