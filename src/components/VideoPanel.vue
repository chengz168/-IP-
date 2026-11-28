<script setup>
import {computed,inject,onBeforeUnmount,ref,watch} from 'vue';
import I from './Icon.vue';
import VideoResult from './VideoResult.vue';
import AvatarSelect from './AvatarSelect.vue';
import DropdownSelect from './DropdownSelect.vue';
import VideoShotsEditor from './VideoShotsEditor.vue';
import VideoDriverAudio from './VideoDriverAudio.vue';
import StoryStudio from './StoryStudio.vue';
import ProductStudio from './ProductStudio.vue';
import AvatarOptimizeDialog from './AvatarOptimizeDialog.vue';
import '../story-studio.css';
import '../avatar-optimize.css';
import '../video-production-plan.css';
import {call} from '../api';
import {shotInputSignature,shotTotal} from '../../server/video-shots.mjs';
const emit=defineEmits(['choose','generate']);
const {state,draft:d,busy,navigate,save,act,workflowLocked,notify}=inject('studio');
const shotEditor=ref(false),shotSignature=ref('');
const optimizeOpen=ref(false);
const storyEditor=ref(null);
const planning=ref(false),planError=ref(''),planNotice=ref('');
let alive=true;
onBeforeUnmount(()=>{alive=false;});
async function handoffToEditing(){
 if(!storyEditor.value){notify('请先完成当前视频制作，再交接网感剪辑','error');return false;}
 return storyEditor.value.handoffToEditing();
}
defineExpose({handoffToEditing});
const activeVideo=computed(()=>state.value.runs.some(run=>run.draftId===d.value.id&&(['avatar','avatar-optimize','avatar-background','product-video','product-introduction','video-plan'].includes(run.type)||String(run.type).startsWith('story-'))&&['running','queued','unknown'].includes(run.status)));
const locked=computed(()=>planning.value||!!busy.value||workflowLocked.value||activeVideo.value);
const localH3=computed(()=>state.value.settings.provider.avatarProtocol==='comfy-h3');
const localMuse=computed(()=>state.value.settings.provider.avatarProtocol==='musetalk-local');
const audioId=computed(()=>d.value.video.audioId||d.value.voice.audioId||'');
const audioAsset=computed(()=>state.value.assets.find(a=>a.id===audioId.value));
const audioSource=computed(()=>audioId.value?d.value.video.audioId?'手动音频':'上一步音频':'未选择');
const total=computed(()=>shotTotal(d.value.video.shots));
// 生成前明确提示缺失输入，与原版无驱动音频时的禁用状态一致。
const generationReason=computed(()=>!audioId.value?'请先选择驱动音频':d.value.video.mode==='multi'?!d.value.video.shots.length?'请先配置镜头':d.value.video.shots.some(shot=>!shot.avatarId)?'请为每个镜头选择形象':'':!d.value.video.avatarId?'请先选择形象':'');
const selectedAvatar=computed(()=>state.value.avatars.find(avatar=>avatar.id===d.value.video.avatarId)||null);
const routeNames={single:'单形象口播',multi:'多镜头口播',story:'分镜创作',product:'商品宣传'};
const presentationNames={'talking-head':'人物出镜口播','narrated-scenes':'分镜画面＋旁白','visual-story':'画面叙事','drama':'角色剧情','product-demo':'产品动态演示','screen-demo':'屏幕操作演示','motion-graphics':'动态图解'};
// 只展示后端核对过来源与输入版本的摘要，不直接使用草稿中的原始计划。
const productionPlan=computed(()=>d.value.video.routing?.productionPlan||null);
const routeLabel=computed(()=>d.value.video.routing?.policy==='manual'?'手动选择：'+routeNames[d.value.video.mode]:'自动选择：'+routeNames[d.value.video.mode]);
const routeConfidence=computed(()=>({high:'依据较明确',medium:'建议核对',low:'类型待核对'})[productionPlan.value?.confidence||d.value.video.routing?.confidence]||'等待识别');
const presentationLabel=computed(()=>presentationNames[productionPlan.value?.presentation]||routeNames[d.value.video.mode]||'待识别');
const planReason=computed(()=>productionPlan.value?.reason||d.value.video.routing?.reason||'确认最终文案后，根据文案、商品资料与已选对标拆解判断制作方式。');
const referenceBasis=computed(()=>{const reference=productionPlan.value?.reference;if(!reference?.sourceRunId)return '当前确认稿；其他资料依据见下方识别说明。';const count=reference.visualObservations?.length||0;return count?`当前确认稿与已选对标拆解，含 ${count} 个采样画面；采样不能代表逐帧分析。`:'当前确认稿与已选对标的文字拆解，未包含采样画面依据。';});
const planCues=computed(()=>productionPlan.value?.cues||d.value.video.routing?.cues||[]);
const instructionLength=computed(()=>String(d.value.video.productionInstruction||'').length);
const planDisabledReason=computed(()=>instructionLength.value>1500?'制作要求最多填写1500字':d.value.video.routing?.policy!=='manual'&&(!d.value.confirmed||!d.value.finalText?.trim())?'请先在第二步确认最终文案':'');
function planningInput(){const task=d.value;return JSON.stringify({id:task.id,confirmed:task.confirmed,finalText:task.finalText,sourceUrl:task.sourceUrl,referenceSelection:task.referenceSelection,product:task.product,instruction:task.video.productionInstruction||'',policy:task.video.routing?.policy,manualMode:task.video.routing?.policy==='manual'?task.video.mode:undefined});}
watch(()=>d.value.id,()=>{planError.value='';planNotice.value='';},{flush:'sync'});
async function identifyProduction(){
 if(locked.value||planDisabledReason.value)return;
 const id=d.value.id,input=planningInput(),sameTask=()=>alive&&d.value.id===id;
 planning.value=true;planError.value='';planNotice.value='';
 try{
  await save();
  if(!sameTask())return;
  if(planningInput()!==input){planNotice.value='输入已变化，请按当前要求重新识别。';return;}
  if(d.value.video.routing?.policy==='manual'){planNotice.value='制作要求已保存，保持当前手动制作方式；恢复自动识别后可重新识别。';return;}
  const result=await act('识别制作方式',async()=>{
   if(!sameTask()||planningInput()!==input)throw Error('当前任务或制作输入已变化，未提交识别。');
   try{return await call('planVideo',{id});}catch(error){if(sameTask())planError.value=error.message;throw error;}
  });
  if(!sameTask())return;
  if(planningInput()!==input||result?.stale){planNotice.value='文案、资料或制作要求已变化，本次结果未用于当前制作，请重新识别。';return;}
  if(!result){if(!planError.value)planError.value='识别未完成，请查看任务记录后重试。';return;}
  planNotice.value=result.plan?.status==='fallback'?'已根据规则更新制作建议，请核对内容类型和制作方式。':'已更新制作建议，请按下方流程继续制作并检查生成效果。';
 }catch(error){if(sameTask()){planError.value=error.message;notify(error.message,'error');}}
 finally{planning.value=false;}
}
function mode(value){if(locked.value)return;d.value.video.mode=value;if(value==='multi'&&!d.value.video.shots.length)d.value.video.shots=[{avatarId:d.value.video.avatarId||state.value.avatars[0]?.id||'',duration:10}];}
async function automaticRouting(){if(locked.value)return;const id=d.value.id,previous=structuredClone(JSON.parse(JSON.stringify(d.value.video.routing||{})));d.value.video.routing={...previous,policy:'auto'};try{await save();}catch(error){if(d.value.id===id)d.value.video.routing=previous;notify(error.message,'error');}}
function manualRouting(){if(locked.value)return;d.value.video.routing={...(d.value.video.routing||{}),policy:'manual',mode:d.value.video.mode};}
async function editShots(){if(locked.value)return;try{await save();shotSignature.value=shotInputSignature(d.value);shotEditor.value=true;}catch(e){notify(e.message,'error');}}
</script>
<template>
  <div class="video-mode-toolbar">
    <div class="segmented" role="tablist" aria-label="视频创作方式">
      <button :disabled="locked" role="tab" :aria-selected="d.video.mode==='single'" :class="{active:d.video.mode==='single'}" @click="mode('single');manualRouting()">单形象</button>
      <button :disabled="locked" role="tab" :aria-selected="d.video.mode==='multi'" :class="{active:d.video.mode==='multi'}" @click="mode('multi');manualRouting()">多镜头口播</button>
      <button :disabled="locked" role="tab" :aria-selected="d.video.mode==='story'" :class="{active:d.video.mode==='story'}" @click="mode('story');manualRouting()">分镜创作</button>
      <button :disabled="locked" role="tab" :aria-selected="d.video.mode==='product'" :class="{active:d.video.mode==='product'}" @click="mode('product');manualRouting()">商品宣传</button>
    </div>
    <p v-if="d.video.mode==='story'">文案 → 分集分镜 → 资产图片 → 镜头视频 → 后续剪辑</p>
    <p v-else-if="d.video.mode==='product'">商品详情与素材 → 确认脚本 → 配音 → 动态产品镜头 → 后续剪辑</p>
    <section class="video-route-note video-production-plan" aria-label="内容类型与制作方式" :aria-busy="planning">
      <div class="video-production-summary">
        <div class="video-production-heading"><strong>{{routeLabel}}</strong><span class="video-production-confidence">{{productionPlan?.status==='fallback'?'规则建议 · ':''}}{{routeConfidence}}</span></div>
        <dl class="video-production-facts"><div><dt>内容类型</dt><dd>{{productionPlan?.contentType?.name||'待识别'}}</dd></div><div><dt>{{d.video.routing?.policy==='manual'&&productionPlan?'建议呈现':'呈现方式'}}</dt><dd>{{presentationLabel}}</dd></div></dl>
        <p class="video-production-reason">{{planReason}}</p>
        <p v-if="d.video.routing?.policy==='manual'&&d.video.routing?.suggestion" class="video-production-help">自动建议：{{routeNames[d.video.routing.recommendedMode]}} · 当前保留手动选择。</p>
        <p v-if="productionPlan" class="video-production-help">参考依据：{{referenceBasis}}</p>
        <details v-if="productionPlan||planCues.length" class="video-production-details">
          <summary>查看制作步骤与核对事项</summary>
          <div class="video-production-detail-body">
            <p v-if="planCues.length"><b>识别依据：</b>{{planCues.join('；')}}</p>
            <p v-if="productionPlan?.style"><b>画面风格：</b>{{productionPlan.style}}</p>
            <div v-if="productionPlan?.steps?.length"><b>建议步骤</b><ol><li v-for="(step,index) in productionPlan.steps" :key="index">{{step}}</li></ol></div>
            <div v-if="productionPlan?.requirements?.length"><b>制作前核对</b><ul><li v-for="(requirement,index) in productionPlan.requirements" :key="index">{{requirement}}</li></ul></div>
            <p class="video-production-help">以上是制作建议，服务配置、素材和画面效果需要在对应步骤确认。</p>
          </div>
        </details>
        <details class="video-production-instruction">
          <summary>补充制作要求<span>可选</span></summary>
          <label :for="'video-production-instruction-'+d.id">希望怎样呈现</label>
          <textarea :id="'video-production-instruction-'+d.id" v-model="d.video.productionInstruction" :disabled="locked" maxlength="1500" rows="3" :aria-describedby="'video-production-instruction-help-'+d.id" placeholder="例如：用动画解释原理，画面搭配旁白；不需要人物出镜。"/>
          <div class="video-production-instruction-meta"><p :id="'video-production-instruction-help-'+d.id">{{d.video.routing?.policy==='manual'?'当前为手动模式，仅保存制作要求；恢复自动识别后可更新建议。':'要求单独保存；修改后点击“保存并识别”，更新制作建议。'}}</p><span>{{instructionLength}} / 1500</span></div>
        </details>
        <p v-if="planDisabledReason" class="video-production-help">{{planDisabledReason}}</p>
        <p v-if="planError" class="video-production-message error" role="alert">{{planError}}</p>
        <p v-else-if="planNotice||planning" class="video-production-message" role="status">{{planning?(d.video.routing?.policy==='manual'?'正在保存制作要求…':'正在根据当前文案与资料识别制作方式…'):planNotice}}</p>
      </div>
      <div class="video-production-actions">
        <button :disabled="locked||!!planDisabledReason" :title="planDisabledReason||(d.video.routing?.policy==='manual'?'保存制作要求，保持手动选择的制作方式':'保存制作要求，并根据当前文案与资料更新制作建议')" @click="identifyProduction">{{planning?(d.video.routing?.policy==='manual'?'保存中…':'识别中…'):(d.video.routing?.policy==='manual'?'保存制作要求':'保存并识别')}}</button>
        <button v-if="d.video.routing?.policy==='manual'" :disabled="locked" @click="automaticRouting">恢复自动识别</button>
        <button v-else :disabled="locked" @click="manualRouting">手动调整</button>
      </div>
    </section>
  </div>
  <StoryStudio ref="storyEditor" v-if="d.video.mode==='story'" :key="d.id"/>
  <ProductStudio ref="storyEditor" v-else-if="d.video.mode==='product'" :key="d.id" phase="video"/>
  <template v-else>
  <div class="two-columns video-columns">
    <article class="card video-config">
      <div class="card-heading"><h3>视频配置</h3><button class="pill" @click="navigate('avatars')">上传形象</button></div>
      <div class="video-config-fields">
      <div v-if="d.video.mode==='single'" class="video-field"><label>选择形象<AvatarSelect v-model="d.video.avatarId" aria-label="选择形象" :disabled="locked"/></label><button class="avatar-optimize-entry" :disabled="locked||!selectedAvatar" :title="selectedAvatar?'生成一个优化后的形象副本':'请先选择形象'" @click="optimizeOpen=true"><I name="Sparkles" :size="15"/>优化形象</button></div>
      <div v-else class="video-field video-shot-summary"><div><span>多镜头配置</span><p>总时长约 {{total}} 秒，可配置不同形象的出场顺序。</p></div><strong>{{d.video.shots.length}} 个镜头</strong><button class="pill" :disabled="locked" @click="editShots">编辑镜头</button></div>
      <div class="video-field video-driver-field"><div class="card-heading"><span>驱动音频</span><small>{{audioSource}}</small></div><VideoDriverAudio :key="d.id+':'+audioId" :id="audioId" :name="audioAsset?.name" :size="audioAsset?.size" :disabled="locked" @choose="emit('choose','audio',a=>d.video.audioId=a.id,'选择驱动音频')"/></div>
      <div class="video-field video-model"><label>模型版本<DropdownSelect v-model="d.video.model" aria-label="模型版本" :disabled="locked||localH3||localMuse" :options="localMuse?[{value:'v1',label:'MuseTalk 1.5'},{value:'v2',label:'MuseTalk 1.5'}]:localH3?[{value:'v1',label:'MiniMax H3'},{value:'v2',label:'MiniMax H3'}]:[{value:'v1',label:'高清模型 V1'},{value:'v2',label:'高清模型 V2'}]"/></label></div>
      </div>
      <p v-if="localMuse" class="hint">本地口型：成片时长跟随驱动音频（1～600秒），形象片段可更短并自动往返复用。常见帧率和旋转视频会自动适配，保留原文件。请选择人脸清晰可见的片段；多镜头总时长需与音频一致，不同画幅等比补边。</p>
      <p v-if="localH3" class="hint">本地 H3：支持单形象和按配置顺序生成多镜头。超过15秒的单个镜头按静音附近分段，使用完整原音轨合成。多镜头总时长需与驱动音频一致；人物、口型及接缝效果需检查。</p>
      <button class="primary full" :disabled="locked||!!generationReason" :title="generationReason||'使用当前形象和驱动音频生成视频'" @click="emit('generate')"><I name="User"/>生成视频</button>
    </article>
    <VideoResult :id="d.video.assetId"/>
  </div>
  <details class="video-local-entry"><summary>使用已有视频</summary><button class="text-button video-import" :disabled="locked" @click="emit('choose','video',a=>d.video.assetId=a.id,'导入已有视频进入后续制作')">导入已有视频</button><p>口型生成需要实际服务。已有视频可进入后续剪辑。</p></details>
  <VideoShotsEditor v-if="shotEditor" :signature="shotSignature" @close="shotEditor=false"/>
  <AvatarOptimizeDialog v-if="optimizeOpen" :avatar="selectedAvatar" @close="optimizeOpen=false" @saved="optimizeOpen=false"/>
  </template>
</template>
