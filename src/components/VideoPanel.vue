<script setup>
import {computed,inject,ref} from 'vue';
import I from './Icon.vue';
import VideoResult from './VideoResult.vue';
import AvatarSelect from './AvatarSelect.vue';
import DropdownSelect from './DropdownSelect.vue';
import VideoShotsEditor from './VideoShotsEditor.vue';
import VideoDriverAudio from './VideoDriverAudio.vue';
import {shotInputSignature,shotTotal} from '../../server/video-shots.mjs';
const emit=defineEmits(['choose','generate']);
const {state,draft:d,busy,navigate,save,workflowLocked,notify}=inject('studio');
const shotEditor=ref(false),shotSignature=ref('');
const activeVideo=computed(()=>state.value.runs.some(run=>run.draftId===d.value.id&&run.type==='avatar'&&['running','queued','unknown'].includes(run.status)));
const locked=computed(()=>!!busy.value||workflowLocked.value||activeVideo.value);
const localH3=computed(()=>state.value.settings.provider.avatarProtocol==='comfy-h3');
const localMuse=computed(()=>state.value.settings.provider.avatarProtocol==='musetalk-local');
const audioId=computed(()=>d.value.video.audioId||d.value.voice.audioId||'');
const audioAsset=computed(()=>state.value.assets.find(a=>a.id===audioId.value));
const audioSource=computed(()=>audioId.value?d.value.video.audioId?'手动音频':'上一步音频':'未选择');
const total=computed(()=>shotTotal(d.value.video.shots));
// 生成前明确提示缺失输入，与原版无驱动音频时的禁用状态一致。
const generationReason=computed(()=>!audioId.value?'请先选择驱动音频':d.value.video.mode==='multi'?!d.value.video.shots.length?'请先配置镜头':d.value.video.shots.some(shot=>!shot.avatarId)?'请为每个镜头选择形象':'':!d.value.video.avatarId?'请先选择形象':'');
function mode(value){if(locked.value)return;d.value.video.mode=value;if(value==='multi'&&!d.value.video.shots.length)d.value.video.shots=[{avatarId:d.value.video.avatarId||state.value.avatars[0]?.id||'',duration:10}];}
async function editShots(){if(locked.value)return;try{await save();shotSignature.value=shotInputSignature(d.value);shotEditor.value=true;}catch(e){notify(e.message,'error');}}
</script>
<template>
  <div class="two-columns video-columns">
    <article class="card video-config">
      <div class="card-heading"><h3>视频配置</h3><button class="pill" @click="navigate('avatars')">上传形象</button></div>
      <div class="segmented"><button :disabled="locked" :class="{active:d.video.mode==='single'}" @click="mode('single')">单形象</button><button :disabled="locked" :class="{active:d.video.mode==='multi'}" @click="mode('multi')">多镜头</button></div>
      <div class="video-config-fields">
      <div v-if="d.video.mode==='single'" class="video-field"><label>选择形象<AvatarSelect v-model="d.video.avatarId" aria-label="选择形象" :disabled="locked"/></label></div>
      <div v-else class="video-field video-shot-summary"><div><span>多镜头配置</span><p>总时长约 {{total}} 秒，可配置不同形象的出场顺序。</p></div><strong>{{d.video.shots.length}} 个镜头</strong><button class="pill" :disabled="locked" @click="editShots">编辑镜头</button></div>
      <div class="video-field video-driver-field"><div class="card-heading"><span>驱动音频</span><small>{{audioSource}}</small></div><VideoDriverAudio :key="d.id+':'+audioId" :id="audioId" :name="audioAsset?.name" :size="audioAsset?.size" :disabled="locked" @choose="emit('choose','audio',a=>d.video.audioId=a.id,'选择驱动音频')"/></div>
      <div class="video-field video-model"><label>模型版本<DropdownSelect v-model="d.video.model" aria-label="模型版本" :disabled="locked||localH3||localMuse" :options="localMuse?[{value:'v1',label:'MuseTalk 1.5'},{value:'v2',label:'MuseTalk 1.5'}]:localH3?[{value:'v1',label:'MiniMax H3'},{value:'v2',label:'MiniMax H3'}]:[{value:'v1',label:'高清模型 V1'},{value:'v2',label:'高清模型 V2'}]"/></label></div>
      </div>
      <p v-if="localMuse" class="hint">本地口型：支持1至600秒单形象和多镜头，保留各形象动作与背景，生成当前音轨对应的口型。多镜头总时长需与音频一致；成片采用首镜头画幅，不同画幅等比补边，请检查口型和音画同步。</p>
      <p v-if="localH3" class="hint">本地 H3：支持单形象和按配置顺序生成多镜头。超过15秒的单个镜头按静音附近分段，使用完整原音轨合成。多镜头总时长需与驱动音频一致；人物、口型及接缝效果需检查。</p>
      <button class="primary full" :disabled="locked||!!generationReason" :title="generationReason||'使用当前形象和驱动音频生成视频'" @click="emit('generate')"><I name="User"/>生成视频</button>
    </article>
    <VideoResult :id="d.video.assetId"/>
  </div>
  <details class="video-local-entry"><summary>使用已有视频</summary><button class="text-button video-import" :disabled="locked" @click="emit('choose','video',a=>d.video.assetId=a.id,'导入已有视频进入后续制作')">导入已有视频</button><p>口型生成需要实际服务。已有视频可进入后续剪辑。</p></details>
  <VideoShotsEditor v-if="shotEditor" :signature="shotSignature" @close="shotEditor=false"/>
</template>
