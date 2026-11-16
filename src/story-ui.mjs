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

export function storyShotProblems(shot,assets,{video=false,imageProtocol}={}){
  if(!shot)return ['请先选择一个镜头'];
  const reasons=[];
  if(!shot.assetIds?.length)reasons.push('镜头尚未绑定人物、场景或道具资产');
  for(const id of shot.assetIds||[]){const asset=assets.find(item=>item.id===id);if(!asset)reasons.push('存在已移除的资产绑定');else if(!asset.selectedImageId)reasons.push('资产“'+asset.name+'”尚未确认图片');}
  if(!video&&imageProtocol==='comfy'&&shot.assetIds?.length>1&&!storyPrimaryReferenceId(shot))reasons.push('请在分集分镜的资产绑定区选择本地构图主参考');
  if(video&&!shot.selectedImageId)reasons.push('请先生成或导入镜头构图图，并确认选用');
  return [...new Set(reasons)];
}

export function createStoryShot(){return{id:crypto.randomUUID(),text:'',visual:'',action:'',camera:'',sound:'',duration:5,assetIds:[],primaryReferenceAssetId:'',imagePrompt:'',videoPrompt:'',images:[],selectedImageId:'',videos:[],selectedVideoId:''};}

export function createStoryAsset(kind='character'){return{id:crypto.randomUUID(),kind,name:kind==='scene'?'新场景':kind==='prop'?'新道具':'新人物',description:'',prompt:'',images:[],selectedImageId:''};}

export const storyKindLabel={character:'人物',scene:'场景',prop:'道具'};
