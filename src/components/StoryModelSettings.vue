<script setup>
import {computed,inject,ref,watch} from 'vue';
import {call} from '../api';
const {state,busy,workflowLocked,notify,refresh}=inject('studio');
const expanded=ref(false),working=ref(false),result=ref(''),inspection=ref(null);
const config=ref({}),baseline=ref('');
const defaults={storyImageProtocol:'comfy',storyImageBaseUrl:'http://127.0.0.1:8188',storyImageModel:'sd_xl_base_1.0.safetensors',storyImageArchitecture:'sdxl',storyImageZUnet:'z_image_turbo_bf16.safetensors',storyImageZClip:'qwen_3_4b.safetensors',storyImageZVae:'ae.safetensors',storyVideoProtocol:'comfy-h3',storyVideoBaseUrl:'http://127.0.0.1:8188',storyVideoModel:'minimax_h3_fl2va_pruned_int8_convrot.safetensors'};
const keys=Object.keys(defaults);
function savedConfig(){const p=state.value.settings.provider;return Object.fromEntries(keys.map(key=>[key,p[key]||defaults[key]]));}
function read(){config.value=savedConfig();baseline.value=JSON.stringify(config.value);}
read();
const dirty=computed(()=>JSON.stringify(config.value)!==baseline.value);
const savedSignature=computed(()=>JSON.stringify(savedConfig()));
// 只跟踪本组件字段；轮询与其他设置更新都不能覆盖尚未保存的输入。
watch(savedSignature,()=>{if(!working.value&&!dirty.value)read();});
const serverChanged=computed(()=>dirty.value&&savedSignature.value!==baseline.value);
const activeTask=computed(()=>state.value.runs.some(run=>['running','queued'].includes(run.status))||(state.value.workflowJobs||[]).some(job=>['running','queued','stopping'].includes(job.status)));
const lockReason=computed(()=>working.value?'正在保存或检查模型设置':busy.value?'当前操作尚未结束，请完成后修改模型设置':workflowLocked.value||activeTask.value?'当前有任务正在执行，请结束后修改非口播模型设置':'');
const locked=computed(()=>!!lockReason.value);
const localImage=computed(()=>config.value.storyImageProtocol==='comfy');
const textOnly=computed(()=>config.value.storyImageArchitecture==='z-image-turbo');
const available=computed(()=>inspection.value?.image?.available||{});
function showInspection(checked){inspection.value=checked;result.value=typeof checked==='string'?checked:JSON.stringify(checked,null,2);}
async function discover(){if(locked.value)return;working.value=true;result.value='';try{showInspection(await call('checkStoryModels',{provider:{...config.value}}));}catch(error){notify(error.message,'error');}finally{working.value=false;}}
async function save(check=false){if(locked.value)return;working.value=true;result.value='';try{await call('saveStoryModels',{provider:{...config.value}});await refresh();read();if(check)showInspection(await call('checkStoryModels'));else notify('非口播模型设置已保存','success');}catch(error){notify(error.message,'error');}finally{working.value=false;}}
</script>
<template>
  <section class="story-model-settings">
    <button class="text-button" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起':'展开'}}非口播模型设置 · 图片 / 动态视频</button>
    <div v-if="expanded" class="story-model-form">
      <p class="hint">拆集与分镜使用设置中的文本模型。图片、动态视频可各自选择本地或云端；云端使用对应能力的独立密钥，未配置时沿用全局密钥。</p>
      <p v-if="lockReason" class="hint" role="status">{{lockReason}}</p>
      <p v-if="dirty" class="hint" role="status">{{serverChanged?'服务配置已在其他位置更新，当前输入已保留；保存将使用当前输入。':'有未保存的模型设置，后台刷新会保留当前输入。'}}</p>
      <div class="story-model-grid">
        <label>图片服务<select v-model="config.storyImageProtocol" :disabled="locked"><option value="comfy">本地 ComfyUI</option><option value="compatible">云端兼容图片接口</option></select></label>
        <label>图片服务地址<input v-model="config.storyImageBaseUrl" :disabled="locked" aria-label="非口播图片服务地址" placeholder="http://127.0.0.1:8188"/></label>
        <label v-if="localImage">本地图片架构<select v-model="config.storyImageArchitecture" :disabled="locked" aria-label="本地图片架构"><option value="sdxl">SDXL · 单主参考图生图 / 文生图</option><option value="z-image-turbo">Z-Image Turbo · 纯文生图</option><option value="flux-schnell" disabled>FLUX schnell · 尚未接入</option></select></label>
        <label v-if="!localImage||!textOnly">{{localImage?'SDXL Checkpoint':'云端图片模型'}}<input v-model="config.storyImageModel" :disabled="locked" aria-label="非口播图片模型" :list="localImage?'story-image-checkpoints':undefined"/></label>
        <template v-if="localImage&&textOnly">
          <label>Z-Image 模型 UNET<input v-model="config.storyImageZUnet" :disabled="locked" aria-label="Z-Image模型UNET" list="story-image-unets"/></label>
          <label>Z-Image 文本编码器<input v-model="config.storyImageZClip" :disabled="locked" aria-label="Z-Image文本编码器" list="story-image-encoders"/></label>
          <label>Z-Image VAE<input v-model="config.storyImageZVae" :disabled="locked" aria-label="Z-Image VAE" list="story-image-vaes"/></label>
        </template>
        <label>视频服务<select v-model="config.storyVideoProtocol" :disabled="locked"><option value="comfy-h3">本地 ComfyUI H3</option><option value="bridge">云端视频服务桥</option></select></label>
        <label>视频服务地址<input v-model="config.storyVideoBaseUrl" :disabled="locked" aria-label="非口播视频服务地址" placeholder="http://127.0.0.1:8188"/></label>
        <label>视频模型<input v-model="config.storyVideoModel" :disabled="locked" aria-label="非口播视频模型"/></label>
      </div>
      <datalist id="story-image-checkpoints"><option v-for="name in available.checkpoints||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-unets"><option v-for="name in available.unets||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-encoders"><option v-for="name in available.textEncoders||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-vaes"><option v-for="name in available.vaes||[]" :key="name" :value="name"/></datalist>
      <p v-if="localImage&&textOnly" class="hint story-reference-warning" role="status">当前 Z-Image 工作流仅支持纯文生图。已有绑定参考的镜头会在提交前被拒绝；可先建立无参考的独立构图资产，审图后手动用于镜头。主体外观仅由文字约束，不保证跨图身份一致。</p>
      <p v-else class="hint">本地 SDXL 仅主参考图片参与图生图，其余绑定只传文字，不提供多图或身份一致性保证。云端参考图需要可用的图片编辑接口。H3 单镜头支持 4～15 秒。</p>
      <p v-if="inspection?.image" class="hint" role="status">图片检查：{{inspection.image.ready?'所需节点与权重齐备，尚未验证生成':'当前配置未就绪'}}；参考方式：{{inspection.image.referenceMode||'未确认'}}。模型列表读取不会执行生成或更改设置。</p>
      <div class="story-model-actions"><button :disabled="locked" @click="discover">{{working?'正在检查…':'读取本地模型与能力（不保存）'}}</button><button :disabled="locked" @click="save(false)">保存模型设置</button><button :disabled="locked" @click="save(true)">保存并检查本地能力</button></div>
      <pre v-if="result" class="story-model-result">{{result}}</pre>
    </div>
  </section>
</template>
<style scoped>
.story-model-settings{margin-block:12px;border:1px solid var(--border,#454152);border-radius:12px;padding:12px 16px;background:var(--card-bg,rgba(255,255,255,.025))}.story-model-form{display:grid;gap:14px;padding-top:12px}.story-model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.story-model-grid label{display:grid;gap:8px;min-width:0}.story-model-grid input,.story-model-grid select{width:100%;min-width:0}.story-model-actions{display:flex;gap:12px;flex-wrap:wrap}.story-model-result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font-size:12px}.hint{margin:0;line-height:1.7}@media(max-width:1100px){.story-model-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.story-model-grid{grid-template-columns:minmax(0,1fr)}}
</style>
