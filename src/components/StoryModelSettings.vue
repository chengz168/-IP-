<script setup>
import {computed,inject,ref,watch} from 'vue';
import {call} from '../api';
const {state,busy,workflowLocked,notify,refresh}=inject('studio');
const expanded=ref(false),working=ref(false),result=ref('');
const config=ref({}),baseline=ref('');
const keys=['storyImageProtocol','storyImageBaseUrl','storyImageModel','storyVideoProtocol','storyVideoBaseUrl','storyVideoModel'];
function savedConfig(){const p=state.value.settings.provider;return Object.fromEntries(keys.map(key=>[key,p[key]||({storyImageProtocol:'comfy',storyImageBaseUrl:'http://127.0.0.1:8188',storyImageModel:'sd_xl_base_1.0.safetensors',storyVideoProtocol:'comfy-h3',storyVideoBaseUrl:'http://127.0.0.1:8188',storyVideoModel:'minimax_h3_fl2va_pruned_int8_convrot.safetensors'}[key])]));}
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
async function save(check=false){if(locked.value)return;working.value=true;result.value='';try{await call('saveStoryModels',{provider:{...config.value}});await refresh();read();if(check){const checked=await call('checkStoryModels');result.value=typeof checked==='string'?checked:JSON.stringify(checked,null,2);}else notify('非口播模型设置已保存','success');}catch(error){notify(error.message,'error');}finally{working.value=false;}}
</script>
<template>
  <section class="story-model-settings">
    <button class="text-button" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起':'展开'}}非口播模型设置 · 图片 / 动态视频</button>
    <div v-if="expanded" class="story-model-form">
      <p class="hint">拆集与分镜使用设置中的文本模型。图片、动态视频可各自选择本地或云端；云端沿用模型设置中的 API 密钥。</p>
      <p v-if="lockReason" class="hint" role="status">{{lockReason}}</p>
      <p v-if="dirty" class="hint" role="status">{{serverChanged?'服务配置已在其他位置更新，当前输入已保留；保存将使用当前输入。':'有未保存的模型设置，后台刷新会保留当前输入。'}}</p>
      <div class="story-model-grid">
        <label>图片服务<select v-model="config.storyImageProtocol" :disabled="locked"><option value="comfy">本地 ComfyUI</option><option value="compatible">云端兼容图片接口</option></select></label>
        <label>图片服务地址<input v-model="config.storyImageBaseUrl" :disabled="locked" aria-label="非口播图片服务地址" placeholder="http://127.0.0.1:8188"/></label>
        <label>图片模型<input v-model="config.storyImageModel" :disabled="locked" aria-label="非口播图片模型"/></label>
        <label>视频服务<select v-model="config.storyVideoProtocol" :disabled="locked"><option value="comfy-h3">本地 ComfyUI H3</option><option value="bridge">云端视频服务桥</option></select></label>
        <label>视频服务地址<input v-model="config.storyVideoBaseUrl" :disabled="locked" aria-label="非口播视频服务地址" placeholder="http://127.0.0.1:8188"/></label>
        <label>视频模型<input v-model="config.storyVideoModel" :disabled="locked" aria-label="非口播视频模型"/></label>
      </div>
      <p class="hint">本地图片默认使用已有 SDXL。资产参考采用整图参考，生成后需核对主体、构图和外观；云端参考图需要图片编辑接口。H3 单镜头支持 4～15 秒。</p>
      <div class="story-model-actions"><button :disabled="locked" @click="save(false)">保存模型设置</button><button :disabled="locked" @click="save(true)">{{working?'正在检查…':'保存并检查本地能力'}}</button></div>
      <pre v-if="result" class="story-model-result">{{result}}</pre>
    </div>
  </section>
</template>
<style scoped>
.story-model-settings{margin-block:12px;border:1px solid var(--border,#454152);border-radius:12px;padding:12px 16px;background:var(--card-bg,rgba(255,255,255,.025))}.story-model-form{display:grid;gap:14px;padding-top:12px}.story-model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.story-model-grid label{display:grid;gap:8px;min-width:0}.story-model-grid input,.story-model-grid select{width:100%;min-width:0}.story-model-actions{display:flex;gap:12px;flex-wrap:wrap}.story-model-result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font-size:12px}.hint{margin:0;line-height:1.7}@media(max-width:1100px){.story-model-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.story-model-grid{grid-template-columns:minmax(0,1fr)}}
</style>
