// 仅对已核实并切换生成规则的模板失效旧成片，不改写历史任务或文件。
export const nativeSubtitleFontFiles=Object.freeze({
 simple_yellow_white:'江城律动宋.ttf',
 simple_blue_white:'喜脉体.ttf',
 simple_brown_white:'思源宋体.ttf',
 scrolling_3lines:'方正粗黑宋简体.ttf',
 scrolling_4lines:'方正粗黑宋简体.ttf',
 '3d_flip':'月星楷.ttf',
 purple_slide:'方正粗黑宋简体.ttf',
 red_yellow:'方正粗黑宋简体.ttf',
 red_blue_science:'三极行楷简体.ttf',
 yellow_white_split:'东方大楷.ttf',
 yellow_white_italic:'江城斜黑体.ttf',
 yellow_white_calligraphy:'三极行楷简体.ttf',
 yellow_white_bounce:'思源宋体.ttf',
 yellow_box_white:'黑体.ttf',
 white_pinyin:'江西拙楷.ttf',
 variety_wave:'荆南波波黑.ttf',
 cartoon_yellow:'荆南波波黑.ttf',
 energy_pink_yellow:'小石头体.ttf',
 cute_pink:'小石头体.ttf',
 black_white_bilingual:'方正书宋简体.ttf',
 yellow_white_bilingual:'月星楷.ttf',
 red_white_bilingual:'方正书宋简体.ttf',
});
export const simpleSubtitleIds=['simple_yellow_white','simple_blue_white','simple_brown_white'];
export const subtitlePreviewCount=id=>id==='3d_flip'?9:id==='red_yellow'?7:['red_blue_science','cartoon_yellow','cute_pink'].includes(id)?5:id==='yellow_white_italic'?10:id==='black_white_bilingual'?2:['yellow_white_split','yellow_white_calligraphy','yellow_box_white','variety_wave','yellow_white_bilingual','red_white_bilingual'].includes(id)?4:6;
export const subtitleEngineVersion=id=>id==='white_pinyin'?3:Object.hasOwn(nativeSubtitleFontFiles,id)?2:1;
export function subtitleOutputCurrent(draft,asset){
 const edit=draft?.edit;
 if(!edit?.subtitlesEnabled||edit.subtitleMode!=='template'||subtitleEngineVersion(edit.subtitleTemplate)===1)return true;
 return asset?.renderedSubtitleTemplate?.templateId===edit.subtitleTemplate&&Number(asset.renderedSubtitleTemplate.engineVersion)>=subtitleEngineVersion(edit.subtitleTemplate);
}
