export function activeStoryEpisode(draft){
 const story=draft.story;
 if(!(draft.video?.mode==='story'||draft.video?.mode==='product'&&story?.productIntroduction)||!story?.activeEpisodeId)return null;
 const episode=story.episodes?.find(item=>item.id===story.activeEpisodeId);
 if(!episode?.resultId||!episode.resultInputHash||draft.video.assetId!==episode.resultId||draft.edit?.sourceId&&draft.edit.sourceId!==episode.resultId)return null;
 if(story.sourceMode!=='custom'&&(!draft.confirmed||draft.finalText!==story.sourceText))return null;
 if(episode.resultNarrationAssetId!==undefined){const narrationId=story.narrationMode==='upstream'?(episode.narrationAssetId||(story.episodes.length===1?draft.voice?.audioId:'')||''):'';if(narrationId!==episode.resultNarrationAssetId)return null;}
 return episode;
}
export function downstreamText(draft){return activeStoryEpisode(draft)?.text||draft.finalText||draft.rewrite||draft.sourceText||'';}
