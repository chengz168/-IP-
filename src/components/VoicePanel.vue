<script setup>
import {ref} from 'vue';
import I from './Icon.vue';
import DropdownSelect from './DropdownSelect.vue';
import MediaPreview from './MediaPreview.vue';
import VoiceUpload from './VoiceUpload.vue';
import VoicePresetLibrary from './VoicePresetLibrary.vue';
import {useVoiceControls} from '../use-voice-controls.mjs';
const emit=defineEmits(['choose','generate','translate']);
const previewAudio=ref();
const {d,state,workflowLocked,advanced,upload,presets,voiceError,loading,playing,previewing,capabilities,locked,selected,options,generationReason,emotionItems,emotionLabel,stop,preview,loadVoices,generate}=useVoiceControls({emit,previewAudio});
</script>
<template>
 <div class="voice-columns voice-studio">
  <article class="card text-card voice-copy"><div class="card-heading"><h3>最终文案</h3><div class="voice-language"><DropdownSelect v-model="d.language" aria-label="语言" variant="voice" :disabled="locked" :options="['中文','英语','日语','韩语','西班牙语']"/><button :disabled="locked||!d.finalText.trim()" @click="emit('translate')">翻译</button></div></div><div class="voice-copy-editor"><textarea v-model="d.finalText" class="large-text" :readonly="workflowLocked" aria-label="最终文案" placeholder="请输入最终配音文案"></textarea><span class="word-count" :class="{over:d.finalText.length>1500}" :title="'参考界面计数提示；当前引擎实际支持10000字以内'">{{d.finalText.length}} / 1500 字</span></div><p class="hint">配音将使用这里的最终文案生成，修改后会清空旧配音结果。当前引擎最多支持10000字。</p></article>
  <div class="stack voice-stack"><article class="card voice-config"><div class="card-heading"><h3>声音配置</h3><div class="voice-heading-actions"><button class="pill" :disabled="locked||!capabilities.local" :title="capabilities.local?'选择本地预设音色':'本地预设用于本地 IndexTTS 配音'" @click="stop();presets=true">预设声音</button><button class="pill" :disabled="locked" @click="stop();upload=true">上传声音</button></div></div>
   <div class="voice-choice-row"><DropdownSelect v-model="selected" :disabled="locked||loading" :options="options" variant="voice" aria-label="选择声音"/><button class="voice-audition" :disabled="(locked&&!playing)||loading||previewing" :title="playing?'停止试听':previewing?'正在合成试听':'试听当前声音'" :aria-label="playing?'停止试听':'试听当前声音'" @click="preview"><I :name="previewing?'LoaderCircle':playing?'Square':'PlayCircle'" :class="{spin:previewing}" :size="19"/></button></div>
   <p v-if="voiceError" class="voice-error" role="alert">{{voiceError}} <button class="text-button" :disabled="locked" @click="loadVoices">重新读取</button></p>
   <div class="voice-model-row"><strong>生成模型</strong><div class="voice-models" role="group" aria-label="声音生成模型" :title="capabilities.modelRouting?'按设置中的真实模型ID选择':'当前引擎没有两个不同的模型路由'"><button v-for="[id,label] in [['classic','经典模型'],['fast','快速模型']]" :key="id" :class="{active:d.voice.model===id}" :aria-pressed="d.voice.model===id" :disabled="locked||!capabilities.modelRouting" @click="d.voice.model=id">{{label}}</button></div></div>
   <button class="voice-advanced-toggle" :aria-expanded="advanced" aria-controls="voice-advanced-options" @click="advanced=!advanced"><I :name="advanced?'ChevronUp':'ChevronDown'" :size="14"/>高级设置</button>
   <div v-if="advanced" id="voice-advanced-options" class="voice-advanced-grid"><div class="voice-speed"><label for="voice-speed">语速<output>{{Number(d.voice.speed).toFixed(2)}}x</output></label><input id="voice-speed" v-model.number="d.voice.speed" :style="{'--voice-progress':((Number(d.voice.speed)-0.5)/1.5*100)+'%'}" type="range" :disabled="locked" min="0.5" max="2" step="0.05" aria-label="声音语速"/></div><div class="voice-emotion"><label>情绪类型<span>{{emotionLabel}}</span></label><div><DropdownSelect v-model="d.voice.emotion" :options="emotionItems" variant="voice" :disabled="locked||!!d.voice.prosodyReferenceId" aria-label="情绪类型"/><input v-model.number="d.voice.strength" type="number" min="0" max="1" step="0.1" :disabled="locked||!capabilities.emotions||!!d.voice.prosodyReferenceId||!d.voice.emotion||['normal','正常'].includes(d.voice.emotion)" aria-label="情绪强度" :title="capabilities.emotions?'所选情绪的强度，范围0至1':'当前引擎不支持情绪强度'"/></div></div><div class="voice-prosody"><label>参考韵律<span>{{state.assets.find(a=>a.id===d.voice.prosodyReferenceId)?.name||'未选择'}}</span></label><div class="voice-prosody-actions"><button type="button" :disabled="locked||!capabilities.local" @click="emit('choose','audio',a=>{d.voice.prosodyReferenceId=a.id;d.voice.emotion=''},'选择参考韵律音频')">选择音频</button><button v-if="d.voice.prosodyReferenceId" type="button" class="text-button" :disabled="locked" @click="d.voice.prosodyReferenceId=''">清除</button></div><small>可选；使用参考音频的停顿和语调，默认仍使用 C 的普通模式。</small></div></div>
   <button class="primary voice-generate" :disabled="locked||loading||!!generationReason" :title="generationReason||'使用当前文案及音色实际生成音频'" @click="generate"><I name="Volume2" :size="18"/>生成声音</button>
   <p class="voice-engine-note" :title="generationReason||'当前协议尚未验证情绪控制能力'">{{generationReason||(capabilities.local?'本地 IndexTTS · 支持情绪向量和语速':capabilities.windows?'本机系统配音 · 情绪暂不支持':capabilities.modelRouting?'按已配置模型生成 · 情绪暂不支持':'使用设置中的语音模型 · 情绪暂不支持')}}</p>
  </article><article class="card audio-result"><div class="card-heading"><h3>{{capabilities.windows?'系统朗读结果':'声音生成结果'}}</h3><button class="text-button" :disabled="locked" @click="stop();emit('choose','audio',a=>d.voice.audioId=a.id,'选择已有音频')">导入音频</button></div><MediaPreview :id="d.voice.audioId" type="audio" title="生成的音频将在这里显示" description="完成生成后可在此处播放预览"/></article></div>
 </div>
 <audio ref="previewAudio" class="voice-preview-player" aria-hidden="true" preload="metadata"/>
 <VoiceUpload v-if="upload" @close="upload=false"/>
 <VoicePresetLibrary v-if="presets" @close="presets=false" @select="id=>selected='sample:'+id"/>
</template>
