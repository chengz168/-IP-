const fs=require('node:fs');
const {WindowsSpeech}=require('./windows-speech.cjs');
const path=require('node:path');
const {setTimeout:sleep}=require('node:timers/promises');
const {capabilityBaseUrl}=require('./provider-endpoints.mjs');
const {effectiveKey}=require('./provider-keys.cjs');
const {textTimeoutSeconds}=require('./prompt-catalog.mjs');

const address=value=>{let url;try{url=new URL(value);}catch{throw new Error('服务地址无效，请在模型设置中填写完整地址');}if(!['http:','https:'].includes(url.protocol))throw new Error('服务地址仅支持HTTP或HTTPS');return url.toString().replace(/\/$/,'');};
// 协议决定请求格式，回环地址才表示本机免费服务；远程Ollama仍受云端额度约束。
const localOllama=(local,base)=>local&&['localhost','127.0.0.1','[::1]'].includes(new URL(address(base)).hostname);
class Providers{
  constructor(store,media,secrets){this.store=store;this.media=media;this.secrets=secrets;if(store.root)this.usageGuard=require('./usage-guard.cjs').createUsageGuard({root:store.root,limits:()=>({dailyRequests:store.data.settings.usageLimits?.dailyTextRequests??10,dailyTokens:store.data.settings.usageLimits?.dailyTokens??200000})});}
  config(){return this.store.data.settings.provider;}
  async headers(capability='global'){const key=await effectiveKey(this.secrets,capability);return key?{Authorization:'Bearer '+key}:{};}
  async sameOriginHeaders(url,base,capability){return base&&new URL(address(url)).origin===new URL(address(base)).origin?this.headers(capability):{};}
  async request(url,options,ctx={},timeoutMs=180000){
    if(!Number.isInteger(timeoutMs)||timeoutMs<=0)throw Error('请求等待时间无效');
    const localService=this.store.localEnvironment?.ollamaFor(url);if(localService)await this.store.localEnvironment.ensureOllama(localService.baseUrl,ctx);
    const deadline=AbortSignal.timeout(timeoutMs),signal=ctx.signal?AbortSignal.any([ctx.signal,deadline]):deadline;let response;
    try{response=await fetch(address(url),{...options,signal});}catch(e){throw new Error(ctx.signal?.aborted||e.name==='AbortError'?'请求已停止':deadline.aborted||e.name==='TimeoutError'?'模型服务请求超时':'无法连接模型服务，请检查地址与网络');}
    if(!response.ok){let message='';try{const data=await response.json();message=data.error?.message||data.message||'';}catch{}if(ctx.signal?.aborted)throw Error('请求已停止');if(deadline.aborted)throw Error('模型服务请求超时');throw new Error('模型服务返回HTTP '+response.status+(message?'：'+message.slice(0,500):''));}return response;
  }
  async test(ctx={}){const config=this.config();if(!config.baseUrl)throw new Error('请先配置模型服务地址');const local=config.textProtocol==='ollama',base=address(config.baseUrl),r=await this.request(local?base.replace(/\/v1$/,'')+'/api/tags':base+'/models',{headers:local?{}:await this.headers('text')},ctx);const data=await r.json();return {connected:true,models:local?(data.models||[]).map(m=>m.name||m.model):(data.data||[]).map(m=>m.id)};}
  async vision(system,user,images,ctx,{schema}={}){
    const config=this.config(),model=config.visionModel,base=config.visionBaseUrl||config.baseUrl,local=config.visionProtocol==='ollama';
    if(!model||!base)throw new Error('请先配置已有视觉模型及服务地址');
    if(!Array.isArray(images)||images.length<1||images.length>3||images.some(i=>typeof i!=='string'||!i.length))throw new Error('视觉分析需要1至3张有效采样画面');
    const messages=[{role:'system',content:system},local?{role:'user',content:user,images}:{role:'user',content:[{type:'text',text:user},...images.map(i=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+i}}))]}];
    const body=local?{model,messages,stream:false,think:false,...(schema?{format:schema}:{}),options:{num_predict:1200,temperature:0,num_ctx:8192}}:{model,messages,stream:false,max_tokens:1200,...(schema?{response_format:{type:'json_schema',json_schema:{name:'material_annotation',strict:true,schema}}}:{})};
    const endpoint=local?address(base).replace(/\/v1$/,'')+'/api/chat':address(base)+'/chat/completions';
    const headers={...(local?{}:await this.headers('vision')),'Content-Type':'application/json'},ticket=this.usageGuard?.reserve({capability:'vision',protocol:localOllama(local,base)?'ollama':'compatible',reservedTokens:Buffer.byteLength(system+user,'utf8')+1200+images.length*4096});let settled=false;
    try{
    const response=await this.request(endpoint,{method:'POST',headers,body:JSON.stringify(body)},ctx),data=await response.json(),text=local?data.message?.content:data.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim()||(local?data.done_reason:data.choices?.[0]?.finish_reason)==='length'){
      const error=new Error(typeof text!=='string'||!text.trim()?'视觉服务没有返回描述':'视觉模型输出不完整，原描述保留');
      // 失败回包已经给出用量时照实结算，不能丢失后改记为估算值。
      error.evidence={usage:local?{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}:data.usage||null,requestId:data.id||''};throw error;
    }
    const usage=local?{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}:data.usage||null;settled=true;const usageRecord=ticket?this.usageGuard.succeed(ticket,usage):null;
    return {text,model,protocol:local?'ollama':'compatible',requestId:data.id||'',usage,...(usageRecord&&!usageRecord.local?{usageRecord}:{})};
    }catch(error){if(ticket&&!settled)this.usageGuard.fail(ticket,{usage:error.evidence?.usage,cancelled:!!ctx?.signal?.aborted,upstreamFailure:!ctx?.signal?.aborted});throw error;}
  }
  async text(system,user,ctx,{schema,model,temperature,maxTokens,thinking,presencePenalty}={}){
    // 固定本次任务的经验快照，后续修改只影响新任务；不介入取证、校对或图像模型。
    const learning=ctx?.creativeLearning;user+=require('./creative-learning.mjs').learningPrompt(learning);
    const config=this.config(),requestedModel=model||config.model;if(!config.baseUrl||!requestedModel)throw new Error('请在设置 → 模型设置中配置文本服务地址和模型名称');
    const local=config.textProtocol==='ollama',transportTimeoutMs=textTimeoutSeconds(config)*1000;
    if(thinking!==undefined&&typeof thinking!=='boolean')throw Error('本地思考开关需为布尔值');
    if(presencePenalty!==undefined&&(!Number.isFinite(presencePenalty)||presencePenalty<0||presencePenalty>2))throw Error('重复主题惩罚需在0至2之间');
    const configuredLimit=config.textMaxTokens?Number(config.textMaxTokens):undefined;
    if(maxTokens!==undefined&&(!Number.isInteger(maxTokens)||maxTokens<64||maxTokens>32768))throw new Error('单次文本输出上限需为64至32768的整数');
    if(temperature!==undefined&&(!Number.isFinite(temperature)||temperature<0||temperature>2))throw new Error('文本温度需在0至2之间');
    const limit=maxTokens===undefined?(configuredLimit??2048):Math.min(maxTokens,configuredLimit??maxTokens);
    if(limit!==undefined&&(!Number.isInteger(limit)||limit<64||limit>32768))throw new Error('文本输出上限需为64至32768的整数');
    const messages=[{role:'system',content:system},{role:'user',content:user}];
    const context=local&&config.textContextTokens?Number(config.textContextTokens):undefined;
    if(context!==undefined){
      if(!Number.isSafeInteger(context)||context<512)throw new Error('本地上下文长度需为至少512的整数');
      // 用UTF-8字节数预留保守输入空间，避免调小上下文后静默丢失长文。
      const budget=Buffer.byteLength(system+user,'utf8')+(limit||2048)+512;
      if(budget>context)throw new Error('文案超过本地上下文的保守预算，请缩短文案或增大上下文长度');
    }
    const body=local?{model:requestedModel,messages,stream:false,think:thinking??false,...(schema?{format:schema}:{}),options:{num_predict:limit||2048,...(context?{num_ctx:context}:{}),...(presencePenalty!==undefined?{presence_penalty:presencePenalty}:{}),...(temperature!==undefined?{temperature}:schema?{temperature:0}:{})}}:{model:requestedModel,messages,stream:false,...(limit?{max_tokens:limit}:{}),...(temperature!==undefined?{temperature}:{}),...(schema?{response_format:{type:'json_schema',json_schema:{name:'subtitle_auxiliary',strict:true,schema}}}:{})};
    const endpoint=local?address(config.baseUrl).replace(/\/v1$/,'')+'/api/chat':address(config.baseUrl)+'/chat/completions';
    const headers={...(local?{}:await this.headers('text')),'Content-Type':'application/json'},ticket=this.usageGuard?.reserve({capability:'text',protocol:localOllama(local,config.baseUrl)?'ollama':'compatible',reservedTokens:Buffer.byteLength(system+user,'utf8')+(limit||2048)});let settled=false;
    try{
    ctx?.signal?.throwIfAborted();ctx?.learningUsed?.();
    const response=await this.request(endpoint,{method:'POST',headers,body:JSON.stringify(body)},ctx,transportTimeoutMs);
    let data;try{data=await response.json();}catch(error){if(ctx?.signal?.aborted)throw Error('请求已停止');if(error.name==='AbortError'||error.name==='TimeoutError')throw Error('模型服务请求超时');throw error;}const text=local?data.message?.content:data.choices?.[0]?.message?.content;
    const finishReason=local?data.done_reason:data.choices?.[0]?.finish_reason;
    if(typeof text!=='string'||!text.trim()){
      const error=new Error(finishReason==='length'?'模型已达到输出上限，但尚未生成正文；原文案已保留，请调整模型或输出上限后重试':'模型返回的文案为空或不符合文本接口格式');
      // 只有思考而无正文时也保存真实终止原因，不能当成网络失败或丢失执行证据。
      error.evidence={rawProviderText:typeof text==='string'?text:'',finishReason,usage:local?{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}:data.usage||null,requestId:data.id||''};
      throw error;
    }
    if(finishReason==='length'){
      const error=new Error('模型输出达到长度上限，文案不完整；请提高文本输出上限后重试');
      // 截断结果仍拒绝使用，原始回包只作为失败证据保留，不记录请求头或密钥。
      error.evidence={rawProviderText:text,finishReason,usage:local?{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}:data.usage||null,requestId:data.id||''};
      throw error;
    }
    const usage=local?{prompt_tokens:data.prompt_eval_count,completion_tokens:data.eval_count}:data.usage||null;settled=true;const usageRecord=ticket?this.usageGuard.succeed(ticket,usage):null;
    return {text,requestId:data.id||'',usage,...(learning?.entries?.length?{creativeLearning:structuredClone(learning)}:{}),...(usageRecord&&!usageRecord.local?{usageRecord}:{}),request:{model:requestedModel,protocol:local?'ollama':'compatible',transportTimeoutMs,messages,parameters:local?{think:body.think,...body.options,...(schema?{format:schema}:{})}:{...(limit?{max_tokens:limit}:{}),...(temperature!==undefined?{temperature}:{}),...(schema?{response_format:body.response_format}:{})}},finishReason};
    }catch(error){if(ticket&&!settled)this.usageGuard.fail(ticket,{usage:error.evidence?.usage,cancelled:!!ctx?.signal?.aborted,upstreamFailure:!ctx?.signal?.aborted});throw error;}
  }
  async speech(draft,ctx,context){
    const {speechContext,speechRequest,speechEvidence}=require('./speech-request.cjs');context=context||speechContext(this.store.data);const config=context.provider,request=speechRequest(draft,context);if(config.ttsProtocol==='windows')return new WindowsSpeech(this.store,this.media).synthesize(draft,ctx,config);
    if(config.ttsProtocol==='indextts-local')return this.localIndexTTS().synthesize(draft,ctx,context);
    const {speechInput}=await import('./speech-config.mjs'),input=speechInput(draft,config);
    const baseUrl=capabilityBaseUrl(config,'tts');if(!baseUrl||!input.model)throw new Error('请先配置语音服务与模型');
    const profile=context.voices.find(v=>v.id===draft.voice.profile);
    if(draft.voice.profile&&!profile?.remoteId)throw new Error('所选声音只有本地样本，尚未返回可用音色ID，请先训练或选择其他音色');
    const voice=profile?.remoteId||config.voice;if(!voice)throw new Error('请选择已接入服务的音色或填写服务音色ID');
    const response=await this.request(address(baseUrl)+'/audio/speech',{method:'POST',headers:{...await this.headers('tts'),'Content-Type':'application/json'},body:JSON.stringify({model:input.model,input:input.text,voice,speed:input.speed,response_format:'mp3'})},ctx);
    const file=path.join(this.store.outputDir(),'voice-'+Date.now()+'.mp3');
    try{fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));const probe=await this.media.probe(file);if(!probe.streams.some(stream=>stream.codec_type==='audio')||!(Number(probe.format.duration)>0))throw new Error('语音服务未返回有效音轨');ctx.signal?.throwIfAborted();return this.store.addAsset(file,{origin:'tts',duration:Number(probe.format.duration),speech:{engine:'compatible',model:input.model,voice,speed:input.speed,textLength:input.text.length,request:speechEvidence(request)}});}catch(error){fs.rmSync(file,{force:true});throw error;}
  }

  comfyH3(){if(!this.localH3){const {ComfyH3}=require('./comfy-h3.cjs');this.localH3=new ComfyH3(this.store,this.media);}return this.localH3;}
  localMuseTalk(){if(!this.localLipSync){const {LocalMuseTalk}=require('./local-musetalk.cjs');this.localLipSync=new LocalMuseTalk(this.store,this.media);}return this.localLipSync;}
  localIndexTTS(){if(!this.localSpeech){const {LocalIndexTTS}=require('./local-indextts.cjs');this.localSpeech=new LocalIndexTTS(this.store,this.media);}return this.localSpeech;}
  localAsr(){if(!this.localRecognizer){const {LocalAsr}=require('./local-asr.cjs');this.localRecognizer=new LocalAsr(this.store,this.media);}return this.localRecognizer;}
  async transcribe(assetId,ctx){const config=this.config();if(config.asrProtocol==='local-whisper')return this.localAsr().transcribe(assetId,ctx);if(config.asrProtocol&&config.asrProtocol!=='compatible')throw new Error('未知语音识别方式');const baseUrl=capabilityBaseUrl(config,'asr');if(!baseUrl||!config.asrModel)throw new Error('请先配置语音识别服务和模型，或直接导入字幕文件');let asset=this.store.asset(assetId);if(asset.type==='video')asset=await this.media.extractAudio(assetId,ctx);const form=new FormData();form.set('model',config.asrModel);form.set('file',new Blob([fs.readFileSync(asset.path)]),asset.name);form.set('response_format','verbose_json');const response=await this.request(address(baseUrl)+'/audio/transcriptions',{method:'POST',headers:await this.headers('asr'),body:form},ctx);const data=await response.json();if(typeof data.text!=='string'||!data.text.trim())throw new Error('语音识别服务没有返回文本');return {text:data.text,segments:(data.segments||[]).map(s=>({start:s.start,end:s.end,text:s.text}))};}
  async bridge(url,body,ctx,capability='global'){if(!url)throw new Error('此能力尚未配置服务桥，请在模型设置中接入实际服务');return (await this.request(url,{method:'POST',headers:{...await this.headers(capability),'Content-Type':'application/json'},body:JSON.stringify(body)},ctx)).json();}
  async cloneVoice(name,sampleId,ctx){const config=this.config();if(!config.cloneUrl)throw new Error('声音克隆服务尚未配置，请在模型设置中填写克隆服务桥地址，或先仅保存样本');let sample=this.store.asset(sampleId);if(sample.type==='video')sample=await this.media.extractAudio(sampleId,ctx);const form=new FormData();form.set('name',name);form.set('file',new Blob([fs.readFileSync(sample.path)]),sample.name);const response=await this.request(config.cloneUrl,{method:'POST',headers:await this.headers('clone'),body:form},ctx);const data=await response.json();if(typeof data.voiceId!=='string'||!data.voiceId.trim())throw new Error('克隆服务没有返回可用voiceId，未标记训练完成');return data;}
  async downloadAvatar(result,ctx,input,options={}){
    if(typeof result.videoUrl!=='string'||!result.videoUrl.trim())throw new Error('数字人服务未返回可下载的视频地址');
    const response=await this.request(result.videoUrl,{headers:await this.sameOriginHeaders(result.videoUrl,input?.avatarUrl,'avatar')},ctx),file=path.join(this.store.outputDir(),'avatar-'+require('node:crypto').randomUUID()+'.mp4');let asset;
    try{fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));const info=await this.media.probe(file);if(!info.streams.some(s=>s.codec_type==='video')||!Number.isFinite(Number(info.format.duration))||Number(info.format.duration)<=0)throw new Error('数字人服务返回的文件没有有效视频流或时长');ctx.signal?.throwIfAborted();asset=this.store.addAsset(file,{origin:'avatar',duration:Number(info.format.duration),avatarRequest:input},{persist:false});if(options.persist!==false)this.store.save();return asset;}
    catch(error){if(asset){this.store.data.assets=this.store.data.assets.filter(a=>a.id!==asset.id);fs.rmSync(asset.path,{force:true});}throw error;}
    finally{fs.rmSync(file,{force:true});}
  }
  async avatar(draft,ctx,context){
    const {avatarContext,avatarFilesCurrent}=require('./avatar-request.cjs');context=context||avatarContext(this.store,draft);const {audio,video,input}=context;
    if(!avatarFilesCurrent(context))throw Error('驱动音频或形象视频文件已变化，请重新生成');
    if(context.protocol==='comfy-h3')return this.comfyH3().generate(draft,ctx,context);
    if(context.protocol==='musetalk-local')return this.localMuseTalk().generate(draft,ctx,context);
    const form=new FormData();form.set('audio',new Blob([fs.readFileSync(audio.path)]),audio.name);form.set('video',new Blob([fs.readFileSync(video.path)]),video.name);form.set('model',input.model);form.set('shots',JSON.stringify(input.shots));
    if(!avatarFilesCurrent(context))throw Error('驱动音频或形象视频文件已变化，本次未提交');ctx.signal?.throwIfAborted();
    let result=await (await this.request(context.avatarUrl,{method:'POST',headers:await this.headers('avatar'),'body':form},ctx)).json();const remoteId=result.jobId;
    if(remoteId){ctx.remote(remoteId,{kind:'avatar-bridge-v1',statusUrl:result.statusUrl});if(!result.statusUrl){const error=new Error('服务已提交任务，但未返回查询地址，请保留任务ID联系服务商');error.unknown=true;throw error;}}
    try{
      const statusUrl=result.statusUrl,started=Date.now();
      while(result.status==='queued'||result.status==='running'){
        if(Date.now()-started>30*60*1000)throw Error('远程任务尚未结束，请稍后查询，避免重复提交');
        await sleep(3000,undefined,{signal:ctx.signal});result=await (await this.request(statusUrl,{headers:await this.sameOriginHeaders(statusUrl,context.avatarUrl,'avatar')},ctx)).json();
        if(result.jobId!==undefined&&result.jobId!==remoteId)throw Error('查询返回的任务ID与原记录不一致');
        if(Number.isFinite(result.progress))ctx.progress(result.progress);
      }
      if(['failed','cancelled'].includes(result.status)){const error=new Error(result.error||(result.status==='failed'?'数字人服务生成失败':'远程服务确认任务已取消'));error.remoteConfirmed=true;throw error;}
      if(result.status!==undefined&&result.status!=='succeeded')throw Error('远程服务返回未识别状态，请保留任务ID确认结果');
      return await this.downloadAvatar(result,ctx,input);
    }catch(error){if(remoteId&&!error.remoteConfirmed)error.unknown=true;throw error;}
  }
}
module.exports={Providers,address};
