<script setup>
import {computed,inject,ref,watch,onBeforeUnmount} from 'vue';import I from '../components/Icon.vue';import {call} from '../api';import Modal from '../components/Modal.vue';
import PromptManager from '../components/PromptManager.vue';
import ModelPicker from '../components/ModelPicker.vue';
import CapabilityKeys from '../components/CapabilityKeys.vue';
import {createKeyDrafts,keyChanges} from '../provider-key-drafts.mjs';
import {createProtocolDrafts,createDiscoveryController,discoveryModels} from '../model-settings.mjs';
import {fontPresets,normalizeFontSize} from '../typography.mjs';
const {state,busy,act,notify,showDialog,refresh}=inject('studio');const config=ref(JSON.parse(JSON.stringify(state.value.settings))),key=ref(''),changeKey=ref(false),tab=ref('general');const desktop=window.studio;const restorePath=ref(''),restoreDialog=ref(false);
const tabs=[['general','常规设置','SettingOutlined'],['models','模型设置','RobotOutlined'],['prompts','提示词管理','FormOutlined'],['data','数据设置','DatabaseOutlined'],['update','软件更新','CloudDownloadOutlined']];
const keyDrafts=ref(createKeyDrafts());
Object.assign(config.value.provider,{visionProtocol:config.value.provider.visionProtocol||'ollama',visionBaseUrl:config.value.provider.visionBaseUrl||'',visionModel:config.value.provider.visionModel||'',ttsBaseUrl:config.value.provider.ttsBaseUrl||'',asrBaseUrl:config.value.provider.asrBaseUrl||'',avatarProtocol:config.value.provider.avatarProtocol||'compatible'});
const protocolDrafts=createProtocolDrafts();
function switchProtocol(group,value){protocolDrafts.switch(config.value.provider,group,value);}
const capabilities=['text','vision','tts','asr'];
const discoveries=ref(Object.fromEntries(capabilities.map(name=>[name,{phase:'idle',models:[],message:''}])));
const controllers=Object.fromEntries(capabilities.map(name=>[name,createDiscoveryController(payload=>call('discoverModels',payload),{cancel:payload=>call('cancelModelDiscovery',{requestId:payload.requestId})})]));
function discoverySignature(name){
 const p=config.value.provider;
 const connection=name==='text'?[p.textProtocol,p.baseUrl]:name==='vision'?[p.visionProtocol,p.visionBaseUrl||p.baseUrl]:name==='tts'?[p.ttsProtocol,p.ttsBaseUrl||p.baseUrl,p.indexttsHome]:[p.asrProtocol,p.asrBaseUrl||p.baseUrl,p.asrModelPath,p.asrPythonPath];
 return JSON.stringify({connection,changeKey:changeKey.value,key:key.value,independent:keyDrafts.value[name]});
}
for(const name of capabilities)watch(()=>discoverySignature(name),()=>{controllers[name].invalidate();discoveries.value[name]={phase:'idle',models:[],message:'设置已变化，请刷新读取对应来源的模型。当前配置已保留。'};},{flush:'sync'});
function cancelDiscovery(name){controllers[name].invalidate();discoveries.value[name]={phase:'cancelled',models:[],message:'已取消本次读取，当前配置已保留。'};}
watch(tab,(value,prior)=>{if(prior==='models'&&value!=='models')for(const name of capabilities)if(discoveries.value[name].phase==='loading')cancelDiscovery(name);});
onBeforeUnmount(()=>{for(const name of capabilities)controllers[name].invalidate();});
async function discover(name){
 if(discoveries.value[name].phase==='loading')return;
 let changes;try{changes=keyChanges(keyDrafts.value,{validate:true,only:name});}catch(error){notify(error.message,'error');return;}
 const requestId=crypto.randomUUID(),signature=discoverySignature(name);
 const payload={requestId,capability:name,provider:JSON.parse(JSON.stringify(config.value.provider)),changeKey:changeKey.value,...(changeKey.value?{key:key.value}:{}),capabilityKeys:changes,timeoutMs:12000};
 discoveries.value[name]={phase:'loading',models:[],message:'正在读取当前设置的已有模型…'};
 const response=await controllers[name].run(payload);
 if(response.phase==='stale'||signature!==discoverySignature(name))return;
 if(response.phase!=='result'){discoveries.value[name]={phase:response.phase,models:[],message:response.message};return;}
 const result=response.result;
 try{
  if(!result||result.requestId!==requestId||result.capability!==name||!['ready','empty','unavailable','error','cancelled'].includes(result.status))throw Error('模型发现返回结构无效，请重试。');
  const models=discoveryModels(result,name),phase=result.status==='ready'&&!models.length?'empty':result.status;
  const issues=Array.isArray(result.environment?.issues)?result.environment.issues.filter(issue=>typeof issue==='string').join('；'):'';
  const message=[result.error?.message||result.message,issues,'当前配置已保留；列表或文件检查不代表已验证生成。'].filter(Boolean).join(' ');
  discoveries.value[name]={phase:result.error?.code==='DISCOVERY_TIMEOUT'?'timeout':phase,models,message};
 }catch(error){discoveries.value[name]={phase:'error',models:[],message:error.message};}
}
const extractProtocol=computed({get:()=>config.value.provider.extractProtocol||(config.value.provider.extractUrl?'bridge':'local'),set:value=>config.value.provider.extractProtocol=value});
async function checkLinkExtractor(){if(!await save())return;const r=await act('检查链接解析器',()=>call('checkLinkExtractor'));if(r)showDialog('本地链接解析器可用','yt-dlp '+r.version+'\n版本检查通过，平台链接仍需实际解析验证。');}
async function openExtractBrowser(){const r=await act('打开抖音解析窗口',()=>call('openExtractBrowser'));if(r)showDialog('抖音解析窗口已打开','请在独立窗口中完成登录、验证码或其他平台验证，然后回到工作台点击“提取文案”。解析会使用该窗口的会话，不会读取其他浏览器的Cookie。');}
const currentFontPreset=computed(()=>fontPresets.find(preset=>preset.id===normalizeFontSize(state.value.settings.fontSize)));
async function changeFontSize(id){if(id===normalizeFontSize(state.value.settings.fontSize))return;const result=await act('切换界面字号',()=>call('saveAppearance',{fontSize:id}));if(result){config.value.fontSize=result.fontSize;notify('界面字号已切换为'+fontPresets.find(preset=>preset.id===id).label,'success');}}
async function save(){let changes;try{changes=keyChanges(keyDrafts.value,{validate:true});}catch(error){notify(error.message,'error');return false;}const r=await act('保存设置',()=>call('saveSettings',{...config.value,...(changeKey.value?{key:key.value}:{}),capabilityKeys:changes}));if(r){key.value='';changeKey.value=false;keyDrafts.value=createKeyDrafts();notify('设置已保存','success');}return r;}
async function check(action){if(!await save())return;const r=await act('检查连接',()=>call(action));if(r)showDialog(action==='checkMedia'?'媒体工具可用':'模型服务已连接',action==='checkMedia'?r.ffmpeg+'\n'+r.ffprobe:'服务返回 '+r.models.length+' 个模型。\n'+r.models.slice(0,15).join('、'));}
async function directory(){if(window.studio){const dir=await window.studio.chooseDirectory();if(dir)config.value.outputDir=dir;}else notify('浏览器预览中请填写绝对路径；桌面程序可打开文件夹选择器');}
async function backup(){const r=await act('备份任务与素材',()=>call('backup'));if(r)showDialog('备份已导出',r.directory+'\n已复制 '+r.assets+' 项素材。\n'+r.note);}
async function restoreDirectory(){if(desktop){const directory=await desktop.chooseDirectory();if(directory)restorePath.value=directory;}}
async function restore(){restoreDialog.value=false;const r=await act('恢复任务与素材',()=>call('restoreBackup',{directory:restorePath.value}));if(r){await refresh(true);protocolDrafts.clear();config.value=JSON.parse(JSON.stringify(state.value.settings));showDialog('恢复完成','已恢复 '+r.drafts+' 个任务、'+r.assets+' 项素材。\n恢复前副本：'+r.safetyDirectory+'\n'+r.note);}}
function useOllama(){switchProtocol('text','ollama');config.value.mode='own';config.value.provider.baseUrl='http://127.0.0.1:11434/v1';config.value.provider.textMaxTokens='2048';notify('已在设置草稿中填写本机地址，保存后生效；请刷新读取已有模型。');}
async function checkLocalSpeech(){
 if(!await save())return;
 const r=await act('检查本地声音环境',()=>call('checkLocalSpeech'));if(!r)return;
 const lines=['环境目录：'+r.home,
  '独立 Python：'+(r.pythonPresent?'已找到':'缺失'),
  '依赖安装：'+(r.dependenciesInstalled?'已完成且版本一致':'尚未就绪')];
 if(r.cuda!==null)lines.push('CUDA：'+(r.cuda?'可用':'不可用')+' · Torch '+r.torch);
 else lines.push('Torch / CUDA：尚未检查');
 if(r.issues.length)lines.push(...r.issues);
 if(r.missingModels.length)lines.push('缺失模型或下载记录（'+r.missingModels.length+'项）：',...r.missingModels);
 if(!r.dependenciesInstalled)lines.push('请先查看原安装日志，安装进程仍在运行时不要重复安装。');
 else if(r.missingModels.length)lines.push('请补齐已确认来源的模型文件及下载记录，再重新检查。');
 lines.push('尚未执行声音推理，生成效果需要实际试听验收。');
 showDialog(r.ready?'本地声音环境检查通过':'本地声音环境尚未就绪',lines.join('\n'));
}
async function checkLocalLipSync(){
 if(!await save())return;
 const r=await act('检查本地口型环境',()=>call('checkLocalLipSync'));if(!r)return;
 const missing=[...r.models,...r.sources].filter(item=>!item.present);
 const lines=['环境目录：'+r.home,'独立 Python：'+(r.isolatedPython?'匹配':'不匹配'),'模型与固定源码：'+(r.readyForCandidateTrial?'校验通过':'尚未就绪'),'CUDA：'+(r.device.cuda?'可用':'不可用')];
 if(missing.length)lines.push('缺失文件：'+missing.length+'项');
 const failed=r.dependencyImports.filter(item=>!item.ok);if(failed.length)lines.push(...failed.map(item=>item.name+'：'+item.error));
 lines.push('此检查不执行视频推理，生成效果请在实际视频中检查。');
 showDialog(r.readyForCandidateTrial?'本地口型环境检查通过':'本地口型环境尚未就绪',lines.join('\n'));
}
async function checkVoiceDesign(){if(!await save())return;const result=await act('检查自主音色环境',()=>call('checkVoiceDesign'));if(result)showDialog('自主音色环境检查通过','模型、固定依赖与CUDA检查通过。\n'+result.home+'\n此检查没有执行声音生成，效果需要实际试听。');}
async function checkAsr(){if(!await save())return;const r=await act('检查本地识别模型',()=>call('checkLocalAsr'));if(r)showDialog('本地识别模型可用','已成功加载已有模型。\nfaster-whisper '+r.version+' · CPU / int8\n可返回带时间轴的识别结果，实际文字请在生成后校对。');}

const headings={general:['常规设置','配置文件存储路径等基本选项'],models:['模型设置','配置AI模型相关参数'],prompts:['提示词管理','管理和自定义AI提示词模板'],data:['数据设置','任务、素材备份与恢复等数据相关设置'],update:['软件更新','查看当前软件版本与更新服务状态']};
const currentHeading=computed(()=>headings[tab.value]);
</script>

<template>
<section class="management-page settings-page"><div class="settings-layout">
  <aside class="settings-nav"><header><I name="SettingOutlined" :size="currentFontPreset.pageTitle"/><h1>设置</h1></header><nav aria-label="设置分类"><button v-for="[id,label,icon] in tabs" :key="id" :class="{active:tab===id}" @click="tab=id"><I :name="icon" :size="currentFontPreset.body"/>{{label}}</button></nav><footer>本地版本 0.1.0</footer></aside>
  <article class="settings-content"><header class="settings-heading"><h2>{{currentHeading[0]}}</h2><p>{{currentHeading[1]}}</p></header>
  <div :key="tab" class="settings-body" :class="'settings-'+tab">
    <template v-if="tab==='general'">
      <div class="settings-form-section">
        <label class="settings-field">界面主题<select v-model="config.theme" class="short-control"><option value="default">默认主题</option><option value="midnight">午夜蓝</option></select></label><p class="hint">选择应用的配色主题，保存后生效</p>
        <span class="settings-field field-title">界面字号</span><div class="segmented settings-choice" role="group" aria-label="界面字号"><button v-for="preset in fontPresets" :key="preset.id" :class="{active:normalizeFontSize(state.settings.fontSize)===preset.id}" :aria-pressed="normalizeFontSize(state.settings.fontSize)===preset.id" :disabled="!!busy" @click="changeFontSize(preset.id)">{{preset.label}}</button></div><p class="hint">调整应用内菜单、表单、按钮、表格和提示文字大小，更换后立即生效</p>
      </div>
      <div class="settings-form-section"><span class="field-title">默认工作流视图</span><div class="radio-group"><label><input v-model="config.view" type="radio" value="new"/>新工作流</label><label><input v-model="config.view" type="radio" value="old"/>旧工作流</label></div><p class="hint">下次启动时使用此视图</p></div>
      <div class="settings-form-section"><label class="settings-field">统一输出根目录<div class="inline"><input v-model="config.outputDir" placeholder="留空时使用本地数据目录下的 outputs"/><button @click="directory">选择</button></div></label><p class="hint">保存剪辑视频、封面和发布包</p></div>
      <div class="settings-form-section"><h3>媒体工具</h3><p class="hint">本地剪辑、音频抽取、截帧需要FFmpeg与FFprobe。</p><label class="settings-field">FFmpeg路径<input v-model="config.ffmpegPath" placeholder="ffmpeg.exe 的完整路径，或留空使用PATH"/></label><label class="settings-field">FFprobe路径<input v-model="config.ffprobePath" placeholder="ffprobe.exe 的完整路径，或留空使用PATH"/></label><button :disabled="!!busy" @click="check('checkMedia')">检查媒体工具</button></div>
      <div class="settings-form-section"><h3>字幕字体</h3><label class="settings-field">本地字体目录<input v-model="config.subtitleFontsDir" placeholder="选填，填写已有 TTF、OTF、TTC 字体所在目录"/></label><p class="hint">自动读取系统字体；指定目录后还可选择其中的已有字体。</p></div>
      <div class="settings-form-section"><h3>本地人物与背景优化</h3><p class="hint">在视频配置中打开“优化形象”，生成独立副本后选用。保留本人身份、衣着与动作；旧成片需重新生成。</p><label class="settings-field">画面处理 Python<input v-model="config.provider.portraitPython" aria-label="画面处理Python路径" placeholder="包含 numpy、Pillow 的 Python 完整路径"/></label><label class="settings-field">RVM 人像抠像模型<input v-model="config.provider.portraitModel" aria-label="人像抠像模型路径" placeholder="本机 rvm_mobilenetv3_fp32.onnx 完整路径"/></label><p class="hint">自然画面处理使用本机媒体工具；替换背景还需要该 Python 环境安装 onnxruntime，并配置已有 RVM 模型。任务不会自动下载模型。</p></div>
      <div class="settings-footer"><button class="primary" :disabled="!!busy" @click="save">保存设置</button></div>
    </template>
    <template v-else-if="tab==='models'">
      <div class="settings-form-section"><span class="field-title">按能力选择模型来源</span><p class="hint">文本、视觉、语音合成和语音识别可分别选择云端兼容服务或已有本机引擎。刷新只读取列表或已有文件，不自动保存设置、下载模型或生成内容。</p></div>
      <div class="settings-form-section"><h3>全局服务密钥</h3><label class="settings-field">API Key</label><div class="inline"><input v-model="key" type="password" autocomplete="new-password" :placeholder="state.keyConfigured?'已配置，填写后勾选更新':'尚未配置'" aria-label="API Key"/><label class="check-row"><input v-model="changeKey" type="checkbox"/>更新密钥</label></div><p class="hint">未设置独立密钥的能力沿用此项。勾选更新后留空保存可清除全局密钥。桌面版使用Windows加密存储；浏览器预览仅在本次服务进程中使用。</p></div>
      <CapabilityKeys :drafts="keyDrafts" :configured="state.capabilityKeyConfigured" :global-configured="state.keyConfigured"/>
      <div class="settings-form-section"><h3>文本模型</h3>
        <div class="two-fields"><label>文本来源<select :value="config.provider.textProtocol" aria-label="文本接入方式" @change="switchProtocol('text',$event.target.value)"><option value="compatible">云端 / 自有兼容聊天服务</option><option value="ollama">本机 Ollama 已有模型</option></select></label><label>文本输出上限<input v-model="config.provider.textMaxTokens" type="number" min="64" max="32768" placeholder="2048"/></label></div>
        <label class="settings-field">文本等待时间（秒）<input v-model="config.provider.textTimeoutSeconds" type="number" min="30" max="1800" step="1" :placeholder="config.provider.textProtocol==='ollama'?'留空默认600秒':'留空默认180秒'"/></label><p class="hint">可填写30至1800的整数秒；留空时本机Ollama默认600秒，云端兼容服务默认180秒。仅影响文本生成，点击停止仍立即中断本次等待。</p>
        <button @click="useOllama">填写本机Ollama地址</button>
        <template v-if="config.provider.textProtocol==='ollama'"><label class="settings-field">本地上下文长度<input v-model="config.provider.textContextTokens" type="number" min="512" step="1" placeholder="留空使用本地服务默认值"/></label><p class="hint">短文可尝试8192；更大上下文占用更多内存。长文超出输入预算时需调大。</p></template>
        <label class="settings-field">文本服务 Base URL<input v-model="config.provider.baseUrl" aria-label="文本服务 Base URL" placeholder="填写服务完整地址，例如 http://127.0.0.1:11434/v1"/></label>
        <ModelPicker label="文本模型" :model-value="config.provider.model" :models="discoveries.text.models" :phase="discoveries.text.phase" :message="discoveries.text.message" :allow-manual="config.provider.textProtocol==='compatible'" @update:model-value="config.provider.model=$event" @refresh="discover('text')" @cancel="cancelDiscovery('text')"/>
      </div>
      <div class="settings-form-section material-model-settings"><h3>素材视觉标记</h3><div class="two-fields"><label>视觉接入方式<select :value="config.provider.visionProtocol" @change="switchProtocol('vision',$event.target.value)" aria-label="视觉接入方式"><option value="ollama">本机 Ollama 已有模型</option><option value="compatible">云端 / 自有兼容多模态服务</option></select></label><span class="hint">模型能力以发现结果为准，未知能力不会标记为支持。</span></div><label class="settings-field">视觉服务地址<input v-model="config.provider.visionBaseUrl" aria-label="视觉服务地址" placeholder="留空沿用Base URL"/></label><ModelPicker label="视觉模型" :model-value="config.provider.visionModel" :models="discoveries.vision.models" :phase="discoveries.vision.phase" :message="discoveries.vision.message" :allow-manual="config.provider.visionProtocol==='compatible'" @update:model-value="config.provider.visionModel=$event" @refresh="discover('vision')" @cancel="cancelDiscovery('vision')"/><button @click="switchProtocol('vision','ollama');config.provider.visionBaseUrl='http://127.0.0.1:11434'">填写本机视觉地址</button><p class="hint">视觉列表只读取服务现有元数据，不下载模型、不执行视觉推理。</p></div>
      <div class="settings-form-section"><h3>语音合成方式</h3><label class="settings-field">语音来源<select aria-label="语音接入" :value="config.provider.ttsProtocol" @change="switchProtocol('tts',$event.target.value)"><option value="compatible">云端 / 自有兼容语音服务</option><option value="indextts-local">本机 IndexTTS 已有环境</option><option value="windows">本机 Windows 系统音色</option></select></label><template v-if="config.provider.ttsProtocol==='compatible'"><label class="settings-field">TTS服务地址<input aria-label="TTS服务地址" v-model="config.provider.ttsBaseUrl" placeholder="留空沿用文本服务 Base URL"/></label><ModelPicker label="TTS模型" :model-value="config.provider.ttsModel" :models="discoveries.tts.models" :phase="discoveries.tts.phase" :message="discoveries.tts.message" allow-manual @update:model-value="config.provider.ttsModel=$event" @refresh="discover('tts')" @cancel="cancelDiscovery('tts')"/></template><template v-if="config.provider.ttsProtocol==='indextts-local'"><label class="settings-field">本地声音环境路径<input v-model="config.provider.indexttsHome" placeholder="D:/AI-Runtimes/super-ip/indextts-2.5" aria-label="本地声音环境路径"/></label><ModelPicker fixed label="IndexTTS 环境" :models="discoveries.tts.models" :phase="discoveries.tts.phase" :message="discoveries.tts.message" @refresh="discover('tts')" @cancel="cancelDiscovery('tts')"/><button :disabled="!!busy" @click="checkLocalSpeech">保存并检查本地声音环境</button><p class="hint">刷新列表仅检查已有目录文件；“保存并检查”另行保存配置并执行完整环境检查。</p></template><template v-if="config.provider.ttsProtocol==='windows'"><p class="hint">使用本机已安装的系统音色朗读最终文案，音色效果需要试听。</p><ModelPicker label="系统音色" :model-value="config.provider.systemVoice" :models="discoveries.tts.models" :phase="discoveries.tts.phase" :message="discoveries.tts.message" @update:model-value="config.provider.systemVoice=$event" @refresh="discover('tts')" @cancel="cancelDiscovery('tts')"/></template><label class="settings-field">默认音色ID<input v-model="config.provider.voice" placeholder="服务实际提供的音色ID"/></label></div>
      <div class="settings-form-section asr-settings"><h3>语音识别</h3><div class="two-fields"><label>识别接入方式<select :value="config.provider.asrProtocol" @change="switchProtocol('asr',$event.target.value)" aria-label="识别接入方式"><option value="compatible">云端 / 自有兼容识别服务</option><option value="local-whisper">本机 Whisper 已有模型</option></select></label><label v-if="config.provider.asrProtocol==='local-whisper'">识别语言<select v-model="config.provider.asrLanguage" aria-label="识别语言"><option value="zh">中文</option><option value="auto">自动识别语言</option><option value="en">英文</option></select></label></div><template v-if="config.provider.asrProtocol==='compatible'"><label class="settings-field">ASR服务地址<input aria-label="ASR服务地址" v-model="config.provider.asrBaseUrl" placeholder="留空沿用文本服务 Base URL"/></label><ModelPicker label="ASR模型" :model-value="config.provider.asrModel" :models="discoveries.asr.models" :phase="discoveries.asr.phase" :message="discoveries.asr.message" allow-manual @update:model-value="config.provider.asrModel=$event" @refresh="discover('asr')" @cancel="cancelDiscovery('asr')"/></template><template v-if="config.provider.asrProtocol==='local-whisper'"><label class="settings-field">Python解释器路径<input v-model="config.provider.asrPythonPath" placeholder="已安装faster-whisper的python.exe完整路径"/></label><label class="settings-field">本地Whisper模型目录<input v-model="config.provider.asrModelPath" placeholder="含model.bin、config.json和tokenizer.json的目录"/></label><ModelPicker fixed label="本地 Whisper 环境" :models="discoveries.asr.models" :phase="discoveries.asr.phase" :message="discoveries.asr.message" @refresh="discover('asr')" @cancel="cancelDiscovery('asr')"/><p class="hint">只检查已有模型目录，文件齐备不等于已验证生成。</p><button :disabled="!!busy" @click="checkAsr">保存并检查本地模型</button></template></div>
      <div class="settings-form-section"><h3>独立能力服务桥</h3><p class="hint">填入已部署并支持对应能力的服务地址。</p><label class="settings-field">视频接入方式<select v-model="config.provider.avatarProtocol" aria-label="视频接入方式"><option value="compatible">兼容口型服务桥</option><option value="comfy-h3">ComfyUI 本地 H3</option><option value="musetalk-local">MuseTalk 本地口型</option></select></label><template v-if="config.provider.avatarProtocol==='musetalk-local'"><label class="settings-field">本地口型环境路径<input v-model="config.provider.musetalkHome" placeholder="D:/AI-Runtimes/super-ip/musetalk-1.5" aria-label="本地口型环境路径"/></label><button :disabled="!!busy" @click="checkLocalLipSync">检查本地口型环境</button><p class="hint">使用形象原动作和背景，生成对应配音的新口型。支持1至600秒单形象和多镜头，素材不足时往返复用动作；多镜头按首镜头画幅等比补边；实际口型、牙齿及嘴周效果请检查。</p></template><label v-else class="settings-field">{{config.provider.avatarProtocol==='comfy-h3'?'ComfyUI 本机地址':'数字人口型生成接口'}}<input v-model="config.provider.avatarUrl" :placeholder="config.provider.avatarProtocol==='comfy-h3'?'http://127.0.0.1:8188':'填写实际口型服务的完整提交地址'" aria-label="视频生成服务地址"/></label><p v-if="config.provider.avatarProtocol==='comfy-h3'" class="hint">使用已有 H3 权重，支持单形象、长片分段和多镜头生成。人物画面重新生成，原驱动音轨用于最终封装；已完成本地成片与导出验证，连续口型、听感和参考效果仍待验收。</p><div v-if="config.provider.ttsProtocol!=='windows'" class="two-fields"><label>经典模型ID（选填）<input v-model="config.provider.ttsClassicModel" placeholder="留空使用通用TTS模型"/></label><label>快速模型ID（选填）<input v-model="config.provider.ttsFastModel" placeholder="留空使用通用TTS模型"/></label></div><label class="settings-field">自主音色环境路径<input v-model="config.provider.voiceDesignHome" aria-label="自主音色环境路径" placeholder="D:/AI-Runtimes/super-ip/qwen3-tts-voice-design"/></label><button :disabled="!!busy" @click="checkVoiceDesign">检查自主音色环境</button><p class="hint">在声音管理中打开“设计新音色”，通过文字描述生成并试听，保存后可作为本地配音参考。</p><label class="settings-field">声音克隆训练接口<input v-model="config.provider.cloneUrl" placeholder="填写克隆服务桥的完整地址"/></label><div class="link-extract-settings"><h3>分享链接提取</h3><label class="settings-field">链接提取方式<select v-model="extractProtocol" aria-label="链接提取方式"><option value="local">本地解析与语音识别</option><option value="browser-session">抖音浏览器会话解析</option><option value="bridge">外部提取服务</option></select></label><template v-if="extractProtocol==='local'"><label class="settings-field">链接解析 Python<input v-model="config.provider.extractPythonPath" aria-label="链接解析Python路径" placeholder="已安装Python解释器的完整路径"/></label><label class="settings-field">yt-dlp 包目录<input v-model="config.provider.extractPackagePath" aria-label="yt-dlp 包目录" placeholder="包含yt_dlp文件夹的目录"/></label><button :disabled="!!busy" @click="checkLinkExtractor">保存并检查链接解析器</button><p class="hint">下载单条视频的真实音轨，使用上方配置的语音识别提取正文。登录或平台验证失败会显示原因，可改用本地文件导入。</p></template><template v-else-if="extractProtocol==='browser-session'"><button :disabled="!!busy" @click="openExtractBrowser">打开抖音解析窗口</button><p class="hint">使用独立持久化浏览器会话完成抖音验证或登录，再回到工作台提取。会话只在解析时导出到临时文件，解析结束立即删除。</p></template><label v-else class="settings-field">分享链接提取接口<input v-model="config.provider.extractUrl" placeholder="填写链接解析与提取文案接口地址"/></label></div><label class="settings-field">账号主页文案采集接口<input v-model="config.provider.brainUrl" aria-label="账号主页文案采集接口" placeholder="选填，填写返回name和samples的真实文案采集服务"/></label><p class="hint">此接口仅负责采集真实文案样本，风格分析仍使用当前文本模型；未配置时可在IP大脑导入本地学习样本。</p></div>
      <div class="settings-footer"><button class="primary" :disabled="!!busy" @click="save">保存设置</button></div>
    </template>
    <template v-else-if="tab==='prompts'"><PromptManager/></template>
    <template v-else-if="tab==='data'">
      <div class="settings-form-section"><h3>数据备份与恢复</h3><button class="primary" :disabled="!!busy" @click="backup"><I name="Download"/>导出备份</button><p class="hint">复制任务、素材文件与执行记录，逐个计算校验值，不包含API Key。</p><p class="hint">备份保存到本地数据目录的backups文件夹，历史发布包需另外保留。</p></div>
      <div class="settings-form-section"><label class="settings-field">恢复备份文件夹<div class="inline"><input v-model="restorePath" placeholder="包含manifest.json的备份文件夹绝对路径"/><button v-if="desktop" @click="restoreDirectory">选择文件夹</button></div></label><button :disabled="!!busy||!restorePath.trim()" @click="restoreDialog=true">恢复任务与素材</button><p class="hint">恢复前自动保存当前数据副本。保留当前模型连接、密钥、输出目录和媒体工具路径。</p></div>
      <div class="settings-form-section"><h3>查看输出文件</h3><button @click="desktop?desktop.openOutput():showDialog('输出目录',config.outputDir||'项目 data/outputs 目录')"><I name="FolderOpen"/>打开目录</button><p class="hint">打开剪辑视频、封面和发布包所在目录</p></div><div class="data-counts"><p>创作任务：{{state.drafts.length}}</p><p>素材文件：{{state.assets.length}}</p><p>执行记录：{{state.runs.length}}</p></div>
    </template>
    <div v-else class="version-card"><span class="brand-symbol"><I name="Play" :size="28"/></span><h2>超级IP智能体</h2><strong>本地开发版 0.1.0</strong><p class="hint">参考界面版本：轻语IP 8.4.0</p><p>当前没有配置在线更新服务。</p></div>
  </div></article>
</div>
<Modal v-if="restoreDialog" title="确认恢复备份" @close="restoreDialog=false"><p>恢复将替换当前任务、资源列表及执行记录，并复制备份中的素材。当前数据会先保存为恢复前副本。</p><p class="hint">{{restorePath}}</p><template #footer><button @click="restoreDialog=false">取消</button><button class="primary" @click="restore">确认恢复</button></template></Modal>
</section>
</template>
