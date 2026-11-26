<script setup>
import {computed,inject,ref,watch} from 'vue';
import {call} from '../api';
const {state,busy,workflowLocked,notify,refresh}=inject('studio');
const expanded=ref(false),working=ref(false),result=ref(''),inspection=ref(null),checkedAt=ref('');
const config=ref({}),baseline=ref('');
const defaults={storyImageProtocol:'comfy',storyImageBaseUrl:'http://127.0.0.1:8188',storyImageModel:'sd_xl_base_1.0.safetensors',storyImageArchitecture:'sdxl',storyImageReferenceFit:'contain',storyImageDenoise:.68,storyImagePromptLanguage:'original',storyImageZUnet:'z_image_turbo_bf16.safetensors',storyImageZClip:'qwen_3_4b.safetensors',storyImageZVae:'ae.safetensors',storyVideoProtocol:'comfy-h3',storyVideoBaseUrl:'http://127.0.0.1:8188',storyVideoModel:'minimax_h3_fl2va_pruned_int8_convrot.safetensors',storyReferenceVideoModel:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',storyWanModel:'wan2.2_ti2v_5B_fp16.safetensors',storyWanClip:'umt5_xxl_fp8_e4m3fn_scaled.safetensors',storyWanVae:'wan2.2_vae.safetensors'};
const keys=Object.keys(defaults);
function savedConfig(){const p=state.value.settings.provider;return Object.fromEntries(keys.map(key=>[key,p[key]??defaults[key]]));}
function read(){config.value=savedConfig();baseline.value=JSON.stringify(config.value);}
read();
const dirty=computed(()=>JSON.stringify(config.value)!==baseline.value);
const savedSignature=computed(()=>JSON.stringify(savedConfig()));
// 只跟踪本组件字段；轮询与其他设置更新都不能覆盖尚未保存的输入。
watch(savedSignature,()=>{inspection.value=null;checkedAt.value='';if(!working.value&&!dirty.value)read();});
watch(()=>JSON.stringify(config.value),()=>{inspection.value=null;checkedAt.value='';});
const serverChanged=computed(()=>dirty.value&&savedSignature.value!==baseline.value);
const activeTask=computed(()=>state.value.runs.some(run=>['running','queued'].includes(run.status))||(state.value.workflowJobs||[]).some(job=>['running','queued','stopping'].includes(job.status)));
const lockReason=computed(()=>working.value?'正在保存或检查模型设置':busy.value?'当前操作尚未结束，请完成后修改模型设置':workflowLocked.value||activeTask.value?'当前有任务正在执行，请结束后修改非口播模型设置':'');
const locked=computed(()=>!!lockReason.value);
const localImage=computed(()=>config.value.storyImageProtocol==='comfy');
const textOnly=computed(()=>config.value.storyImageArchitecture==='z-image-turbo');
const available=computed(()=>inspection.value?.image?.available||{});
function showInspection(checked){inspection.value=checked;checkedAt.value=new Date().toLocaleTimeString('zh-CN');result.value=typeof checked==='string'?checked:JSON.stringify(checked,null,2);}
function inspectionText(kind){const item=inspection.value?.[kind];if(!item)return '尚未检查';if(!['comfy','comfy-h3','comfy-wan22'].includes(item.protocol))return '云端配置 · 需实际生成验证';if(!item.connected)return item.error||'本地服务未连接，请启动 ComfyUI 后重新检查';if(item.ready)return '连接正常，所需节点与权重齐备';return '连接正常，缺少：'+[...(item.missingNodes||[]),...(item.missingModels||[]),...(item.invalidOptions||[])].join('、');}
function open(){expanded.value=true;}
defineExpose({open,check:discover});
async function discover(){if(locked.value)return;working.value=true;result.value='';try{showInspection(await call('checkStoryModels',{provider:{...config.value}}));}catch(error){notify(error.message,'error');}finally{working.value=false;}}
async function save(check=false){if(locked.value)return;working.value=true;result.value='';try{await call('saveStoryModels',{provider:{...config.value}});await refresh();read();if(check)showInspection(await call('checkStoryModels'));else notify('非口播模型设置已保存','success');}catch(error){notify(error.message,'error');}finally{working.value=false;}}
</script>
<template>
  <section class="story-model-settings">
    <div class="story-model-heading"><button class="text-button" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起':'展开'}}非口播模型设置 · 图片 / 动态视频</button><button :disabled="locked" @click="discover">{{working?'正在检查…':'检查图片与视频服务'}}</button></div>
    <div class="story-service-summary" aria-live="polite"><p v-for="item in [['image','图片'],['video','视频']]" :key="item[0]" :class="{unready:inspection?.[item[0]]&&!inspection[item[0]].ready}"><strong>{{item[1]}}服务</strong><span>{{inspectionText(item[0])}}</span></p></div>
    <p class="hint">{{checkedAt?'检查于 '+checkedAt+'，仅代表当时连接及模型状态，生成结果仍需预览确认。':'生成前可先检查连接与模型；检查不会提交生成任务。'}}{{dirty?' 当前检查使用未保存输入，生成使用已保存配置。':''}}</p>
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
        <label>视频服务<select v-model="config.storyVideoProtocol" :disabled="locked"><option value="comfy-h3">本地 ComfyUI H3</option><option value="comfy-wan22">本地 ComfyUI Wan2.2 · 静音图生视频</option><option value="bridge">云端视频服务桥</option></select></label>
        <label>视频服务地址<input v-model="config.storyVideoBaseUrl" :disabled="locked" aria-label="非口播视频服务地址" placeholder="http://127.0.0.1:8188"/></label>
        <label v-if="config.storyVideoProtocol!=='comfy-wan22'">视频模型<input v-model="config.storyVideoModel" :disabled="locked" aria-label="非口播视频模型"/></label>
        <template v-if="config.storyVideoProtocol==='comfy-wan22'">
          <label>Wan 5B 视频模型<input v-model="config.storyWanModel" :disabled="locked" aria-label="Wan视频模型"/></label>
          <label>Wan 文本编码器<input v-model="config.storyWanClip" :disabled="locked" aria-label="Wan文本编码器"/></label>
          <label>Wan VAE<input v-model="config.storyWanVae" :disabled="locked" aria-label="Wan VAE"/></label>
        </template>
        <label v-if="config.storyVideoProtocol==='comfy-h3'">资产参考视频模型<input v-model="config.storyReferenceVideoModel" :disabled="locked" aria-label="H3资产参考视频模型"/></label>
      </div>
      <fieldset v-if="localImage&&!textOnly" class="story-reference-options"><legend>SDXL 构图与参考图</legend><div class="story-model-grid">
          <label>参考图适配<select v-model="config.storyImageReferenceFit" :disabled="locked"><option value="contain">完整保留，空白处补边</option><option value="blur">柔化背景扩展，主体完整居中</option><option value="cover">铺满画面，居中裁切</option></select><small>长宽比不同时优先用柔化扩展保留完整产品；补边会留下空白，铺满可能裁掉主体边缘。</small></label>
          <label><span>重绘强度 · {{Number(config.storyImageDenoise).toFixed(2)}}</span><input v-model.number="config.storyImageDenoise" type="range" min="0.1" max="1" step="0.01" :disabled="locked" aria-label="SDXL参考图重绘强度"/><small>数值越低越贴近原图，越高越容易改变内容。建议先用低强度试图并人工核对产品结构。</small></label>
          <label>内部构图指令<select v-model="config.storyImagePromptLanguage" :disabled="locked"><option value="original">按原文直接生成</option><option value="english">先编译为英文再生成</option></select><small>仅改变送入本地 SDXL 的内部指令，界面与原始中文要求不变；翻译结果仍需检查。</small></label>
      </div></fieldset>
      <datalist id="story-image-checkpoints"><option v-for="name in available.checkpoints||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-unets"><option v-for="name in available.unets||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-encoders"><option v-for="name in available.textEncoders||[]" :key="name" :value="name"/></datalist>
      <datalist id="story-image-vaes"><option v-for="name in available.vaes||[]" :key="name" :value="name"/></datalist>
      <p v-if="localImage&&textOnly" class="hint story-reference-warning" role="status">当前 Z-Image 工作流仅支持纯文生图。已有绑定参考的镜头会在提交前被拒绝；可先建立无参考的独立构图资产，审图后手动用于镜头。主体外观仅由文字约束，不保证跨图身份一致。</p>
      <p v-else class="hint">本地 SDXL 仅主参考图片参与图生图，其余绑定只传文字，不提供多图或身份一致性保证。云端参考图需要可用的图片编辑接口。H3 单镜头支持 4～15 秒。图片服务成功返回不代表产品结构或镜头内容已通过，仍需逐张预览确认。</p>
      <p v-if="config.storyVideoProtocol==='comfy-wan22'" class="hint story-reference-warning" role="status">Wan2.2 5B 使用一张已确认首帧生成静音视频，支持横屏、竖屏及固定种子，不支持尾帧、多资产参考或声音生成。旁白由第三步配音后期合成。4～15秒仅为接入范围，长镜头的显存、耗时和实际效果仍须验证；检查成功不表示内容质量通过。</p>
      <p v-if="inspection?.image" class="hint" role="status">图片检查：{{inspection.image.ready?'所需节点与权重齐备，尚未验证生成':'当前配置未就绪'}}；参考方式：{{inspection.image.referenceMode||'未确认'}}。模型列表读取不会执行生成或更改设置。</p>
      <p v-if="inspection?.video?.reference" class="hint" role="status">资产参考工作流：{{inspection.video.reference.ready?'节点与权重齐备，仍需实际生成验证':'尚未就绪：'+[...(inspection.video.reference.missingNodes||[]),...(inspection.video.reference.missingModels||[]),...(inspection.video.reference.invalidOptions||[])].join('、')}}。资产参考不固定首尾帧，需逐镜检查商品结构与人物外观。</p>
      <div class="story-model-actions"><button :disabled="locked" @click="discover">{{working?'正在检查…':'读取本地模型与能力（不保存）'}}</button><button :disabled="locked" @click="save(false)">保存模型设置</button><button :disabled="locked" @click="save(true)">保存并检查本地能力</button></div>
      <details v-if="result"><summary>查看完整检查信息</summary><pre class="story-model-result">{{result}}</pre></details>
    </div>
  </section>
</template>
<style scoped>
.story-model-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.story-service-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-block:12px}.story-service-summary p{margin:0;display:grid;gap:6px;padding:10px 12px;border:1px solid var(--border,#454152);border-radius:8px;min-width:0;overflow-wrap:anywhere;line-height:1.6}.story-service-summary .unready{border-color:var(--warning,#c89146)}.story-service-summary span{font-size:13px}.story-model-heading button{min-height:36px}@media(max-width:760px){.story-service-summary{grid-template-columns:minmax(0,1fr)}}
.story-model-settings{margin-block:12px;border:1px solid var(--border,#454152);border-radius:12px;padding:12px 16px;background:var(--card-bg,rgba(255,255,255,.025))}.story-model-form{display:grid;gap:14px;padding-top:12px}.story-model-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.story-model-grid label{display:grid;align-content:start;gap:8px;min-width:0}.story-model-grid small{line-height:1.7;overflow-wrap:anywhere}.story-reference-options{margin:0;padding:14px;border:1px solid var(--border,#454152);border-radius:8px;min-width:0}.story-reference-options legend{padding-inline:6px;font-size:13px}.story-model-grid input,.story-model-grid select{width:100%;min-width:0}.story-model-actions{display:flex;gap:12px;flex-wrap:wrap}.story-model-result{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;font-size:12px}.hint{margin:0;line-height:1.7}@media(max-width:1100px){.story-model-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.story-model-grid{grid-template-columns:minmax(0,1fr)}}
</style>
