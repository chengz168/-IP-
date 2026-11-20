const storyRunTypes=['story-split-episodes','story-split-shots','story-extract-assets','story-image','story-video','story-compose'];
const {activeStoryEpisode}=require('./story-source.mjs');
function selectedStoryEpisode(draft){return draft.story?.episodes?.find(item=>item.id===draft.story.activeEpisodeId)||null;}
function usesUpstreamNarration(draft){const episode=selectedStoryEpisode(draft);return (draft.video?.mode==='story'||draft.video?.mode==='product'&&draft.story?.productIntroduction)&&draft.story?.narrationMode==='upstream'&&(!episode?.narrationAssetId||!!draft.story?.productIntroduction);}
// 下游只读取已交接的当前集，分集文案不覆盖前面已经确认的完整剧本。
function downstreamDraft(draft){
 const episode=activeStoryEpisode(draft);
 return episode?{...structuredClone(draft),finalText:episode.text,rewrite:episode.text,sourceText:episode.text}:draft;
}
function invalidateStoryHandoff(before,next){
 if(!before.story)return;
 const old=selectedStoryEpisode(before);
 if(!old?.resultId)return;
 const episode=next.story?.episodes?.find(item=>item.id===old.id);
 const sourceChanged=next.story?.sourceMode!=='custom'&&(!next.confirmed||next.finalText!==next.story.sourceText);
 const narrationChanged=usesUpstreamNarration(next)&&before.voice.audioId!==next.voice.audioId;
 const modeChanged=before.video.mode!==next.video.mode&&(before.video.mode==='story'||before.video.mode==='product'&&before.story.productIntroduction);
 if(!sourceChanged&&!narrationChanged&&!modeChanged&&episode?.resultId===old.resultId&&episode?.resultInputHash===old.resultInputHash)return;
 // 归档字幕由Store统一处理；清除所有与旧单集派生物相关的引用，文件仍留在素材库。
 if(next.video.assetId===old.resultId)next.video.assetId='';
 if(next.edit.sourceId===old.resultId)next.edit.sourceId='';
 next.edit.resultId='';next.cover.assetId='';next.cover.videoId='';next.publish.videoId='';next.publish.coverId='';next.publish.recordId='';
 if((sourceChanged||narrationChanged)&&episode){episode.resultId='';episode.resultInputHash='';episode.resultNarrationAssetId='';if(sourceChanged)next.story.activeEpisodeId='';}
}
module.exports={storyRunTypes,activeStoryEpisode,downstreamDraft,invalidateStoryHandoff,usesUpstreamNarration};
