// 对已有紧凑组件做有锚点的单次接入；锚点不符时停止，不覆盖未知版本。
const fs=require('node:fs');
function change(file,pairs){let source=fs.readFileSync(file,'utf8');for(const [from,to] of pairs){if(source.split(from).length!==2)throw Error('接入锚点不唯一：'+file+' / '+from);source=source.replace(from,to);}fs.writeFileSync(file,source);}
change('src/components/ResourceStudio.vue',[
 ["import {inject,ref,onUnmounted} from 'vue';","import {inject,ref,onUnmounted} from 'vue';import VoiceDesign from './VoiceDesign.vue';"],
 ["const props=defineProps({page:String});","const designing=ref(false);const props=defineProps({page:String});"],
 ["</p></div></header><div class=\"studio-form-body\" :class=\"{'avatar-form':page==='avatars'}\"","</p></div><button v-if=\"page==='voices'\" class=\"voice-design-entry\" :disabled=\"!!busy||sampleWorking||recordingWorking\" @click=\"designing=true\">设计新音色</button></header><div class=\"studio-form-body\" :class=\"{'avatar-form':page==='avatars'}\""],
 ["<template><div class=\"resource-studio\"","<template><VoiceDesign v-if=\"designing\" @close=\"designing=false\"/><div class=\"resource-studio\""]
]);
change('src/App.vue',[["'voice-import','voice-preview','voice-trim','voice-recording'].includes(run.type)","'voice-import','voice-preview','voice-trim','voice-recording','voice-design'].includes(run.type)"],["'voice-import','voice-preview','voice-trim','voice-recording'].includes(activeRecognition.type)","'voice-import','voice-preview','voice-trim','voice-recording','voice-design'].includes(activeRecognition.type)"]]);
change('server/service.cjs',[["'indexttsHome','musetalkHome'","'indexttsHome','voiceDesignHome','musetalkHome'"]]);
change('server/voice-design.cjs',[["savedAfterUserAudition:true","savedByUser:true"]]);
change('src/views/SettingsView.vue',[
 ["async function checkAsr()", "async function checkVoiceDesign(){if(!await save())return;const result=await act('检查自主音色环境',()=>call('checkVoiceDesign'));if(result)showDialog('自主音色环境检查通过','模型、固定依赖与CUDA检查通过。\\n'+result.home+'\\n此检查没有执行声音生成，效果需要实际试听。');}\nasync function checkAsr()"],
 ['<label class="settings-field">声音克隆训练接口', '<label class="settings-field">自主音色环境路径<input v-model="config.provider.voiceDesignHome" aria-label="自主音色环境路径" placeholder="D:/AI-Runtimes/super-ip/qwen3-tts-voice-design"/></label><button :disabled="!!busy" @click="checkVoiceDesign">检查自主音色环境</button><p class="hint">在声音管理中打开“设计新音色”，通过文字描述生成并试听，保存后可作为本地配音参考。</p><label class="settings-field">声音克隆训练接口']
]);
const file='package.json',pkg=JSON.parse(fs.readFileSync(file,'utf8'));
for(const list of [pkg.build.files,pkg.build.asarUnpack]){if(list.includes('integrations/qwen-voice-design/**/*'))throw Error('打包项已经存在');list.push('integrations/qwen-voice-design/**/*');}
fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
