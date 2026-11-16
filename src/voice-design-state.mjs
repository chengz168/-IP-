// 最新尝试负责错误和停止；成功候选单独保留，不能被后续取消或失败隐藏。
export function voiceDesignState(state,taskId){
 const runs=(state?.runs||[]).filter(run=>run.type==='voice-design'&&run.draftId===taskId),assets=state?.assets||[];
 const latest=runs[0]||null;
 for(const run of runs){
  if(run.status!=='succeeded'||typeof run.parameters?.job?.text!=='string'||typeof run.parameters?.job?.instruct!=='string')continue;
  const candidate=assets.find(asset=>asset.id===run.output?.assetId&&asset.type==='audio'&&asset.origin==='qwen-voice-design');
  if(candidate)return {latest,candidateRun:run,candidate};
 }
 return {latest,candidateRun:null,candidate:null};
}

export function voiceDesignMatches(run,text,instruct){
 return !!run&&run.parameters?.job?.text===text&&run.parameters?.job?.instruct===instruct;
}
