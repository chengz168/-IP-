const labels={'brain-topics':'选题','brain-copies':'文案'};

// 仅关联当前草稿和档案，避免其他任务或历史结果误显示为本次进度。
export function brainGenerationProgress({runs=[],draftId,brainId,pending}){
 if(!draftId||!brainId)return null;
 const local=pending?.draftId===draftId&&pending?.brainId===brainId&&labels[pending.type]?pending:null;
 const matching=runs.filter(run=>run.draftId===draftId&&run.parameters?.brainId===brainId&&labels[run.type]&&(!local||(run.type===local.type&&Date.parse(run.createdAt)>=local.startedAt)));
 const run=matching.filter(run=>local||run.status==='running').sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0];
 if(!run&&!local)return null;
 if(run&&['failed','cancelled','interrupted','unknown'].includes(run.status))return null;
 const type=local?.type||run.type,name=labels[type];
 let label=!run?`正在准备${name}生成…`:run.cancelRequestedAt?'正在停止生成…':run.status==='succeeded'?'正在读取生成结果…':type==='brain-topics'?'正在生成 5 个选题…':'正在生成 3 条文案…';
 const value=run?.status==='running'&&!run.cancelRequestedAt&&Number.isFinite(run.progress)&&run.progress>0?Math.min(99,Math.floor(run.progress)):undefined;
 return {type,label,value,detail:run?.cancelRequestedAt?'停止后保留已有内容。':value===undefined?'模型未提供可计算进度，结果返回后会自动更新。':'按任务报告的实际进度显示。'};
}
