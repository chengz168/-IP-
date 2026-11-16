import {titleOutputCurrent} from '../server/title-output.mjs';
import {subtitleOutputCurrent} from '../server/subtitle-output.mjs';
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export const editSource=draft=>draft?.edit?.sourceId||draft?.video?.assetId||'';
export const editPreviewSignature=draft=>stable({source:editSource(draft),edit:{...draft.edit,resultId:undefined}});

// 历史视频只供对照，不回填resultId，也不改变制作就绪状态。
export function editPreviewResult(state,draft){
  const source=editSource(draft),assets=state?.assets||[],saved=state?.drafts?.find(item=>item.id===draft.id);
  const available=id=>assets.find(asset=>asset.id===id&&asset.type==='video'&&asset.size>0);
  const current=available(draft.edit.resultId);
  const history=(state?.runs||[]).filter(run=>run.draftId===draft.id&&run.type==='render'&&run.status==='succeeded'&&run.snapshot&&available(run.output?.id));
  const runs=history.filter(run=>editSource(run.snapshot)===source).sort((a,b)=>(Date.parse(b.endedAt||b.createdAt)||0)-(Date.parse(a.endedAt||a.createdAt)||0));
  if(current){
    const run=history.find(item=>item.output.id===current.id),basis=run?.snapshot||(saved?.edit.resultId===current.id?saved:null);
    const outdated=!titleOutputCurrent(draft,current)||!subtitleOutputCurrent(draft,current);
    if(!basis||editSource(basis)===source)return {asset:current,dirty:outdated||!!basis&&editPreviewSignature(basis)!==editPreviewSignature(draft),runId:run?.id||''};
  }
  if(!source||!runs.length)return {asset:null,dirty:false,runId:''};
  return {asset:available(runs[0].output.id),dirty:true,runId:runs[0].id};
}
