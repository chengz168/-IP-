import {activeStoryEpisode} from './story-source.mjs';

const sourceId = draft => draft.edit?.sourceId || draft.video?.assetId || '';
const assetList = data => Array.isArray(data) ? data : data?.assets || [];

// 冻结正文和媒体凭据；界面切换、封面修改不会让识别失效。
export function subtitleReferenceInput(draft, data = []) {
  const assets = assetList(data), source = assets.find(item => item.id === sourceId(draft));
  const audioId = source?.avatarRequest?.audio?.assetId || source?.productVideo?.audioId || source?.storyGeneration?.narrationAssetId || '';
  const audio = assets.find(item => item.id === audioId);
  const episode = activeStoryEpisode(draft);
  return {
    sourceId: sourceId(draft), confirmed: draft.confirmed === true,
    finalText: String(draft.finalText || ''),
    episode: episode ? {id: episode.id, text: episode.text, resultId: episode.resultId, resultInputHash: episode.resultInputHash, narrationAssetId: episode.resultNarrationAssetId || ''} : null,
    audioId, speechRequest: audio?.speech?.request || null
  };
}

// 已交接单集优先；整稿必须已确认，且当前视频实际使用的配音有相同正文摘要。
export function trustedSubtitleReference(draft, data, sha256) {
  const input = subtitleReferenceInput(draft, data);
  if (input.episode?.text?.trim()) return {kind: 'story-episode', episodeId: input.episode.id, sourceId: input.sourceId, resultInputHash: input.episode.resultInputHash, text: input.episode.text};
  if (!input.confirmed || !input.finalText.trim() || !input.sourceId || !input.audioId || typeof sha256 !== 'function') return null;
  const textSha256 = sha256(input.finalText);
  if (input.speechRequest?.textSha256 !== textSha256 || input.speechRequest.textLength !== input.finalText.length) return null;
  return {kind: 'finalText', sourceId: input.sourceId, audioId: input.audioId, textSha256, text: input.finalText};
}
