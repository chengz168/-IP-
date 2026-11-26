<script setup>
import {computed,ref,watch} from 'vue';
const props=defineProps({src:String,modelValue:Object,disabled:Boolean});
const emit=defineEmits(['update:modelValue']);
const picture=ref(null),loaded=ref(false),failed=ref(false),anchor=ref(null);
watch(()=>props.src,()=>{loaded.value=false;failed.value=false;anchor.value=null;});
const box=computed(()=>props.modelValue?{left:props.modelValue.x*100+'%',top:props.modelValue.y*100+'%',width:props.modelValue.width*100+'%',height:props.modelValue.height*100+'%'}:{});
const fields=[['x','左侧'],['y','顶部'],['width','宽度'],['height','高度']];
function toggle(enabled){if(!props.disabled)emit('update:modelValue',enabled?{x:.3,y:.1,width:.4,height:.3}:null);}
function point(event){const rect=picture.value.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};}
function begin(event){if(props.disabled||!loaded.value||event.button!==0)return;anchor.value={...point(event),previous:props.modelValue};picture.value.setPointerCapture(event.pointerId);}
function regionAt(event,start=anchor.value){const end=point(event);return {x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)};}
function move(event){if(anchor.value&&!props.disabled)emit('update:modelValue',regionAt(event));}
function finish(event){if(!anchor.value)return;const old=anchor.value.previous,region=regionAt(event);emit('update:modelValue',region.width<.01||region.height<.01?old:region);anchor.value=null;}
function cancel(){if(anchor.value)emit('update:modelValue',anchor.value.previous);anchor.value=null;}
function number(key,value){if(props.disabled||!props.modelValue)return;const percent=Number(value);if(!Number.isFinite(percent)||value==='')return;const minimum=key==='width'||key==='height'?0.01:0,maximum=key==='x'||key==='y'?0.99:1,next={...props.modelValue,[key]:Math.max(minimum,Math.min(maximum,percent/100))};if(key==='x')next.width=Math.min(next.width,1-next.x);if(key==='y')next.height=Math.min(next.height,1-next.y);if(key==='width')next.width=Math.min(next.width,1-next.x);if(key==='height')next.height=Math.min(next.height,1-next.y);emit('update:modelValue',next);}
</script>
<template>
  <fieldset class="image-edit-control">
    <legend>局部画面修改</legend>
    <label class="image-edit-toggle"><input type="checkbox" :checked="!!modelValue" :disabled="disabled" @change="toggle($event.target.checked)"/>仅重绘框选区域</label>
    <p>适合添加或替换局部物件。区域外回贴主参考原图，避免整图重绘改变产品结构；结果仍需预览确认。此选项只用于本次生成，不会修改已确认图片。</p>
    <template v-if="modelValue">
      <p>在主参考图上按住并拖动框选，或展开数值输入微调位置。只覆盖需要修改的部分，请避开要保留的控制件。</p>
      <div v-if="src" ref="picture" class="image-edit-picture" :class="{locked:disabled}" @pointerdown.prevent="begin" @pointermove="move" @pointerup="finish" @pointercancel="cancel" aria-label="局部重绘参考图框选区">
        <img :src="src" alt="用于局部修改的主参考原图" draggable="false" @load="loaded=true;failed=false" @error="loaded=false;failed=true"/>
        <div v-if="loaded" class="image-edit-box" :style="box"><span>重绘区域</span></div>
      </div>
      <p v-if="failed" role="alert">主参考图片加载失败，请检查素材后再生成。</p>
      <details><summary>数值微调（占原图百分比）</summary><div class="image-edit-fields"><label v-for="[key,title] in fields" :key="key">{{title}}（%）<input type="number" :value="Math.round(modelValue[key]*10000)/100" :min="key==='width'||key==='height'?1:0" max="100" step="0.1" :disabled="disabled" :aria-label="'重绘区域'+title+'百分比'" @input="number(key,$event.target.value)"/></label></div></details>
    </template>
  </fieldset>
</template>
<style scoped>
.image-edit-control{min-width:0;margin-block:14px;padding:14px;border:1px solid var(--border,#454152);border-radius:10px;display:grid;gap:12px}.image-edit-control legend{font-size:14px;padding-inline:6px}.image-edit-control p{margin:0;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.image-edit-toggle{display:flex;align-items:center;gap:8px;cursor:pointer}.image-edit-toggle input::after{display:none;content:none}.image-edit-toggle input{appearance:auto;accent-color:#a46ee7;width:17px;height:17px;min-height:17px;padding:0;margin:0}.image-edit-picture{position:relative;min-width:0;cursor:crosshair;touch-action:none;user-select:none;overflow:hidden;background:#171923;border-radius:6px}.image-edit-picture.locked{cursor:wait}.image-edit-picture img{display:block;width:100%;height:auto;pointer-events:none}.image-edit-box{position:absolute;border:2px solid #d8bbff;background:rgba(170,110,240,.22);pointer-events:none;box-sizing:border-box}.image-edit-box span{position:absolute;top:0;left:0;font-size:12px;padding:2px 5px;background:#593188;color:white;white-space:nowrap}.image-edit-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.image-edit-fields label{display:grid;gap:8px;min-width:0}.image-edit-fields input{width:100%;min-width:0}summary{cursor:pointer;font-size:13px;line-height:1.7}
</style>
