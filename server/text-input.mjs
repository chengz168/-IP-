import {resolvePrompt,promptSnapshot,generationConfig} from './prompt-catalog.mjs';
import {downstreamText} from './story-source.mjs';
import {resolveCreativePreset} from './creative-presets.mjs';
// 前后端共用输入与写入目标快照，防止较早的生成结果覆盖新输入或手工编辑。
export function textInput(draft,kind,data){
 const template=resolvePrompt(kind,data,draft.template);
 const analysis=draft.brain?.analysis||data.brains.find(b=>b.id===draft.brain?.activeId)?.analysis||null;
 const fields=kind==='rewrite'?{sourceText:draft.sourceText,wordLimit:Number(draft.wordLimit),rewriteRequirements:String(draft.rewriteRequirements||''),analysis}:
  kind==='legal'?{rewrite:draft.rewrite}:
  kind==='translate'?{finalText:draft.finalText,language:draft.language}:
  kind==='title'?{text:downstreamText(draft)}:
  kind==='marketing'?{marketing:draft.marketing,wordLimit:Number(draft.wordLimit),analysis}:
  kind==='topic'?{topic:draft.topic,analysis}:null;
 if(!fields)throw Error('未知文案操作');
 const destination=kind==='rewrite'?{rewrite:draft.rewrite,finalText:draft.finalText,confirmed:draft.confirmed}:
  kind==='translate'?{finalText:draft.finalText}:
  kind==='title'?{title:draft.cover.title}:
  ['marketing','topic'].includes(kind)?{sourceText:draft.sourceText,confirmed:draft.confirmed}:null;
 const creativePreset=['rewrite','marketing','topic'].includes(kind)?resolveCreativePreset(draft,kind==='rewrite'?'rewrite':kind==='topic'?'topic':'script',{kind:kind==='rewrite'?'rewrite':kind,content:kind==='rewrite'?draft.sourceText:undefined}):null;
 return JSON.parse(JSON.stringify({id:draft.id,kind,fields,template:{selectedId:['rewrite','marketing','topic'].includes(kind)?draft.template:'',...promptSnapshot(template)},generation:generationConfig(data,template),destination,...(creativePreset?{creativePreset}:{})}));
}
export function textInputMatches(input,draft,kind,data){return !!input&&JSON.stringify(input)===JSON.stringify(textInput(draft,kind,data));}
