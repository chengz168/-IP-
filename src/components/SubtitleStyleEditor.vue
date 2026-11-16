<script setup>
import {ref,watch,onUnmounted,computed} from 'vue';
import Modal from './Modal.vue';
import I from './Icon.vue';
import SubtitleFontPicker from './SubtitleFontPicker.vue';
import {call} from '../api';
import {subtitlePresets,presetStyle,validateSubtitleStyle} from '../../server/subtitle-style.mjs';
import {subtitleEditorPreview} from '../subtitle-editor-preview.mjs';
import {DesktopOutlined,MobileOutlined,BorderOutlined,BgColorsOutlined,EyeInvisibleOutlined,AimOutlined,ArrowDownOutlined,ColumnWidthOutlined,BoldOutlined,ItalicOutlined,UnderlineOutlined} from '@ant-design/icons-vue';
const props=defineProps({initial:Object,fonts:Array,saving:Boolean,operationError:String});
const emit=defineEmits(['close','change','confirm']);
const s=ref({...props.initial}),tab=ref('basic'),more=ref(false),image=ref(''),source=ref(''),error=ref(''),rendering=ref(false),valid=ref(false),selected=ref(props.initial.presetId||'');
let timer,active=true,running=false,pending=null,revision=0;
function paintRange(el){const lo=Number(el.min)||0,hi=Number(el.max)||100;el.style.setProperty('--range-progress',((Number(el.value)-lo)/(hi-lo)*100)+'%');el.title=String(el.value);}
const vRangeProgress={mounted:paintRange,updated:paintRange};
const previewScale=.25;
const previewStyle=computed(()=>subtitleEditorPreview(s.value,props.fonts.find(font=>font.id===s.value.fontId)?.family||s.value.fontFamily));
const presetPreviews=[{color:'#FFFFFF',textShadow:'2px 2px 4px rgba(0,0,0,.8)'},{color:'#000000',WebkitTextStroke:'1px #FFFFFF'},{color:'#FFDE00',WebkitTextStroke:'1px #000000'},{color:'#FFFFFF',WebkitTextStroke:'1px #FE8A80'},{color:'#FFFFFF',background:'rgba(0,0,0,.8)',letterSpacing:'.5px'},{color:'#000000',background:'rgba(255,255,255,.9)',letterSpacing:'.3px'},{color:'#000000',background:'rgba(255,222,0,.9)',fontWeight:'bold'},{color:'#FFFFFF',background:'rgba(167,79,89,.9)',fontWeight:'bold',letterSpacing:'.5px'}];
watch(()=>s.value.referenceHeight,async height=>{try{const data=await call('subtitlePreviewSource',{referenceHeight:height});if(active&&s.value.referenceHeight===height)source.value=data;}catch(e){if(active)error.value=e.message;}},{immediate:true});
const usualFont=computed(()=>props.fonts.find(f=>f.family==='Microsoft YaHei')||props.fonts[0]);
const tabs=[['basic','基础样式'],['effects','特效设置'],['background','背景设置'],['position','位置布局']];
const visibleTabs=computed(()=>tab.value==='position'?tabs.slice(1):tabs);
function updateFont(){const item=props.fonts.find(f=>f.id===s.value.fontId);if(item)s.value.fontFamily=item.family;selected.value='';}
function choosePreset(p){s.value=presetStyle(p.id,s.value,usualFont.value);selected.value=p.id;}
function orientation(height){if(s.value.referenceHeight===height)return;s.value.bottomMargin=Math.round(s.value.bottomMargin*height/s.value.referenceHeight);s.value.referenceHeight=height;}
function reset(){choosePreset(subtitlePresets[0]);}
async function drain(){
  if(running||!pending||!active)return;
  const job=pending;pending=null;running=true;rendering.value=true;
  try{const result=await call('previewSubtitle',{style:job.style});if(active&&job.revision===revision){image.value=result.dataUrl;error.value='';valid.value=true;}}
  catch(e){if(active&&job.revision===revision){error.value=e.message;valid.value=false;}}
  finally{running=false;if(active){rendering.value=!!pending;if(pending)drain();}}
}
function schedule(){
  s.value.presetId=selected.value;emit('change',{...s.value});revision++;valid.value=false;pending=null;clearTimeout(timer);
  try{const style=validateSubtitleStyle(s.value);error.value='';const next={style,revision};timer=setTimeout(()=>{pending=next;drain();},250);}
  catch(e){error.value=e.message;}
}
watch(s,schedule,{deep:true,immediate:true});
watch(selected,value=>{s.value.presetId=value;});
onUnmounted(()=>{active=false;clearTimeout(timer);pending=null;});
</script>
<template>
  <Modal title="字幕样式设置" variant="subtitle-style" @close="!saving&&emit('close')">
    <div class="subtitle-editor">
      <section class="subtitle-preview-pane">
        <header><strong>预览效果</strong><div class="subtitle-orientation" role="group" aria-label="预览方向"><button aria-label="横版" :class="{active:s.referenceHeight===1080}" :aria-pressed="s.referenceHeight===1080" @click="orientation(1080);selected=''"><DesktopOutlined aria-hidden="true"/>横版</button><button aria-label="竖版" :class="{active:s.referenceHeight===1920}" :aria-pressed="s.referenceHeight===1920" @click="orientation(1920);selected=''"><MobileOutlined aria-hidden="true"/>竖版</button></div></header>
        <div class="subtitle-preview-stage"><div class="subtitle-preview-canvas" :class="{vertical:s.referenceHeight===1920}"><img v-if="source" :src="source" alt="字幕样式示意背景"/><div v-if="source" class="subtitle-editor-sample" :style="previewStyle">这个神仙锅刷</div></div></div>
      </section>
      <section class="subtitle-settings-pane" :aria-busy="saving">
        <div class="subtitle-tabs"><div role="tablist" aria-label="字幕样式分类"><button v-for="[key,label] in visibleTabs" :key="key" role="tab" :aria-selected="tab===key" :class="{active:tab===key}" @click="tab=key;more=false">{{label}}</button></div><div class="subtitle-overflow" @mouseenter="more=true" @mouseleave="more=false"><button class="subtitle-more" aria-label="更多字幕设置" :aria-expanded="more" @click="more=!more">···</button><div v-if="more" class="subtitle-tab-menu"><button @click="tab=tab==='position'?'basic':'position';more=false">{{tab==='position'?'基础样式':'位置布局'}}</button></div></div><button class="subtitle-close" aria-label="关闭字幕设置" :disabled="saving" @click="emit('close')"><I name="X" :size="18"/></button></div>
        <div class="subtitle-style-fields" :class="'subtitle-tab-'+tab" role="tabpanel" @input="selected=''">
          <template v-if="tab==='basic'">
            <span class="subtitle-field-title">预设样式</span>
            <div class="subtitle-preset-grid"><button v-for="(preset,index) in subtitlePresets" :key="preset.id" :class="{selected:selected===preset.id}" :aria-pressed="selected===preset.id" :aria-label="preset.name" @click="choosePreset(preset)"><span :style="presetPreviews[index]">样式</span><small>{{preset.name}}</small></button></div>
            <div class="subtitle-divider"></div>
            <div class="subtitle-font-row"><div class="subtitle-font-field"><span>字体</span><SubtitleFontPicker v-model="s.fontId" :fonts="fonts" :fallback="s.fontFamily" :disabled="saving" @update:model-value="updateFont"/></div><label>字体大小<div class="subtitle-range-value"><input v-model.number="s.fontSize" type="range" v-range-progress min="32" max="96" step="1" aria-label="字幕字号滑块"/><output aria-label="字幕字号">{{s.fontSize}}</output></div></label></div>
            <span class="subtitle-field-title">字体样式</span><div class="subtitle-font-toggles"><button :class="{active:s.bold}" :aria-pressed="s.bold" aria-label="粗体" @click="s.bold=!s.bold;selected=''"><BoldOutlined/></button><button :class="{active:s.italic}" :aria-pressed="s.italic" aria-label="斜体" @click="s.italic=!s.italic;selected=''"><ItalicOutlined/></button><button :class="{active:s.underline}" :aria-pressed="s.underline" aria-label="下划线" @click="s.underline=!s.underline;selected=''"><UnderlineOutlined/></button></div>
            <div class="subtitle-two-fields"><label>颜色<div class="subtitle-color-field"><input v-model="s.color" type="color" aria-label="字幕颜色选择器"/><input v-model="s.color" aria-label="字幕颜色" maxlength="7"/></div></label><label>透明度<div class="subtitle-range-value"><input v-model.number="s.opacity" type="range" v-range-progress min="0" max="100" step="10" aria-label="字幕透明度"/><output>{{s.opacity}}%</output></div></label></div>
          </template>
          <template v-else-if="tab==='effects'">
            <h3 class="subtitle-section-title"><BorderOutlined/>描边设置</h3><label class="subtitle-check"><input v-model="s.outlineEnabled" type="checkbox"/>启用描边</label>
            <div v-if="s.outlineEnabled" class="subtitle-option-box"><div class="subtitle-two-fields"><label>描边宽度<div class="subtitle-range-value"><input v-model.number="s.outlineWidth" type="range" v-range-progress min="0" max="10" step="1" aria-label="描边宽度"/><output>{{s.outlineWidth}}</output></div><div class="subtitle-outline-preview">实际预览: {{Math.round(s.outlineWidth*previewScale*10)/10}}px</div></label><label>描边颜色<div class="subtitle-color-field"><input v-model="s.outlineColor" type="color" aria-label="描边颜色选择器"/><input v-model="s.outlineColor" aria-label="描边颜色" maxlength="7"/></div></label></div></div>
            <div class="subtitle-divider"></div><h3 class="subtitle-section-title">🌓 阴影设置</h3><label class="subtitle-check"><input v-model="s.shadowEnabled" type="checkbox"/>启用阴影</label>
            <div v-if="s.shadowEnabled" class="subtitle-option-box"><div class="subtitle-two-fields"><label>阴影距离<div class="subtitle-range-value"><input v-model.number="s.shadowDistance" type="range" v-range-progress min="0" max="10" step="1" aria-label="阴影距离"/><output>{{s.shadowDistance}}</output></div></label><label>阴影透明度<div class="subtitle-range-value"><input v-model.number="s.shadowOpacity" type="range" v-range-progress min="0" max="100" step="10" aria-label="阴影透明度"/><output>{{s.shadowOpacity}}%</output></div></label></div><label class="subtitle-shadow-color">阴影颜色<div class="subtitle-color-field"><input v-model="s.shadowColor" type="color" aria-label="阴影颜色选择器"/><input v-model="s.shadowColor" aria-label="阴影颜色" maxlength="7"/></div></label></div>
          </template>
          <template v-else-if="tab==='background'"><h3 class="subtitle-section-title"><BgColorsOutlined/>背景样式</h3><div class="subtitle-background-options"><label><input v-model="s.backgroundEnabled" type="radio" :value="false" name="subtitle-background"/><EyeInvisibleOutlined/>无背景</label><label><input v-model="s.backgroundEnabled" type="radio" :value="true" name="subtitle-background"/><BgColorsOutlined/>纯色背景</label></div><div v-if="s.backgroundEnabled" class="subtitle-option-box"><div class="subtitle-two-fields"><label>背景颜色<div class="subtitle-color-field"><input v-model="s.backgroundColor" type="color" aria-label="背景颜色选择器"/><input v-model="s.backgroundColor" aria-label="背景颜色" maxlength="7"/></div></label><label>背景透明度<div class="subtitle-range-value"><input v-model.number="s.backgroundOpacity" type="range" v-range-progress min="0" max="100" step="10" aria-label="背景透明度"/><output>{{s.backgroundOpacity}}%</output></div></label></div></div></template>
          <template v-else><h3 class="subtitle-section-title"><AimOutlined/>位置调整</h3><label class="subtitle-position-field"><span><ArrowDownOutlined/>底部距离</span><input v-model.number="s.bottomMargin" type="number" min="0" max="800" step="1" aria-label="字幕底部距离"/></label><div class="subtitle-divider"></div><h3 class="subtitle-section-title"><ColumnWidthOutlined/>间距设置</h3><label class="subtitle-position-field"><span><ColumnWidthOutlined/>字间距</span><input v-model.number="s.letterSpacing" type="number" min="0" max="50" step="1" aria-label="字幕字间距"/></label></template>
        </div>
        <p v-if="error||operationError" class="subtitle-style-error" role="alert">{{error||operationError}}</p>
        <footer class="subtitle-editor-footer"><button :disabled="saving" @click="reset">重置默认</button><button :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="saving||!valid||rendering" @click="emit('confirm',{...s})">{{saving?'保存中…':'确认设置'}}</button></footer>
      </section>
    </div>
  </Modal>
</template>

<style>
.modal-backdrop.subtitle-style-backdrop{padding:30px;backdrop-filter:none;background:#08091099}
.modal.subtitle-style-modal{width:790px;max-width:calc(100vw - 60px);height:702px;max-height:calc(100vh - 60px);border-radius:12px;background:#1b1d29;overflow:hidden}
.modal.subtitle-style-modal>header{display:none}
.subtitle-style-modal>.modal-body{padding:0;overflow:hidden;display:flex;flex:1}
.subtitle-editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);height:100%;width:100%;min-height:0}
.subtitle-editor button,.subtitle-editor input,.subtitle-editor select{font-size:var(--app-font-size-body);border-radius:4px}
.subtitle-editor button{min-height:28px;padding:3px 10px;line-height:1.35}
.subtitle-preview-pane{min-width:0;min-height:0;border-right:1px solid #454752;display:flex;flex-direction:column}
.subtitle-preview-pane>header{height:50px;min-height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;gap:8px;border-bottom:1px solid #454752;background:#252733}
.subtitle-preview-pane strong{font-size:var(--app-font-size-body);white-space:nowrap}
.subtitle-orientation{display:flex;flex-shrink:0}
.subtitle-orientation button{display:flex;align-items:center;justify-content:center;gap:4px;padding:0 16px;min-height:24px;border:0;background:#3d414c;color:#c0c3cd}
.subtitle-orientation .active{background:#3c50ff;color:white}
.subtitle-preview-stage{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;padding:12px;overflow:auto;color:#a4a8b4}
.subtitle-preview-canvas{position:relative;width:480px;max-width:100%;aspect-ratio:16/9;flex-shrink:0;border:1px solid #454752;border-radius:8px;overflow:hidden;background:#252733}
.subtitle-preview-canvas.vertical{width:270px;aspect-ratio:9/16}
.subtitle-preview-canvas>img{display:block;width:100%;height:100%;object-fit:cover}
.subtitle-editor-sample{max-width:90%;overflow-wrap:break-word;text-shadow:2px 2px 4px #000c;font-synthesis:weight style}
.subtitle-preview-busy{position:absolute;bottom:10px;background:#151725d9;padding:4px 8px;font-size:var(--app-font-size-micro);border-radius:4px}
/* 右栏独立边线与自动滚动，避免预留滚动条持续挤窄所有表单列。 */
.subtitle-settings-pane{min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;border-left:1px solid #454752}
.subtitle-tabs{margin:12px 12px 0;height:44px;min-height:44px;display:flex;position:relative;border-bottom:1px solid #454752;padding-right:26px}
.subtitle-tabs [role=tablist]{display:flex;flex:1;min-width:0;gap:2px;overflow:hidden}
.subtitle-tabs [role=tab]{flex:0 0 auto;min-width:0;padding:5px 16px;border:1px solid #454752;border-radius:8px 8px 0 0;background:#252733;color:#a5a9b3;white-space:nowrap;font-size:var(--app-font-size-body)}
.subtitle-tabs [role=tab].active{color:#208aff;border-bottom-color:#1b1d29;background:#1b1d29}
.subtitle-more{border:0;background:transparent;padding:0!important;flex:0 0 21px;color:#b7becd}
.subtitle-close{position:absolute;right:6px;top:7px;transform:translateY(-3px);padding:1px!important;min-height:24px!important;border:0;background:transparent}
.subtitle-tab-menu{position:absolute;top:44px;right:0;z-index:2;background:#30323d;border:1px solid #535562;padding:4px;box-shadow:0 3px 12px #0006}
.subtitle-tab-menu>button{border:0;background:none;white-space:nowrap}
.subtitle-overflow{position:relative;display:flex;align-items:center;flex:0 0 21px}
.subtitle-overflow .subtitle-tab-menu{top:100%;left:0;right:auto;min-width:120px;padding:4px 0;background:white;border:0;border-radius:8px;color:#171717;box-shadow:0 6px 16px #0002}
.subtitle-overflow .subtitle-tab-menu>button{width:100%;text-align:left;color:inherit;min-height:30px}
.subtitle-style-fields{padding:25px 16px 18px;overflow:auto;min-height:0;flex:1;color:#a4a8b3}
.subtitle-field-title{display:block;font-size:var(--app-font-size-body);line-height:1.5;margin-bottom:4px}
.subtitle-preset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.subtitle-preset-grid>button{position:relative;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:6px;min-width:0;height:70px;padding:8px;border:1px solid #454752;border-radius:6px;background:#252733;color:#a4a8b3}
.subtitle-preset-grid>button.selected{border-color:#3c50ff;box-shadow:0 0 0 1px #3c50ff;background:#30304b;color:#5366ff}
.subtitle-preset-grid>button>span{height:24px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:var(--app-font-size-micro);font-weight:400}
.subtitle-preset-grid small{white-space:nowrap;font-size:var(--app-font-size-caption);line-height:22px}
.subtitle-preset-grid>button.selected:after{content:"✓";position:absolute;right:-6px;top:-6px;border-radius:50%;width:16px;height:16px;line-height:16px;font-size:12px;background:#3c50ff;color:#fff}
.subtitle-divider{height:1px;background:#454752;margin:12px 0}
.subtitle-style-fields label{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;color:#a4a8b3;font-size:var(--app-font-size-body);line-height:22px;min-width:0}
/* 原参考字体行按十四列/十列分配，列间八像素。 */
.subtitle-font-row{display:grid;grid-template-columns:minmax(0,calc(58.333333% - 3.333333px)) minmax(0,1fr);gap:8px}
.subtitle-font-field{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0 0 12px;color:#a4a8b3;font-size:var(--app-font-size-body);line-height:22px}
.subtitle-style-fields input:not([type=range]):not([type=checkbox]):not([type=radio]),.subtitle-style-fields select{height:28px;min-height:28px;padding:2px 6px;border:1px solid #454752;background:#252733;color:#e0e1e8;min-width:0;width:100%}
.subtitle-style-fields .subtitle-font-row select{height:24px;min-height:24px;padding:0 6px}
.subtitle-font-row .subtitle-range-value{min-height:24px;height:24px}
.subtitle-style-fields label>input,.subtitle-style-fields label>select{margin-top:0}
.subtitle-style-fields input[type=range]{width:100%;min-width:0;padding:0;margin:0;height:24px;accent-color:#4255ff;appearance:none;background:none}
.subtitle-style-fields input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,#4255ff 0 var(--range-progress,0%),#454752 var(--range-progress,0%) 100%)}
.subtitle-style-fields input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5px;background:#539bd9;border:2px solid #eceff6;border-radius:50%}
.subtitle-range-value{display:flex;align-items:center;gap:8px;min-height:28px}
.subtitle-range-value>input[type=number]{width:32px!important;flex:0 0 32px;padding:0!important;border:0!important;text-align:right;background:none!important;appearance:textfield}
.subtitle-range-value>input::-webkit-inner-spin-button{appearance:none}
.subtitle-range-value output{font-size:var(--app-font-size-caption);flex-shrink:0;min-width:32px;text-align:right;color:#a4a8b3}
.subtitle-font-toggles{display:flex;gap:8px;margin:4px 0 12px}
.subtitle-font-toggles>button{width:38px;height:28px;padding:0;background:transparent;color:#ddd;border:1px solid #454752}
.subtitle-font-toggles .active{background:#3c50ff;color:white;border-color:#3c50ff}
.subtitle-two-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.subtitle-tab-basic>.subtitle-two-fields label{gap:4px}
.subtitle-color-field{display:flex;align-items:center;gap:8px;min-width:0}
.subtitle-style-fields .subtitle-color-field>input[type=color]{width:28px;flex:0 0 28px;padding:0;background:none;cursor:pointer}
.subtitle-color-field>input[type=color]::-webkit-color-swatch-wrapper{padding:0}
.subtitle-color-field>input[type=color]::-webkit-color-swatch{border:0;border-radius:3px}
.subtitle-color-field>input:not([type=color]){font-size:var(--app-font-size-caption)}
.subtitle-section-title{display:flex;align-items:center;gap:6px;font-size:var(--app-font-size-meta)!important;margin:0 0 24px!important;color:#d2d4dc}
.subtitle-style-fields .subtitle-check{display:flex;flex-direction:row;align-items:center;gap:8px;color:#e0e1e8;margin:0 0 36px}
.subtitle-style-fields input[type=checkbox],.subtitle-style-fields input[type=radio]{width:16px;height:16px;flex-shrink:0;accent-color:#2783ff}
.subtitle-style-fields input[type=checkbox]{appearance:auto;border-radius:2px}
.subtitle-style-fields input[type=checkbox]:after{display:none}
.subtitle-style-fields input[type=radio]{appearance:none;padding:0;background:white;border:1px solid #89909b;border-radius:50%;position:relative}
.subtitle-style-fields input[type=radio]:checked{background:#2684ff;border-color:#2684ff}
.subtitle-style-fields input[type=radio]:checked:after{content:"";position:absolute;width:6px;height:6px;background:white;left:4px;top:4px;border-radius:50%}
.subtitle-option-box{background:#252733;border:1px solid #454752;border-radius:6px;padding:14px 12px;margin-bottom:16px}
.subtitle-option-box label{margin-bottom:10px}
.subtitle-option-box+.subtitle-divider{margin:16px 0}
.subtitle-background-options{display:flex;align-items:center;gap:16px;margin-bottom:36px;flex-wrap:wrap}
.subtitle-background-options label{flex-direction:row;align-items:center;gap:6px;color:#e0e1e8;margin:0}
.subtitle-position-field{max-width:175px;margin-bottom:42px!important}
.subtitle-position-field+.subtitle-divider{margin:0 0 20px}
.subtitle-outline-preview{width:calc(50% - 4px);border:1px solid #454752;text-align:center;font-size:var(--app-font-size-micro);color:#777e90;margin-top:4px;line-height:1.6}
.subtitle-tab-effects .subtitle-option-box{min-height:144px}
.subtitle-tab-effects .subtitle-two-fields label{margin-bottom:0}
.subtitle-style-fields .subtitle-shadow-color{max-width:50%;margin-top:24px}
.subtitle-style-fields .subtitle-shadow-color input{max-width:100%}
.subtitle-tab-effects .subtitle-range-value>output,.subtitle-tab-background .subtitle-range-value>output{display:none}
.subtitle-editor-footer{border-top:1px solid #454752;padding:12px 16px;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:#252733;flex-shrink:0;min-height:56px}
.subtitle-editor-footer button{min-height:32px;padding:3px 12px;white-space:nowrap;background:transparent;border:1px solid #454752}
.subtitle-editor-footer .primary{background:#3c50ff;border-color:#3c50ff;color:white}
.subtitle-editor-footer>button:nth-child(1){min-width:96px}
.subtitle-editor-footer>button:nth-child(2){min-width:68px}
.subtitle-editor-footer>button:nth-child(3){min-width:96px}
.subtitle-style-error{margin:0;padding:8px 16px;background:#462d36;color:#ffb9b9;font-size:var(--app-font-size-micro);line-height:1.5;max-height:90px;overflow:auto}
.subtitle-editor button:focus-visible{outline:2px solid #7b9bff;outline-offset:2px}
/* 控件区按原版实际截图保留正文标签及独立滚动。 */
.subtitle-style-fields label,.subtitle-field-title{font-size:var(--app-font-size-body)}
.subtitle-field-title{line-height:22px}
.subtitle-preset-grid>button>span{font-size:10px;font-synthesis:weight style}
.subtitle-preset-grid small{line-height:16px}
.subtitle-font-toggles>button{display:flex;align-items:center;justify-content:center;font-size:16px}
.subtitle-style-modal .subtitle-style-fields .subtitle-color-field>input[type=color]{width:28px;flex:0 0 28px;padding:0}
.subtitle-outline-preview{width:100%;margin-top:0;line-height:20px}
.subtitle-position-field>span{display:flex;align-items:center}
.subtitle-settings-pane .subtitle-style-fields{padding-top:27px}
@media(max-height:800px){.subtitle-style-fields{padding-top:23px}}
@media(max-width:800px){.modal-backdrop.subtitle-style-backdrop{padding:12px}.modal.subtitle-style-modal{max-width:calc(100vw - 24px)}.subtitle-editor{grid-template-columns:minmax(200px,.85fr) minmax(360px,1fr)}}
</style>
