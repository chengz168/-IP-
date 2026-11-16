// 旧成片保留为历史；自定义标题更换排版版本后，必须重新剪辑才能复用。
export function titleOutputCurrent(draft,asset){
 const edit=draft?.edit;
 if(!edit?.titleEnabled||edit.titleDesign?.mode!=='custom'||!(edit.title?.trim()||edit.subtitle?.trim()))return true;
 return Number(asset?.renderedTitle?.version||0)>=3;
}
