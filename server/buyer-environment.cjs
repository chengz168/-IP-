// 复用已有环境探测和文件预检，不下载权重、不触发模型推理。
async function buyerEnvironment({store,providers,media,localEnvironment,subtitleFonts}){
 const p=store.data.settings.provider||{},items=[];
 const add=(id,name,status,message,guide)=>items.push({id,name,status,message,guide,inferenceVerified:false});
 const missing=(id,name,guide)=>add(id,name,'missing','尚未检查通过；可先配置该能力，或跳过后再补齐。',guide);
 const workers=localEnvironment.state().services;
 const worker=(id,name,workerId,guide)=>{
  const entry=workers.find(row=>row.id===workerId);
  if(entry?.status==='on-demand')add(id,name,'ready','本机文件预检通过，使用时按需加载；尚未验证本次推理。',guide);
  else missing(id,name,guide);
 };
 const textGuide='去设置 → 模型设置 → 文本生成，填写服务地址与已有模型名称；使用本地服务时在本地环境填写 Ollama 程序路径。';
 try{
  const result=await providers.test({signal:AbortSignal.timeout(8000)});
  if(!p.model||!result.models?.includes(p.model))add('text','文案服务','missing','服务可连接，但未查到当前选择的模型，请选择服务实际返回的模型名称。',textGuide);
  else add('text','文案服务','ready','服务连接与模型列表检查通过；尚未验证本次文案生成。',textGuide);
 }catch{
  let startable=false;
  try{const item=localEnvironment.descriptors().find(item=>item.kind==='ollama'&&item.local);if(item){localEnvironment.launchSpec(item,localEnvironment.settings());startable=true;}}catch{}
  add('text','文案服务',startable?'startable':'missing',startable?'本地程序已找到，可启动服务后重新检查。':'未能连接文案服务，请检查地址、模型和本地程序路径。',textGuide);
 }
 const asrGuide='去设置 → 模型设置 → 语音识别，选择本地 Whisper 并填写 Python 解释器和已有模型目录。';
 if(p.asrProtocol==='local-whisper'){
  try{providers.localAsr().options();add('asr','文字识别','ready','本地 Whisper 解释器与模型文件预检通过；尚未验证本次识别。',asrGuide);}catch{missing('asr','文字识别',asrGuide);}
 }else missing('asr','文字识别','去设置 → 模型设置 → 语音识别，填写云端服务或本地模型；云端配置需实际识别验证。');
 if(p.ttsProtocol==='indextts-local')worker('tts','配音','indextts','去设置 → 模型设置 → 配音，填写已有 IndexTTS 环境目录。');
 else if(p.ttsProtocol==='windows'){
  try{const voices=await new(require('./windows-speech.cjs').WindowsSpeech)(store,media).voices();add('tts','配音',voices?.length?'ready':'missing',voices?.length?'已查到系统语音，可在生成时选用；尚未验证本次配音。':'未查到系统语音，请在系统中安装语音包。','去设置 → 模型设置 → 配音，选择系统配音或已有本地模型。');}catch{missing('tts','配音','去设置 → 模型设置 → 配音，检查系统语音或填写本地模型目录。');}
 }else missing('tts','配音','去设置 → 模型设置 → 配音，配置云端服务或已有本地模型；云端配音需实际生成验证。');
 if(p.avatarProtocol==='musetalk-local')worker('avatar','数字人','musetalk','去设置 → 模型设置 → 数字人，填写已有 MuseTalk 环境目录。');
 else missing('avatar','数字人','去设置 → 模型设置 → 数字人，选择已安装的口型服务；未使用口播时可跳过。');
 try{await media.check();add('media','FFmpeg','ready','FFmpeg 与 FFprobe 版本检查通过。','去设置 → 常规设置 → 媒体工具，填写 FFmpeg 和 FFprobe 程序路径。');}catch{missing('media','FFmpeg','去设置 → 常规设置 → 媒体工具，填写 FFmpeg 和 FFprobe 程序路径。');}
 try{const fonts=subtitleFonts.list();add('fonts','字幕字体',fonts.length?'ready':'missing',fonts.length?'已发现 '+fonts.length+' 项可读取字体。':'未发现可读取字体。','去设置 → 常规设置 → 字幕字体，填写已安装字体的目录。');}catch{missing('fonts','字幕字体','去设置 → 常规设置 → 字幕字体，检查本机字体目录。');}
 return {items,canCreate:items.find(item=>item.id==='text').status==='ready',checkedAt:new Date().toISOString()};
}
module.exports={buyerEnvironment};
