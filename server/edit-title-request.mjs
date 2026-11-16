// 来源为原版951标题函数及423语言模块的只读静态契约，不执行原厂代码。
import {activeStoryEpisode} from './story-source.mjs';
const languages={zh:'中文',en:'英语',ar:'阿拉伯语',my:'缅甸语',da:'丹麦语',nl:'荷兰语',fi:'芬兰语',fr:'法语',de:'德语',el:'希腊语',he:'希伯来语',hi:'印地语',id:'印尼语',it:'意大利语',ja:'日语',km:'高棉语',ko:'韩语',lo:'老挝语',ms:'马来语',no:'挪威语',pl:'波兰语',pt:'葡萄牙语',ru:'俄语',es:'西班牙语',sw:'斯瓦希里语',sv:'瑞典语',tl:'他加禄语',th:'泰语',tr:'土耳其语',vi:'越南语','zh-SC':'四川话','zh-HK':'粤语','zh-WU':'吴语','zh-DB':'东北话','zh-HA':'河南话','zh-SX':'陕西话','zh-SD':'山东话','zh-TJ':'天津话','zh-MN':'闽南话'};
const clean=value=>typeof value==='string'?value.trim():'';
export function editTitleLanguage(draft){const value=clean(draft.language)||'zh';return languages[value]||languages[value.split('-')[0]]||value;}
export function editTitleText(draft){
 const episode=activeStoryEpisode(draft);if(episode?.text?.trim())return episode.text.trim();
 for(const key of ['finalText','rewrite','sourceText']){const text=clean(draft[key]);if(text)return text;}
 return (Array.isArray(draft.edit?.captions)?draft.edit.captions:[]).map(row=>clean(row?.text||row?.content)).filter(Boolean).join('\n');
}
export const editTitleVideo=draft=>clean(draft.edit?.sourceId)||clean(draft.video?.assetId);
export const canGenerateEditTitle=draft=>!!editTitleVideo(draft)&&!!editTitleText(draft);
export function editTitlePrompt(draft){
 const language=editTitleLanguage(draft),text=editTitleText(draft);
 return '请根据视频文案生成新版灵动剪辑画面上方的双行标题。\n\n要求：\n'+`目标语言：${language}\n标题内容都必须使用${language}。\n返回格式的字段名仍使用中文，字段值使用目标语言。`+'\n主标题：4-8 个字，强钩子，适合画面大标题\n副标题：4-8 个字，补充信息、悬念、收益点\n标题要短促，适合视频顶部单行展示\n不要使用书名号、引号、句号，不要解释\n\n视频文案：\n'+text+'\n\n只输出：\n主标题：xxx\n副标题：xxx';
}
export const editTitleSignature=d=>JSON.stringify({id:d.id,text:editTitleText(d),source:editTitleVideo(d),language:editTitleLanguage(d),title:d.edit?.title,subtitle:d.edit?.subtitle});
