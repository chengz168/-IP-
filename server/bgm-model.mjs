export function bgmSelection(edit={}){
 const source=['system','upload'].includes(edit.bgmSource)?edit.bgmSource:edit.bgmId?'upload':'system';
 return {source,resourceId:source==='system'?edit.bgmResourceId||'':'',assetId:edit.bgmId||'',auto:source==='system'&&!edit.bgmResourceId&&!edit.bgmId};
}
export function bgmSummary(edit={},assets=[]){
 if(!edit.bgmEnabled)return '已关闭';
 const selection=bgmSelection(edit);if(selection.auto)return 'AI 自动匹配';
 return assets.find(asset=>asset.id===selection.assetId)?.name||(selection.source==='upload'?'本地上传':'系统音乐库');
}
export function bgmText(draft){return String(draft.finalText?.trim()?draft.finalText:draft.rewrite?.trim()?draft.rewrite:(draft.edit.captions||[]).map(row=>row.text).join('\n')).trim();}
export function bgmSignature(draft){const edit=draft.edit,selection=bgmSelection(edit);return JSON.stringify({enabled:!!edit.bgmEnabled,source:draft.edit.sourceId||draft.video.assetId,selection,volume:edit.bgmVolume,text:selection.auto?bgmText(draft):''});}
