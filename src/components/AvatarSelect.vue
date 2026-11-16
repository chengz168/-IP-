<script setup>
import {computed,inject} from 'vue';
import DropdownSelect from './DropdownSelect.vue';
import AvatarLabel from './AvatarLabel.vue';
defineOptions({inheritAttrs:false});
const props=defineProps({modelValue:String,disabled:Boolean});
const emit=defineEmits(['update:modelValue']);
const {state}=inject('studio');
const options=computed(()=>state.value.avatars.map(avatar=>({value:avatar.id,label:avatar.name,assetId:state.value.assets.some(asset=>asset.id===avatar.assetId)?avatar.assetId:'',posterId:state.value.assets.some(asset=>asset.id===avatar.posterId&&asset.type==='image')?avatar.posterId:''})));
const selected=computed(()=>options.value.some(option=>option.value===props.modelValue)?props.modelValue:'');
</script>
<template><DropdownSelect v-bind="$attrs" root-class="avatar-select" :model-value="selected" :options="options" :disabled="disabled" :placeholder="modelValue?'形象已缺失，请重新选择':'请选择形象'" variant="avatar" @update:model-value="emit('update:modelValue',$event)"><template #selected="{option,label}"><AvatarLabel :option="option" :label="label"/></template><template #option="{option}"><AvatarLabel :option="option"/></template></DropdownSelect></template>
