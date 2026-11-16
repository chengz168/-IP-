// 原稿与改写稿的选择规则由界面和主进程共用，空白改写稿不会遮住有效原稿。
export function copyCandidate(draft){
 const rewrite=typeof draft.rewrite==='string'?draft.rewrite:'',source=typeof draft.sourceText==='string'?draft.sourceText:'';
 return rewrite.trim()?rewrite:source;
}

export function confirmationInput(draft){
 return {id:draft.id,sourceText:draft.sourceText,rewrite:draft.rewrite,finalText:draft.finalText,confirmed:!!draft.confirmed};
}

export function confirmationMatches(input,draft){
 return !!input&&Object.keys(confirmationInput(draft)).every(key=>input[key]===confirmationInput(draft)[key]);
}

export function copySourceChanged(before,next){return before.sourceText!==next.sourceText||before.rewrite!==next.rewrite;}
