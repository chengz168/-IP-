const {inferProductionPlan,productionSignature}=require('./video-production-plan.cjs');
const {productionReference,trustedPlan}=require('./reference-production.cjs');
const {confirmationInput,confirmationMatches,copyCandidate}=require('./copy-confirmation.mjs');

class VideoPlanning{
 constructor(service){this.service=service;this.store=service.store;this.locks=new Set();}
 ready(id){
  if(this.locks.has(id)||this.store.data.runs.some(r=>r.draftId===id&&['running','queued','unknown'].includes(r.status))||(this.store.data.workflowJobs||[]).some(j=>j.draftId===id&&['running','queued','stopping','unknown'].includes(j.status)))throw Error('当前任务正在运行或结果待确认，请先等待、停止或核对后再识别');
 }
 async execute({id,input,confirm=false}){
  this.ready(id);this.locks.add(id);
  try{
   const original=structuredClone(this.store.draft(id));
   if(confirm&&!confirmationMatches(input,original))throw Error('文案输入已变化，请保存当前内容后重新确认');
   if(!confirm&&!original.confirmed)throw Error('请先确认最终文案，再识别制作方式');
   const candidate=structuredClone(original);candidate.finalText=confirm?copyCandidate(candidate):candidate.finalText;
   if(!candidate.finalText.trim())throw Error('请先输入文案');candidate.confirmed=true;
   const reference=productionReference(candidate,this.store.data,{verifyFile:true,strict:true});
   const signature=productionSignature(candidate,{reference}),config=JSON.stringify(this.service.providers.config()),initialCopy=confirmationInput(original),policy=original.video.routing?.policy||'manual',mode=original.video.mode;
   const same=()=>{const d=this.store.draft(id),now={...d,finalText:confirm?copyCandidate(d):d.finalText};return confirmationMatches(initialCopy,d)&&(d.video.routing?.policy||'manual')===policy&&d.video.mode===mode&&productionSignature(now,{reference:productionReference(now,this.store.data,{verifyFile:true,strict:true})})===signature&&JSON.stringify(this.service.providers.config())===config;};
   const apply=plan=>{
    if(!same()||this.store.data.runs.some(r=>r.draftId===id&&r.type!=='video-plan'&&['running','queued','unknown'].includes(r.status))||(this.store.data.workflowJobs||[]).some(j=>j.draftId===id&&['running','queued','stopping','unknown'].includes(j.status)))return {plan,stale:true};
    const next=structuredClone(this.store.draft(id));next.finalText=candidate.finalText;next.confirmed=true;
    if(plan)next.video.productionPlan=plan;
    // 仅为尚未明确选择制作方式的商品稿设置动态流程，尊重已有原图展示选择。
    if(plan?.mode==='product'&&policy==='auto'&&!next.product.renderMode){next.product.renderMode='introduction';next.product.narration=true;}
    const saved=this.store.updateDraft(next,{preserveCurrentId:true,productionPlan:true,confirmCopy:confirm});
    return {draft:saved,plan:plan||null,stale:false};
   };
   // 手动选择无需模型参与；未配置模型且没有参考或要求时沿用已有可解释规则。
   if(policy==='manual')return apply(null);
   const existing=trustedPlan(candidate,this.store.data);if(existing?.status==='inferred')return apply(existing);
   const configured=this.service.providers.config();
   if(!configured.baseUrl&&!reference&&!candidate.video.productionInstruction&&!candidate.creativePreset?.instruction)return apply(null);
   return await this.service.runtime.run('video-plan',id,{inputHash:signature},async ctx=>{
    const plan=await inferProductionPlan({draft:candidate,reference,providers:this.service.providers,ctx});ctx.signal.throwIfAborted();return apply(plan);
   });
  }finally{this.locks.delete(id);}
 }
 async confirm(args){try{const result=await this.execute({...args,confirm:true});if(result.stale)throw Error('识别期间文案、参考或制作要求已变化，未确认旧稿，请核对后重试');return result.draft;}catch(error){if(['EPERM','EACCES','EBUSY','ENOSPC','EIO'].includes(error.code))throw Error('文案确认保存失败，请检查磁盘空间、文件权限或占用后重试。当前稿件已保留。',{cause:error});throw error;}}
 async plan(args){return this.execute(args);}
}
module.exports={VideoPlanning};
