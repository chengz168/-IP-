<script setup>
import {computed,inject,ref,watch} from 'vue';
import SubtitleStyleEditor from './SubtitleStyleEditor.vue';
import CaptionHistory from './CaptionHistory.vue';
import SubtitleTemplateCard from './SubtitleTemplateCard.vue';
import {call} from '../api';
import {fromLegacySubtitle,toEditorSubtitle} from '../../server/subtitle-style.mjs';
import {subtitleTemplates} from '../../server/subtitle-templates.mjs';
import {subtitleOffset} from '../../server/subtitle-position.mjs';
const emit=defineEmits(['import','timeline']);
const {draft:d,state,notify,save,refresh,busy}=inject('studio');
const referenceLayout=computed(()=>state.value.settings.view==='new');
const mode=computed(()=>d.value.edit.subtitleMode==='template'?'template':'custom');
const chosen=computed(()=>subtitleTemplates.find(t=>t.id===d.value.edit.subtitleTemplate));
const position=computed({get:()=>chosen.value?subtitleOffset(d.value.edit,chosen.value):0,set:value=>{d.value.edit.subtitleOffsetY=Number(value);delete d.value.edit.subtitleTemplateY;}});
const positionLabel=computed(()=>position.value>0?'上移 '+position.value:position.value<0?'下移 '+Math.abs(position.value):'默认');
const summary=computed(()=>mode.value==='template'?(chosen.value?.name||'请选择模板')+(chosen.value?.keywordSupported&&d.value.edit.subtitleKeywords?' · 关键词高亮':''):'自定义样式');
function chooseTemplate(template){const offset=position.value;Object.assign(d.value.edit,{subtitleMode:'template',subtitleTemplate:template.id,subtitleOffsetY:offset,subtitleKeywords:typeof d.value.edit.subtitleKeywords==='boolean'?d.value.edit.subtitleKeywords:false});delete d.value.edit.subtitleTemplateY;}
function switchMode(value){if(value==='template'&&!chosen.value)chooseTemplate(subtitleTemplates.find(t=>t.id==='simple_yellow_white'));else d.value.edit.subtitleMode=value;}
const historyOpen=ref(false);
const open=ref(false),loading=ref(false),saving=ref(false),fonts=ref([]),temporary=ref(null),saveError=ref('');
watch(()=>d.value.id,()=>{open.value=false;historyOpen.value=false;temporary.value=null;saveError.value='';});
async function editStyle(){if(loading.value)return;loading.value=true;try{const [catalog,size]=await Promise.all([call('listSubtitleFonts'),!temporary.value?call('subtitleSourceSize',{id:d.value.id}):Promise.resolve(undefined)]);fonts.value=catalog;const defaultFont=fonts.value.find(f=>f.family==='Microsoft YaHei')||fonts.value[0];temporary.value=temporary.value||toEditorSubtitle(fromLegacySubtitle(d.value.edit,size,defaultFont),size);open.value=true;}catch(e){notify(e.message,'error');}finally{loading.value=false;}}
function saveFailureMessage(error){
  const message=String(error?.message||'保存未完成，请重试');
  if(/\b(?:EPERM|EACCES|EROFS)\b/.test(message))return '工作目录当前不可写，请解除只读或检查目录权限后重试。当前编辑内容已保留。';
  if(/\bENOSPC\b/.test(message))return '磁盘空间不足，请清理空间后重试。当前编辑内容已保留。';
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}
async function confirm(style){if(saving.value)return;saving.value=true;saveError.value='';const id=d.value.id;try{await save();await call('saveSubtitleStyle',{id,style});if(d.value.id===id)await refresh(true);open.value=false;notify('字幕样式已保存','success');}catch(e){saveError.value='字幕样式保存失败：'+saveFailureMessage(e);}finally{saving.value=false;}}
function legacy(){delete d.value.edit.subtitleCustom;temporary.value=null;}
</script>
<template>
  <div class="subtitle-panel">
    <header class="subtitle-panel-heading"><h3>字幕</h3><p>{{summary}}</p></header>
    <div class="subtitle-panel-scroll">
      <div class="subtitle-mode-row"><span>字幕样式</span><div class="segmented" role="group" aria-label="字幕模式"><button :class="{active:mode==='template'}" :aria-pressed="mode==='template'" @click="switchMode('template')">模板</button><button :class="{active:mode==='custom'}" :aria-pressed="mode==='custom'" @click="switchMode('custom')">自定义</button></div></div>
      <template v-if="mode==='template'">
        <label class="subtitle-keyword-toggle" :class="{unavailable:!chosen?.keywordSupported}"><input v-model="d.edit.subtitleKeywords" type="checkbox" :disabled="!chosen?.keywordSupported" aria-label="智能高亮关键词"/><span>{{chosen?.keywordSupported?'智能高亮关键词':'当前样式暂不支持关键词高亮'}}</span></label>
        <p class="subtitle-group-label">选择样式模板</p>
        <div class="subtitle-template-grid"><SubtitleTemplateCard v-for="template in subtitleTemplates" :key="template.id" :template="template" :selected="chosen?.id===template.id" :font-directory="state.settings.subtitleFontsDir||''" @select="chooseTemplate"/></div>
        <div class="subtitle-position"><label for="subtitle-template-position">上下位置</label><div><input id="subtitle-template-position" v-model="position" type="range" min="-200" max="600" step="10" aria-label="模板上下位置"/><output>{{positionLabel}}</output></div></div>
      </template>
      <div v-else-if="referenceLayout" class="subtitle-reference-custom"><div><span>自定义样式</span><b>按字体、颜色、位置等细节自由调整</b></div><button :disabled="loading||!!busy" @click="editStyle">{{loading?'读取中…':'调整样式'}}</button></div>
      <div v-else class="subtitle-custom-controls">
        <label>字幕样式<select :value="d.edit.subtitleCustom?'custom':d.edit.subtitleStyle" aria-label="字幕样式" @change="if($event.target.value!=='custom'){legacy();d.edit.subtitleStyle=$event.target.value}"><option v-if="d.edit.subtitleCustom" value="custom">自定义样式</option><option value="white">经典白字描黑</option><option value="yellow">醒目黄字描黑</option><option value="box">白字背景条</option></select></label>
        <button class="full" :disabled="loading||!!busy" @click="editStyle">{{loading?'正在读取字体…':'调整样式'}}</button>
        <template v-if="!d.edit.subtitleCustom"><label>字号（以1080宽为基准）<input v-model.number="d.edit.subtitleFontSize" type="number" min="20" max="120"/></label><label>字幕位置<select v-model="d.edit.subtitlePosition"><option value="bottom">底部</option><option value="middle">居中</option><option value="top">顶部</option></select></label><label>每行字数<input v-model.number="d.edit.subtitleMaxChars" type="number" min="4" max="40"/></label><label>安全边距 {{Math.round(d.edit.subtitleMargin*100)}}%<input v-model.number="d.edit.subtitleMargin" type="range" min="0.02" max="0.4" step="0.01"/></label></template>
        <p v-else class="hint">{{d.edit.subtitleCustom.fontFamily}} · {{d.edit.subtitleCustom.fontSize}}<br/>{{d.edit.subtitleCustom.bold?'粗体 · ':''}}{{d.edit.subtitleCustom.color}}</p>
      </div>
      <div v-if="!referenceLayout" class="subtitle-tools"><p class="hint">已保存 {{d.edit.captions.length}} 条字幕，导出后将烧录至画面。</p><button class="secondary full" @click="emit('import')">导入 SRT</button><button class="secondary full" :disabled="!!busy||!(d.edit.sourceId||d.video.assetId)" @click="emit('timeline')">编辑字幕时间轴</button><button v-if="d.artifacts?.captionHistory?.length" class="secondary full" :disabled="!!busy" @click="historyOpen=true">字幕历史（{{d.artifacts.captionHistory.length}}）</button></div>
    </div>
    <CaptionHistory v-if="historyOpen" @close="historyOpen=false"/>
    <SubtitleStyleEditor v-if="open" :initial="temporary" :fonts="fonts" :saving="saving" :operation-error="saveError" @change="temporary=$event;saveError=''" @close="open=false" @confirm="confirm"/>
  </div>
</template>
<style scoped>
.subtitle-panel{display:flex;flex-direction:column;min-width:0;height:100%;gap:12px}.subtitle-panel-heading{flex-shrink:0}.subtitle-panel-heading h3{font-size:var(--app-font-size-card-title);line-height:25px;margin:0}.subtitle-panel-heading p{font-size:var(--app-font-size-meta);line-height:20px;color:var(--muted)}
.subtitle-panel-scroll{min-height:0;overflow:auto;scrollbar-gutter:stable;padding-right:5px;flex:1}.subtitle-mode-row{display:flex;align-items:center;gap:28px;min-width:0;margin-bottom:14px}.subtitle-mode-row>span,.subtitle-group-label{font-size:var(--app-font-size-caption);color:var(--muted);line-height:22px}.subtitle-mode-row .segmented{min-width:0;flex-shrink:0;border:1px solid #5e3b6f;border-radius:8px;background:#292b37;padding:3px;gap:2px}.subtitle-mode-row .segmented button{padding:2px 10px;min-height:28px;line-height:22px}
.subtitle-keyword-toggle{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:var(--app-font-size-caption);line-height:22px}.subtitle-keyword-toggle input[type=checkbox]{appearance:auto;width:16px;height:16px;flex-shrink:0;margin:0;accent-color:#a867ff}.subtitle-keyword-toggle input:after{display:none}.subtitle-keyword-toggle.unavailable{color:#747889}.subtitle-keyword-toggle span{min-width:0;overflow-wrap:anywhere}.subtitle-group-label{margin:0 0 6px}
.subtitle-template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.subtitle-position{margin:10px 0 0}.subtitle-position label{margin:0;font-size:var(--app-font-size-caption);line-height:24px}.subtitle-position>div{display:flex;align-items:center;gap:12px}.subtitle-position input{min-width:0;flex:1;margin:0}.subtitle-position button{padding:4px 0;min-height:30px}
.subtitle-custom-controls,.subtitle-tools{display:flex;flex-direction:column;gap:12px;min-width:0}.subtitle-custom-controls>label,.subtitle-custom-controls>p{margin:0}.subtitle-tools{margin-top:14px}.subtitle-tools>p{margin:0}.subtitle-tools>button{flex-shrink:0}
.subtitle-reference-custom{display:flex;align-items:center;justify-content:space-between;gap:12px}.subtitle-reference-custom>div{display:grid;gap:6px;min-width:0}.subtitle-reference-custom span{color:var(--muted);font-size:var(--app-font-size-caption);font-weight:900}.subtitle-reference-custom b{color:var(--text);font-size:var(--app-font-size-meta)}.subtitle-reference-custom>button{flex-shrink:0;height:28px;min-height:28px;padding:0 10px;border:1px solid #3c50ff;border-radius:4px;color:#3c50ff;background:transparent;font-size:var(--app-font-size-body)}
.subtitle-position output{min-width:48px;text-align:right;flex-shrink:0;font-size:var(--app-font-size-caption)}
.subtitle-mode-row{gap:12px}.subtitle-mode-row>span{flex:0 0 72px;font-weight:900}.subtitle-mode-row .segmented button{font-size:var(--app-font-size-body)}
@media(max-width:1230px){.subtitle-mode-row{gap:8px;flex-wrap:wrap}.subtitle-mode-row .segmented button{padding:3px 8px}}
</style>
