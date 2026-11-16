import {resolvePrompt,promptSnapshot,generationConfig} from './prompt-catalog.mjs';
// 页面和服务使用同一份输入快照，避免模板或字数变化后沿用旧候选。
export function copyInput(draft,kind,data,copies=false){
 const template=resolvePrompt(kind,data,draft.template);
 const analysis=draft.brain?.analysis||data.brains.find(b=>b.id===draft.brain?.activeId)?.analysis||null;
 const fields=kind==='topic'?Object.fromEntries(['industry','persona','audience','bio'].map(k=>[k,draft.topic?.[k]||''])):Object.fromEntries(['name','audience','selling','persona','offer'].map(k=>[k,draft.marketing?.[k]||'']));
 return {kind,fields,template:promptSnapshot(template),generation:generationConfig(data,template),analysis:analysis?JSON.parse(JSON.stringify(analysis)):null,...(copies?{wordLimit:Number(draft.wordLimit)}:{})};
}
export function copyInputMatches(batch,draft,kind,data,copies=false){return !!batch&&JSON.stringify(batch.input)===JSON.stringify(copyInput(draft,kind,data,copies));}
