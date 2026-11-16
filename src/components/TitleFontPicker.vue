<script setup>
import {computed,h,ref,watch} from 'vue';
import ASelect from 'ant-design-vue/es/select';
import AConfigProvider from 'ant-design-vue/es/config-provider';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {call} from '../api';
import {loadTitleFont} from '../title-render.mjs';
const props=defineProps({modelValue:String,fonts:Array,fallback:String});
const emit=defineEmits(['update:modelValue']);
const families=ref({}),failed=ref({});
const selected=computed(()=>(props.fonts||[]).find(font=>font.id===props.modelValue));
// 保留接口顺序，只加载已选字体；菜单和已选标签共用真实字体预览。
const options=computed(()=>(props.fonts||[]).map(font=>({
 value:font.id,searchLabel:font.label,disabled:font.missing===true,
 label:h('span',{class:'title-font-label',style:{fontFamily:families.value[font.id]||'"'+font.label+'", "'+font.family+'"'}},font.label)
})));
function filter(input,option){return option.searchLabel.toLocaleLowerCase().includes(input.toLocaleLowerCase());}
async function load(font){
 if(!font||families.value[font.id]||failed.value[font.id])return;
 try{families.value={...families.value,[font.id]:await loadTitleFont(call,font)};}
 catch(error){failed.value={...failed.value,[font.id]:error.message};}
}
watch(selected,load,{immediate:true});
</script>
<template>
 <div class="title-font-picker" :title="selected?.label||fallback">
  <AConfigProvider :locale="zhCN"><ASelect :value="modelValue||undefined" :options="options" :placeholder="fallback||'请选择字体'" size="small" show-search popup-class-name="title-font-dropdown dark-dropdown" :filter-option="filter" @update:value="emit('update:modelValue',$event)"/></AConfigProvider>
 </div>
</template>
