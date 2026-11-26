// 候选重选遵循生成时的完整预设；已确认图片作参考时沿用现有输入契约。
// 此函数只判断已有凭据，不改历史状态、不补写版本，也不代替媒体与文件校验。
export function storyCandidateIssue(candidate,{inputHash,preset,purpose='selection',requireReady=false}={}){
 if(!candidate)return 'missing';
 if(candidate.status==='stale'||requireReady&&candidate.status!=='ready')return 'stale';
 if(inputHash!==undefined&&candidate.inputHash!==inputHash)return 'input';
 if(purpose!=='reference'&&candidate.creativePreset&&preset&&JSON.stringify(candidate.creativePreset)!==JSON.stringify(preset))return 'preset';
 return '';
}
