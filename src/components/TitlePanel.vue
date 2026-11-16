<script setup>
import {computed,inject,ref,onMounted} from 'vue';
import {CheckboxGroup as ACheckboxGroup} from 'ant-design-vue/es/checkbox';
import I from './Icon.vue';
import CoverRange from './CoverRange.vue';
import CoverColor from './CoverColor.vue';
import TitleStyleGroup from './TitleStyleGroup.vue';
import TitleFontPicker from './TitleFontPicker.vue';
import {call} from '../api';
import {titleTemplates,titleDesign,titleStyle,titleGenerationSignature,selectTitleTemplate,switchTitleMode} from '../../server/title-model.mjs';
import {canGenerateEditTitle} from '../../server/edit-title-request.mjs';
import {titleFontCatalog} from '../title-font-catalog.mjs';
const {draft:d,state,busy,notify,save,act}=inject('studio'),availableFonts=ref([]),error=ref('');
// 卡片使用原版独立预览图，并随程序打包以支持离线显示。
const previewAssets=import.meta.glob('../assets/title-previews/*.png',{eager:true,query:'?url',import:'default'});
const previewUrl=id=>previewAssets[`../assets/title-previews/${id}.png`];
const design=computed(()=>titleDesign(d.value.edit)),style=computed(()=>titleStyle(design.value.custom));
const fonts=computed(()=>titleFontCatalog(availableFonts.value,style.value));
const summary=computed(()=>!d.value.edit.titleEnabled?'已关闭':design.value.mode==='template'?titleTemplates.find(t=>t.id===design.value.templateId)?.name||'选择模板':'自定义样式');
const generating=computed(()=>busy.value==='生成主副标题');
const canGenerate=computed(()=>canGenerateEditTitle(d.value));
const fontStyleOptions=[{value:'bold',label:'加粗'},{value:'italic',label:'斜体'},{value:'underline',label:'下划线'}];
const fontStyles=computed(()=>fontStyleOptions.filter(option=>style.value[option.value]).map(option=>option.value));
function fontStylesChanged(values){update({custom:{...style.value,bold:values.includes('bold'),italic:values.includes('italic'),underline:values.includes('underline'),fontWeight:values.includes('bold')?700:400}});}
onMounted(async()=>{try{availableFonts.value=await call('listSubtitleFonts');}catch(e){error.value=e.message;}});
function update(value){d.value.edit.titleDesign={...design.value,...value};}
function custom(key,value){update({custom:{...style.value,[key]:value,...(key==='color'?{secondaryColor:value}:{}),...(key==='bold'?{fontWeight:value?700:400}:{})}});}
function effect(group,key,value){custom(group,{...style.value[group],[key]:value});}
function text(key,value){update({});d.value.edit[key]=value;}
function choose(template){d.value.edit.titleDesign=selectTitleTemplate(d.value.edit,template);}
function switchMode(mode){d.value.edit.titleDesign=switchTitleMode(d.value.edit,mode);}
function duration(event){const raw=event.target.valueAsNumber,value=Number.isFinite(raw)?Math.max(1,Math.min(60,Math.round(raw))):3;event.target.value=String(value);update({duration:value});}
function font(value){const f=fonts.value.find(f=>f.id===value);if(f)update({custom:{...style.value,fontId:f.id,fontFamily:f.family}});}
async function generate(){await save();const signature=titleGenerationSignature(d.value),result=await act('生成主副标题',()=>call('generateEditTitle',{id:d.value.id}));if(!result)return;if(signature!==result.signature||titleGenerationSignature(d.value)!==signature){notify('任务或文案已变化，生成结果保留在执行记录中，未覆盖标题');return;}update({});d.value.edit.title=result.title;d.value.edit.subtitle=result.subtitle;notify('已收到本地模型返回的主副标题','success');}
</script>
<template>
 <div class="title-panel">
  <header><h3>标题</h3><p>{{summary}}</p></header>
  <div class="title-panel-scroll">
   <div class="title-inputs"><input :value="d.edit.title" maxlength="500" aria-label="主标题" placeholder="主标题" @input="text('title',$event.target.value)"/><input :value="d.edit.subtitle" maxlength="500" aria-label="副标题" placeholder="副标题" @input="text('subtitle',$event.target.value)"/><button class="icon-button" aria-label="生成主副标题" title="AI生成标题" :disabled="!!busy||!canGenerate" :aria-busy="generating" @click="generate"><I :name="generating?'LoadingOutlined':'ThunderboltOutlined'" :size="20"/></button></div>
   <div class="title-option title-duration-option"><span>显示时长</span><div class="segmented" role="group" aria-label="标题显示时长"><button :class="{active:design.displayMode==='always'}" @click="update({displayMode:'always'})">一直显示</button><button :class="{active:design.displayMode==='seconds'}" @click="update({displayMode:'seconds'})">显示几秒</button></div><label v-if="design.displayMode==='seconds'" class="title-seconds"><input :value="design.duration" type="number" min="1" max="60" step="1" aria-label="标题显示秒数" @change="duration"/><span>秒</span></label></div>
   <div class="title-option"><span>标题样式</span><div class="segmented" role="group" aria-label="标题样式模式"><button :class="{active:design.mode==='template'}" @click="switchMode('template')">模板</button><button :class="{active:design.mode==='custom'}" @click="switchMode('custom')">自定义</button></div></div>
   <template v-if="design.mode==='template'">
    <p class="hint">模板样式已预设字体和效果，可在右侧编辑预览中上下拖动标题位置。</p>
    <div class="title-template-grid"><button v-for="template in titleTemplates" :key="template.id" class="title-template-card" :class="{active:design.templateId===template.id}" :aria-pressed="design.templateId===template.id" @click="choose(template)"><strong>{{template.name}}</strong><div class="title-template-preview"><img :src="previewUrl(template.id)" :alt="`${template.name}预览`"/></div></button></div>
   </template>
   <div v-else class="title-custom">
    <TitleStyleGroup title="基础样式" description="字体、字号、颜色和文字样式" :summary="`${style.fontSize} / ${Math.round(style.opacity*100)}%`">
     <label class="title-font-field" aria-label="标题字体">字体<TitleFontPicker :model-value="style.fontId||fonts.find(f=>f.family===style.fontFamily)?.id||''" :fonts="fonts" :fallback="style.fontFamily" @update:model-value="font"/></label>
     <CoverRange :value-only="true" :model-value="style.fontSize" label="标题字号" display-label="字号" :min="24" :max="160" :step="2" @update:model-value="custom('fontSize',$event)"/>
     <CoverColor ant-input :model-value="style.color" label="颜色" @update:model-value="custom('color',$event)"/>
     <CoverRange :value-only="true" :model-value="style.opacity*100" label="文字透明度" display-label="透明度" :min="0" :max="100" :step="5" suffix="%" @update:model-value="custom('opacity',$event/100)"/>
     <div class="title-style-toggles" role="group" aria-label="标题字形"><span>字体样式</span><ACheckboxGroup :value="fontStyles" :options="fontStyleOptions" @change="fontStylesChanged"/></div>
    </TitleStyleGroup>
    <TitleStyleGroup title="位置排版" description="标题位置和字间距" :summary="`顶部 ${style.top}`">
     <CoverRange :value-only="true" :model-value="style.letterSpacing" label="字间距" :min="0" :max="50" @update:model-value="custom('letterSpacing',$event)"/>
     <CoverRange :value-only="true" :model-value="style.top" label="顶部距离" :min="0" :max="800" :step="10" @update:model-value="custom('top',$event)"/>
    </TitleStyleGroup>
    <TitleStyleGroup title="描边" :summary="`${style.stroke.width<=2?'标准描边':'粗描边'} / ${style.stroke.width}`" :enabled="style.stroke.enabled" toggle-label="标题描边" @toggle="effect('stroke','enabled',$event)">
     <CoverRange :value-only="true" :model-value="style.stroke.width" label="描边宽度" :min="0" :max="6" :step="0.5" @update:model-value="effect('stroke','width',$event)"/>
     <CoverColor ant-input :model-value="style.stroke.color" label="描边颜色" @update:model-value="effect('stroke','color',$event)"/>
    </TitleStyleGroup>
    <TitleStyleGroup title="阴影" :summary="`${style.shadow.color} / ${style.shadow.distance} / ${Math.round(style.shadow.opacity*100)}%`" :enabled="style.shadow.enabled" toggle-label="标题阴影" @toggle="effect('shadow','enabled',$event)">
     <CoverRange :value-only="true" :model-value="style.shadow.distance" label="阴影距离" :min="0" :max="20" @update:model-value="effect('shadow','distance',$event)"/>
     <CoverRange :value-only="true" :model-value="style.shadow.opacity*100" label="阴影透明度" :min="0" :max="100" :step="5" suffix="%" @update:model-value="effect('shadow','opacity',$event/100)"/>
     <CoverColor ant-input :model-value="style.shadow.color" label="阴影颜色" @update:model-value="effect('shadow','color',$event)"/>
    </TitleStyleGroup>
    <TitleStyleGroup title="背景" :summary="`${style.background.color} / ${Math.round(style.background.opacity*100)}% / ${style.background.paddingX}x${style.background.paddingY}`" :enabled="style.background.enabled" toggle-label="标题背景" @toggle="effect('background','enabled',$event)">
     <CoverColor ant-input :model-value="style.background.color" label="背景颜色" @update:model-value="effect('background','color',$event)"/>
     <CoverRange :value-only="true" :model-value="style.background.opacity*100" label="背景透明度" :min="0" :max="100" :step="5" suffix="%" @update:model-value="effect('background','opacity',$event/100)"/>
     <CoverRange :value-only="true" v-for="[key,label,max,step] in [['radius','背景圆角',240,1],['paddingX','背景宽度',120,2],['paddingY','背景高度',80,2]]" :key="key" :model-value="style.background[key]" :label="label" :min="0" :max="max" :step="step" @update:model-value="effect('background',key,$event)"/>
    </TitleStyleGroup>
   </div>
   <p v-if="error" class="title-operation-error" role="alert">{{error}}</p>
   <p v-if="!d.edit.titleDesign" class="hint">当前为旧版标题，修改设置后使用新版绘制。</p>
  </div>
 </div>
</template>
