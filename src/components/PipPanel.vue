<script setup>
import {computed,inject,ref} from 'vue';
import DropdownSelect from './DropdownSelect.vue';
const emit=defineEmits(['custom','choose']);
const {draft,state,busy}=inject('studio');
const edit=computed(()=>draft.value.edit),advanced=ref(edit.value.pipMode==='continuous'&&!!edit.value.pipId);
const options=computed(()=>[{value:'',label:'不混剪'},...state.value.categories.map(c=>({value:c,label:c}))]);
const summary=computed(()=>!edit.value.pipEnabled?'已关闭':edit.value.pipCategory?'素材分类：'+edit.value.pipCategory:edit.value.captions.some(r=>r.pipId)?'已自定义 '+edit.value.captions.filter(r=>r.pipId).length+' 行字幕':'未选择素材分类');
const matching=computed(()=>state.value.assets.find(a=>a.id===edit.value.resultId)?.pipMatching);
function category(value){edit.value.pipCategory=value;edit.value.pipMode='captions';}
function clear(){edit.value.pipCategory='';edit.value.pipId='';edit.value.pipMode='captions';for(const row of edit.value.captions){delete row.pipId;delete row.pipOmit;}}
</script>
<template>
 <section class="pip-settings">
  <h3>画中画混剪</h3><p class="pip-settings-summary" role="status">{{summary}}</p>
  <p class="pip-settings-description">{{edit.pipEnabled?'选择素材分类后，剪辑时按字幕自动匹配画中画。':'开启左侧开关后，可选择素材分类并手动调整字幕画中画。'}}</p>
  <template v-if="edit.pipEnabled">
   <label class="pip-category-field">素材分类<DropdownSelect :model-value="edit.pipCategory||''" :options="options" aria-label="画中画自动匹配素材分类" variant="pip" :disabled="!!busy" @update:model-value="category"/></label>
   <div class="pip-settings-actions"><button class="primary" :disabled="!!busy" @click="emit('custom')">自定义画中画</button><button class="danger" :disabled="!!busy" @click="clear">清空混剪</button></div>
   <p v-if="matching" class="pip-matching-summary" aria-label="上次画中画匹配结果">上次剪辑：语义匹配 {{matching.matches.filter(r=>r.assetId).length}} 行，空匹配 {{matching.matches.filter(r=>!r.assetId).length}} 行。</p>
   <details class="pip-settings-advanced" :open="advanced" @toggle="advanced=$event.target.open"><summary>更多画中画设置</summary>
    <label>混剪方式<select v-model="edit.pipMode" aria-label="画中画模式"><option value="captions">按字幕逐句配置</option><option value="continuous">全程使用同一素材</option></select></label>
    <template v-if="edit.pipMode==='continuous'"><button class="secondary full" :disabled="!!busy" @click="emit('choose')">选择视频或图片</button><p class="hint">{{state.assets.find(a=>a.id===edit.pipId)?.name||'未选择素材'}}</p></template>
    <label>尺寸比例<input v-model.number="edit.pipSize" aria-label="画中画尺寸比例" type="range" min="0.15" max="0.7" step="0.05"/></label>
    <label>位置<select v-model="edit.pipPosition" aria-label="画中画位置"><option value="bottom-right">右下</option><option value="top-right">右上</option><option value="bottom-left">左下</option></select></label>
    <p class="hint">自动匹配读取所选分类的素材描述；手选覆盖自动匹配，清除所选画中画的字幕保持不混剪。当前采用已配置文本模型判断，尚未向量化。</p>
   </details>
  </template>
 </section>
</template>
<style>
/* 主表单依据原厂顺序排列，标签和按钮各用独立行，避免外边距叠加。 */
.edit-controls:has(>.pip-settings){scrollbar-gutter:auto}
.pip-settings{min-width:0;color:inherit}
.pip-settings h3{font-size:var(--app-font-size-card-title);line-height:25px;margin:0}
.pip-settings-summary{font-size:var(--app-font-size-meta);line-height:20px;margin:0;color:#b3c6d9;overflow-wrap:anywhere}
.pip-settings-description{font-size:var(--app-font-size-meta);line-height:22px;margin:14px 0 10px;color:#b3c6d9}
.pip-category-field{display:flex;flex-direction:column;gap:6px;margin:0;font-size:var(--app-font-size-caption);line-height:22px}
.pip-category-field .studio-select-trigger{height:32px;min-height:32px;font-size:var(--app-font-size-body);line-height:22px;padding:4px 11px}
.pip-settings-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:14px}
.pip-settings-actions>button{min-width:0;min-height:32px;padding:4px 10px;font-size:var(--app-font-size-body);line-height:22px;border-radius:7px;font-weight:500}
.pip-settings-actions>.danger{color:#ff345b;border-color:#c94364;background:#63313d55}
.pip-settings-actions>.primary{background:linear-gradient(100deg,#4855ff,#ce69f5)}
.pip-settings-advanced{margin-top:22px;padding-top:12px;border-top:1px solid #ffffff0c}
.pip-settings-advanced>summary{cursor:pointer;color:#b3c6d9;font-size:var(--app-font-size-meta);line-height:22px}
.pip-settings-advanced>label{font-size:var(--app-font-size-caption);margin-top:14px}
.pip-settings-advanced>.full{margin-top:14px}
.pip-settings-advanced .hint,.pip-matching-summary{font-size:var(--app-font-size-meta);line-height:22px;margin-top:12px;overflow-wrap:anywhere;color:#b3c6d9}
.studio-select-menu-pip{--select-visible-rows:4}
@container edit-panel (max-width:290px){.pip-settings-actions>button{padding:4px 5px;font-size:var(--app-font-size-caption)}}
</style>
