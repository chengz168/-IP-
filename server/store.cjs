const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {selectDefaultCopyId}=require('./prompt-default.mjs');

const createDraft=()=>({id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),step:0,tab:'extract',title:'新建创作任务',mode:'manual',sourceUrl:'',sourceText:'',rewrite:'',finalText:'',confirmed:false,language:'中文',template:'default',wordLimit:'200',brain:{url:'',mode:'shallow'},topic:{industry:'',persona:'通用个人IP',audience:'',bio:''},marketing:{name:'',audience:'',selling:'',persona:'',offer:''},voice:{profile:'',model:'fast',speed:1,emotion:'',strength:0.5,prosodyReferenceId:'',audioId:''},video:{mode:'single',avatarId:'',audioId:'',model:'v2',shots:[],assetId:''},edit:{sourceId:'',volume:1,speed:1,titleEnabled:false,title:'',subtitle:'',titleStyle:'yellow',subtitlesEnabled:true,captions:[],cardEnabled:false,cardName:'',cardDescription:'',sfxEnabled:false,sfxId:'',bgmEnabled:false,bgmId:'',bgmVolume:0.3,pipEnabled:false,pipMode:'continuous',pipId:'',pipSize:0.35,pipPosition:'bottom-right',cutSilence:false,silenceThreshold:-35,silenceMinimum:.35,silencePadding:.09,subtitleStyle:'white',subtitleFontSize:48,subtitlePosition:'bottom',subtitleMargin:.055,subtitleMaxChars:18,resultId:''},cover:{template:'V0',backgroundId:'',frameTime:0,title:'',subtitle:'',color:'#ffffff',fontSize:76,y:0.5,mask:0.3,blur:0,layers:[],assetId:''},publish:{videoId:'',coverId:'',title:'',description:'',tags:[],accountIds:[],mode:'draft',recordId:''},artifacts:{}});
const defaults=()=>({version:1,currentId:'',drafts:[],assets:[],voices:[],avatars:[],brains:[],accounts:[],runs:[],publishRecords:[],categories:['全部素材'],prompts:[{id:'default',name:'默认文案写作提示词',type:'copy',content:'根据用户提供的原文与要求改写文案。保留事实，不虚构数据，输出可直接用于口播的正文。',active:true}],settings:{theme:'default',fontSize:'comfortable',view:'new',mode:'cloud',outputDir:'',ffmpegPath:'',ffprobePath:'',provider:{textProtocol:'compatible',textMaxTokens:'2048',textContextTokens:'',ttsProtocol:'compatible',systemVoice:'',baseUrl:'',model:'',ttsModel:'',asrModel:'',asrProtocol:'compatible',asrPythonPath:'',asrModelPath:'',asrLanguage:'zh',voice:'',avatarUrl:'',cloneUrl:'',extractUrl:'',brainUrl:'',publishUrl:'',embeddingUrl:''}}});

class Store{
  constructor(root){this.root=root;fs.mkdirSync(root,{recursive:true});this.file=path.join(root,'studio.json');this.assetDir=path.join(root,'assets');fs.mkdirSync(this.assetDir,{recursive:true});this.data=this.load();if(!['compact','standard','comfortable','large'].includes(this.data.settings.fontSize))this.data.settings.fontSize='comfortable';for(const d of this.data.drafts){const base=createDraft();for(const key of ['brain','voice','video','edit','cover','publish'])d[key]={...base[key],...d[key]};}if(!this.data.drafts.length){const d=createDraft();d.template=selectDefaultCopyId(this.data);this.data.drafts.push(d);this.data.currentId=d.id;}this.recover();this.save();}
  load(){if(!fs.existsSync(this.file))return defaults();try{const base=defaults(),saved=JSON.parse(fs.readFileSync(this.file,'utf8'));return {...base,...saved,settings:{...base.settings,...saved.settings,provider:{...base.settings.provider,...saved.settings?.provider}}};}catch(e){throw new Error('本地数据无法读取，请从备份恢复。原文件已保留：'+e.message);}}
  recover(){for(const run of this.data.runs){require('./publish-jobs.cjs').recoverPublish(run);if(run.status==='running'||run.status==='queued'){run.status=run.remoteId||(run.remote?.kind?.startsWith('story-')&&run.remote.submissionState==='submitting'&&run.remote.clientId)||(run.remote?.kind==='comfy-h3-v1'&&run.remote?.submissionState==='submitting'&&run.remote?.clientId)?'unknown':'interrupted';run.error='程序在任务完成前退出，请查看详情后恢复。';run.endedAt=new Date().toISOString();}}for(const job of this.data.workflowJobs||[])if(['running','queued','stopping'].includes(job.status)){const unknown=this.data.runs.find(r=>r.parameters?.workflowJobId===job.id&&r.status==='unknown');job.status=unknown?'unknown':'interrupted';job.remoteId=unknown?.remoteId||'';job.error=unknown?'远程结果仍待确认，未自动重交任务。':'程序在自动流程完成前退出，未自动重跑。';job.endedAt=new Date().toISOString();for(const stage of job.stages||[])if(stage.status==='running')stage.status=unknown?'unknown':'interrupted';}}
  save(){
    const temp=this.file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data,null,2));
    // Windows上的扫描器或只读程序可能短暂占用目标文件，保留原文件并有限重试原子替换。
    try{for(let attempt=0;;attempt++){try{fs.renameSync(temp,this.file);break;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=10)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20*(attempt+1));}}}finally{fs.rmSync(temp,{force:true});}
  }
  state(){const data=structuredClone(this.data);data.assets=data.assets.map(({path:assetPath,...asset})=>asset);return data;}
  draft(id){const d=this.data.drafts.find(d=>d.id===(id||this.data.currentId));if(!d)throw new Error('任务不存在');return d;}
  updateDraft(input,options={}){
    const index=this.data.drafts.findIndex(d=>d.id===input.id);if(index<0)throw new Error('任务不存在');
    const before=this.data.drafts[index],next=structuredClone(input);
    // 参考选用凭据仅由专用服务写入，普通草稿不能伪造或覆盖事实核对。
    if(!options.referenceSelection){if(before.referenceSelection)next.referenceSelection=structuredClone(before.referenceSelection);else delete next.referenceSelection;}
    // 分集资产由带版本校验的专用服务写入，普通草稿保存不得覆盖异步产物。
    if(before.story)next.story=structuredClone(before.story);else delete next.story;
    // 翻译属于服务端结果，旧界面保存和客户端输入不能覆盖或伪造译稿。
    next.artifacts??={};if(before.artifacts?.shotTranslations)next.artifacts.shotTranslations=structuredClone(before.artifacts.shotTranslations);else delete next.artifacts.shotTranslations;
    // 解除参考的历史由专用服务维护，旧界面保存不得擦除或伪造。
    if(before.artifacts?.referenceDetachments)next.artifacts.referenceDetachments=structuredClone(before.artifacts.referenceDetachments);else delete next.artifacts.referenceDetachments;
    if(next.creativePreset!==undefined)next.creativePreset=require('./creative-presets.mjs').normalizeCreativeSelection(next.creativePreset);
    if(this.data.runs.some(r=>r.draftId===input.id&&r.type==='publish'&&['running','queued'].includes(r.status))&&require('./publish-jobs.cjs').signature(before)!==require('./publish-jobs.cjs').signature(next))throw Error('发布正在执行，请先停止并核对平台结果后修改发布内容');
    const {workflowActive,workflowInput}=require('./workflow-state.cjs'),active=workflowActive(this.data,input.id);
    if(active&&options.workflowJobId!==active.id&&workflowInput(before)!==workflowInput(next))throw new Error('此任务的自动流程正在执行，请先停止后修改生产输入');
    if(typeof next.sourceText!=='string'||typeof next.finalText!=='string'||!next.edit||!next.cover||!next.voice||!next.video||!next.publish)throw new Error('任务数据不完整');
    // 普通编辑撤销旧确认；服务端选用候选时可原子确认与当前稿完全一致的最终文案。
    const confirmedCopy=options.confirmCopy===true&&next.confirmed===true&&!!next.finalText.trim()&&next.finalText===(next.rewrite?.trim()?next.rewrite:next.sourceText);
    if((before.sourceText!==next.sourceText||before.rewrite!==next.rewrite)&&!confirmedCopy)next.confirmed=false;
    // 辅助文本仅属于生成时的原文，改字后不能沿用旧译文或旧关键词。
    for(const row of next.edit.captions||[])if(row.auxiliary&&row.auxiliary.sourceText!==row.text)delete row.auxiliary;
    if(next.edit.subtitleProofread){const proof=next.edit.subtitleProofread,{hash}=require('./subtitle-proofread.cjs'),reference=require('./subtitle-reference.mjs').trustedSubtitleReference(next,this.data,hash);if(!reference||hash(JSON.stringify(next.edit.captions))!==proof.captionsSha256||hash(reference.text)!==proof.referenceSha256||(next.edit.sourceId||next.video.assetId)!==proof.sourceId)delete next.edit.subtitleProofread;}
    next.createdAt=before.createdAt;next.updatedAt=new Date().toISOString();
    const without=(value,keys)=>JSON.stringify(Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k))));
    // 上游参数变化会使下游产物失效；素材库中的实际文件仍予以保留。
    const voiceChanged=before.finalText!==next.finalText||without(before.voice,['audioId'])!==without(next.voice,['audioId']);
    if(voiceChanged)next.voice.audioId='';
    const independentStory=before.video.mode==='story'&&next.video.mode==='story'&&!require('./story-links.cjs').usesUpstreamNarration(next);
    const storyVideoFields=['assetId','avatarId','audioId','model','shots'];
    const videoChanged=(!independentStory&&(voiceChanged||before.voice.audioId!==next.voice.audioId))||without(before.video,independentStory?storyVideoFields:['assetId'])!==without(next.video,independentStory?storyVideoFields:['assetId']);
    if(videoChanged)next.video.assetId='';
    require('./story-links.cjs').invalidateStoryHandoff(before,next);
    // 商品成片绑定确认稿、商品资料与配音，修改上游后撤销旧交接，媒体文件仍留在素材库。
    if(before.productSelection&&(before.finalText!==next.finalText||!next.confirmed||before.language!==next.language||before.voice.audioId!==next.voice.audioId||without(before.voice,['audioId'])!==without(next.voice,['audioId'])||JSON.stringify(before.product)!==JSON.stringify(next.product)||before.video.mode!==next.video.mode)){
      const selected=before.productSelection;
      if(next.edit.sourceId===selected.baseId)next.edit.sourceId='';
      if(next.video.assetId===selected.baseId)next.video.assetId='';
      next.edit.resultId='';next.cover.assetId='';next.cover.videoId='';next.publish.videoId='';next.publish.coverId='';next.publish.recordId='';delete next.productSelection;
    }
    // 历史由服务端归档，较早的界面快照不能把已经保存的历史丢掉。
    if(before.artifacts?.captionHistory?.length){next.artifacts??={};const prior=before.artifacts.captionHistory;next.artifacts.captionHistory=[...(next.artifacts.captionHistory||[]).filter(e=>!prior.some(p=>p.id===e.id)),...structuredClone(prior)];}
    require('./caption-history.cjs').archiveOnSourceChange(before,next);
    const editChanged=videoChanged||before.video.assetId!==next.video.assetId||without(before.edit,['resultId'])!==without(next.edit,['resultId']);
    if(editChanged)next.edit.resultId='';
    const coverChanged=without(before.cover,['assetId','videoId'])!==without(next.cover,['assetId','videoId']);
    if(coverChanged){next.cover.assetId='';next.cover.videoId='';}
    // 同参数重新生成也会替换真实产物，旧首帧视频与默认发布绑定不能继续沿用。
    const videoOutputChanged=before.video.assetId!==next.video.assetId,editOutputChanged=before.edit.resultId!==next.edit.resultId,coverOutputChanged=before.cover.assetId!==next.cover.assetId;
    if(editChanged||editOutputChanged||coverOutputChanged){next.cover.videoId='';if(next.publish.videoId===before.cover.videoId)next.publish.videoId='';}
    if(coverChanged&&next.publish.videoId===before.cover.videoId)next.publish.videoId='';
    if((videoChanged||videoOutputChanged)&&next.publish.videoId===before.video.assetId)next.publish.videoId='';
    if((editChanged||editOutputChanged)&&next.publish.videoId===before.edit.resultId)next.publish.videoId='';
    if((coverChanged||coverOutputChanged)&&next.publish.coverId===before.cover.assetId)next.publish.coverId='';
    if(videoChanged||editChanged||coverChanged||videoOutputChanged||editOutputChanged||coverOutputChanged||before.cover.videoId!==next.cover.videoId||without(before.publish,['recordId'])!==without(next.publish,['recordId']))next.publish.recordId='';
    const previousCurrentId=this.data.currentId;
    this.data.drafts[index]=next;this.data.currentId=options.workflowJobId||options.preserveCurrentId?previousCurrentId:next.id;
    try{if(options.persist!==false)this.save();}catch(error){this.data.drafts[index]=before;this.data.currentId=previousCurrentId;throw error;}return next;
  }
  asset(id){const a=this.data.assets.find(a=>a.id===id);if(!a||!fs.existsSync(a.path))throw new Error('文件不存在或已被移动，请重新导入');return a;}
  addAsset(file,extra={},options={}){const id=crypto.randomUUID();const name=path.basename(file);const ext=path.extname(file).toLowerCase();const target=path.join(this.assetDir,id+ext);if(file!==target)fs.copyFileSync(file,target);const type=/\.(mp4|mov|avi|mkv|webm|wmv|flv)$/i.test(ext)?'video':/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)?'audio':/\.(png|jpg|jpeg|webp)$/i.test(ext)?'image':/\.(srt|vtt|txt|json)$/i.test(ext)?'text':'other';const a={id,name,type,size:fs.statSync(target).size,path:target,category:'全部素材',tags:[],createdAt:new Date().toISOString(),...extra};this.data.assets.push(a);if(options.persist!==false)this.save();return a;}
  outputDir(){const dir=this.data.settings.outputDir||path.join(this.root,'outputs');fs.mkdirSync(dir,{recursive:true});return dir;}
}
module.exports={Store,createDraft,defaults};
