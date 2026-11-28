const fs=require('node:fs'),crypto=require('node:crypto');
const {productionInput,currentPlan}=require('./video-production-plan.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

// 只从同一草稿的成功报告取制作依据，客户端画像不能代替来源凭据。
function productionReference(draft,data,{verifyFile=false,strict=false}={}){
 const selection=draft.referenceSelection;if(!selection)return null;
 const reject=()=>{if(strict)throw Error('参考视频关联已失效，请返回视频拆解核对或解除参考后再识别制作方式');return null;};
 const run=data.runs?.find(r=>r.id===selection.sourceRunId&&r.draftId===draft.id&&r.type==='reference-analysis'&&r.status==='succeeded');
 const output=run?.output,source=output?.source;
 if(!output||output.stale||!source?.sha256||selection.sourceSha256!==source.sha256||(selection.sourceUrl??run.snapshot?.sourceUrl)!==draft.sourceUrl)return reject();
 const asset=data.assets?.find(a=>a.id===source.assetId);if(!asset?.path||!fs.existsSync(asset.path))return reject();
 if(verifyFile){try{if(hash(fs.readFileSync(asset.path))!==source.sha256)return reject();}catch{return reject();}}
 const analysis=output.analysis||{},visual=output.visual?.status==='succeeded'?output.visual.observations||[]:[];
 try{return productionInput(draft,{reference:{sourceRunId:run.id,sourceSha256:source.sha256,contentType:analysis.contentType||'uncertain',summary:analysis.summary||'',reusableStructure:analysis.reusableStructure||[],sections:(analysis.sections||[]).map(s=>({label:s.label||'',purpose:s.purpose||'',basis:s.basis||'transcript',visualSamples:s.visualSamples||[]})),visualObservations:visual.map((s,sample)=>({sample,description:s.description}))}}).reference;}catch{return reject();}
}
function trustedPlan(draft,data,options={}){
 const plan=currentPlan(draft);if(!plan)return null;
 const reference=productionReference(draft,data,options);
 if(draft.referenceSelection&&!reference||JSON.stringify(reference)!==JSON.stringify(plan.reference||null))return null;
 return plan;
}
module.exports={productionReference,trustedPlan};
