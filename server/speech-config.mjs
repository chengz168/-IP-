import {capabilityBaseUrl} from './provider-endpoints.mjs';
export const emotionOptions=Object.freeze([
 {value:'',label:'正常'},{value:'happy',label:'高兴'},{value:'angry',label:'愤怒'},
 {value:'sad',label:'悲伤'},{value:'afraid',label:'害怕'},{value:'disgusted',label:'厌恶'},
 {value:'depressed',label:'忧郁'},{value:'surprised',label:'惊讶'},{value:'calm',label:'平静'}
]);
export function speechCapabilities(config){
 const windows=config.ttsProtocol==='windows',local=config.ttsProtocol==='indextts-local',classic=local?'IndexTTS-2.5':String(config.ttsClassicModel||config.ttsModel||'').trim(),fast=local?'IndexTTS-2.5':String(config.ttsFastModel||config.ttsModel||'').trim();
 return {windows,local,classic,fast,modelRouting:!windows&&!local&&!!classic&&!!fast&&classic!==fast,emotions:local};
}

// 这里只描述当前配置和素材记录；文件存在性、模型可用性及生成效果仍由实际合成校验。
export function voiceResourceStatus(profile={},config={},assets=[]){
 const sample=assets.find(asset=>asset.id===profile.sampleId),{local,windows}=speechCapabilities(config),hasRemote=!!String(profile.remoteId||'').trim();
 if(windows&&hasRemote&&!profile.sampleId)return {label:'服务音色 ID',detail:'已填写服务音色 ID；当前系统配音使用本机系统音色，不会使用此服务 ID。'};
 if(!local&&!windows&&hasRemote)return {label:'服务音色 ID',detail:'已填写服务音色 ID，是否可用需通过当前语音服务实际合成验证。'};
 if(!profile.sampleId)return {label:'未关联声音样本',detail:local?'本地 IndexTTS 需要关联音频样本；服务音色 ID 不能代替本地参考音频。':'尚未关联声音样本或填写服务音色 ID。'};
 if(!sample)return {label:'样本记录缺失',detail:'关联的素材记录不存在，请重新选择声音样本。'};
 if(sample.type!=='audio')return {label:'需音频样本',detail:'当前样本不是音频素材，请先提取音轨并保存音频样本。'};
 return local?{label:'本地参考样本',detail:'已关联音频素材记录，可作为本地 IndexTTS 的参考输入；文件、时长和模型环境在生成时校验，尚不代表本次合成或效果验收通过。'}:{label:'声音样本',detail:config.ttsProtocol==='windows'?'已关联声音样本；系统配音使用本机系统音色，不能使用此参考样本。':'已关联声音样本；当前语音服务使用服务音色 ID，单独保存样本不会完成服务音色训练。'};
}

export function voiceResourceHint(config={}){
 const capabilities=speechCapabilities(config);
 const usage=capabilities.local?'当前本地 IndexTTS 使用已保存的音频样本作参考，无需先取得服务音色 ID。文件、时长与模型环境会在生成时校验，效果以实际合成试听为准。':capabilities.windows?'当前使用系统配音，请选择本机系统音色；保存的参考样本不会用于系统配音。':'当前语音服务使用服务音色 ID；保存样本不会自动完成服务音色训练，ID 是否可用需实际合成验证。';
 return usage+(config.cloneUrl?' 声音训练服务地址已配置，是否可用需实际调用验证。':' 声音训练服务地址未配置，“开始训练”需要另行配置该服务。');
}
export function speechInput(draft,config){
 const voice=draft.voice||{},speed=Number(voice.speed),text=String(draft.finalText||'');
 if(!text.trim()||text.length>10000)throw new Error('请填写10000字以内的最终文案');
 if(!Number.isFinite(speed)||speed<.5||speed>2)throw new Error('语速需在0.5至2倍之间');
 const local=config.ttsProtocol==='indextts-local';
 if(voice.emotion&&!['normal','正常'].includes(voice.emotion)&&(!local||!emotionOptions.some(item=>item.value===voice.emotion)))throw new Error('当前语音引擎未支持情绪控制或该情绪选项，请先将情绪设为正常');
 if(local&&voice.prosodyReferenceId&&voice.emotion&&!['normal','正常'].includes(voice.emotion))throw new Error('参考韵律音频与情绪类型只能二选一');
 if(local){
  if(!Number.isFinite(Number(voice.strength??.5))||Number(voice.strength??.5)<0||Number(voice.strength??.5)>1)throw new Error('情绪强度需在0至1之间');
  if(!['中文','英语','日语','西班牙语','阿拉伯语'].includes(draft.language||'中文'))throw new Error('本地声音模型暂不支持所选语言');
 }
 if(voice.model&&!['classic','fast'].includes(voice.model))throw new Error('声音生成模型选项无效，请重新选择');
 const capabilities=speechCapabilities(config);
 return {text,speed,systemVoice:voice.systemVoice||config.systemVoice||'',model:voice.model==='classic'?capabilities.classic:capabilities.fast,capabilities};
}
export function speechDuration(info){
 const duration=Number(info?.format?.duration);
 if(!info?.streams?.some(stream=>stream.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)throw new Error('语音引擎没有生成有效音轨和时长，请检查音色是否支持当前文案语言');
 return duration;
}

// 按实际引擎配置给出生成前的阻塞原因，界面不展示无法执行的模型或音色能力。
export function speechGenerationReason(draft,config,profiles=[],installed=[]){
 const v=draft.voice||{},capabilities=speechCapabilities(config);
 if(!String(draft.finalText||'').trim())return '请先填写最终文案';
 if(String(draft.finalText).length>10000)return '当前引擎最多支持10000字';
 if(v.emotion&&!['normal','正常'].includes(v.emotion)&&!capabilities.emotions)return '当前引擎不支持情绪，请先设为正常';
 if(v.prosodyReferenceId&&!capabilities.local)return '参考韵律音频仅支持本地 IndexTTS';
 if(capabilities.windows&&v.profile)return '系统配音不能使用克隆样本，请选择系统音色生成';
 const profile=profiles.find(p=>p.id===v.profile);
 if(capabilities.local){
  if(!config.indexttsHome)return '请先配置本地 IndexTTS 环境路径';
  if(!profile?.sampleId)return '请选择已保存的本地声音样本';
  if(!['中文','英语','日语','西班牙语','阿拉伯语'].includes(draft.language||'中文'))return '本地声音模型暂不支持所选语言';
  return '';
 }
 if(v.profile&&!profile?.remoteId)return '声音样本尚未训练，请选择可用音色';
 if(capabilities.windows){if(!installed.some(voice=>voice.name===(v.systemVoice||config.systemVoice)))return '请选择本机实际安装的系统音色';}
 else{
  if(!capabilityBaseUrl(config,'tts'))return '请在模型设置中填写语音服务地址';
  if(!(v.model==='classic'?capabilities.classic:capabilities.fast))return '请在模型设置中填写实际语音模型';
  if(!profile?.remoteId&&!config.voice)return '请选择已接入服务的音色或填写服务音色ID';
 }
 return '';
}
