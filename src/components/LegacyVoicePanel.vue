<script setup>
import {ref,useId} from 'vue';
import I from './Icon.vue';
import DropdownSelect from './DropdownSelect.vue';
import MediaPreview from './MediaPreview.vue';
import VoiceUpload from './VoiceUpload.vue';
import {useVoiceControls} from '../use-voice-controls.mjs';
const emit=defineEmits(['generate','choose']);
const previewAudio=ref();
const voiceId=useId();
const {d,state,advanced,upload,voiceError,loading,playing,previewing,capabilities,locked,selected,options,generationReason,emotionItems,stop,preview,loadVoices,generate}=useVoiceControls({emit,previewAudio});
</script>
<template>
 <article class="legacy-card legacy-voice">
  <header><span><I name="Volume2"/></span><h3>3. 声音生成</h3><button class="text-button" :disabled="locked" @click="stop();upload=true">上传声音</button></header>
  <div class="legacy-card-body">
   <label :for="voiceId">选择声音</label>
   <div class="legacy-voice-choice"><DropdownSelect :id="voiceId" v-model="selected" :options="options" :disabled="locked||loading" variant="voice" aria-label="旧工作流选择声音"/><button class="legacy-voice-audition" :disabled="(locked&&!playing)||loading||previewing" :aria-label="playing?'停止试听':'试听当前声音'" :title="previewing?'正在合成试听':playing?'停止试听':'试听当前声音'" @click="preview"><I :name="previewing?'LoaderCircle':playing?'Square':'PlayCircle'" :class="{spin:previewing}" :size="19"/></button></div>
   <p v-if="voiceError" class="voice-error" role="alert">{{voiceError}} <button class="text-button" :disabled="locked" @click="loadVoices">重新读取</button></p>
   <button class="legacy-voice-toggle" :aria-expanded="advanced" aria-controls="legacy-voice-more" @click="advanced=!advanced"><I :name="advanced?'ChevronUp':'ChevronDown'" :size="14"/>更多设置</button>
   <div v-if="advanced" id="legacy-voice-more" class="legacy-voice-more">
    <label>语速 <output>{{Number(d.voice.speed).toFixed(2)}}x</output><input v-model.number="d.voice.speed" type="range" min="0.5" max="2" step="0.05" :disabled="locked" aria-label="旧工作流声音语速"/></label>
    <label>生成模型<select v-model="d.voice.model" :disabled="locked||!capabilities.modelRouting" aria-label="旧工作流声音模型" :title="capabilities.modelRouting?'按实际配置的模型ID生成':'当前引擎没有两个不同的模型路由'"><option value="classic">经典模型</option><option value="fast">快速模型</option></select></label>
    <label>情绪类型<DropdownSelect v-model="d.voice.emotion" :options="emotionItems" :disabled="locked||!!d.voice.prosodyReferenceId" variant="voice" aria-label="旧工作流情绪类型"/></label>
    <label class="legacy-voice-prosody">参考韵律音频 <span>{{state.assets.find(a=>a.id===d.voice.prosodyReferenceId)?.name||'未选择'}}</span><button type="button" :disabled="locked||!capabilities.local" @click="emit('choose','audio',a=>{d.voice.prosodyReferenceId=a.id;d.voice.emotion=''},'选择参考韵律音频')">选择音频</button><button v-if="d.voice.prosodyReferenceId" type="button" class="text-button" :disabled="locked" @click="d.voice.prosodyReferenceId=''">清除</button></label>
   </div>
   <button class="primary full legacy-voice-generate" :disabled="locked||loading||!!generationReason" :title="generationReason||'使用最终文案生成真实音频'" @click="generate"><I name="Volume2" :size="16"/>生成声音</button>
   <p class="legacy-voice-note" role="status">{{generationReason||(capabilities.local?'本地 IndexTTS · 支持情绪向量和语速':capabilities.windows?'本机系统配音 · 情绪暂不支持':'使用已配置的语音服务 · 情绪暂不支持')}}</p>
   <h3>{{capabilities.windows?'系统朗读结果':'声音生成结果'}}</h3>
   <MediaPreview :id="d.voice.audioId" type="audio" title="生成的音频将在这里显示"/>
  </div>
  <audio ref="previewAudio" class="voice-preview-player" aria-hidden="true" preload="metadata"/>
 </article>
 <VoiceUpload v-if="upload" @close="upload=false"/>
</template>
