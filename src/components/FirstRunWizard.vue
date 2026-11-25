<script setup>
import {computed} from 'vue';
import I from './Icon.vue';
import {environmentItems,environmentCanCreate,releaseMessage} from '../release-ui.mjs';
const props=defineProps({report:Object,busy:Boolean,error:String});
const emit=defineEmits(['check','start','settings','complete']);
const items=computed(()=>environmentItems(props.report)),canCreate=computed(()=>environmentCanCreate(props.report));
const optionalMissing=computed(()=>items.value.filter(item=>item.id!=='text'&&item.status!=='ready'));
const labels={ready:'就绪',missing:'缺失',startable:'可一键启动'};
</script>
<template>
 <section class="first-run-wizard" aria-labelledby="environment-wizard-title" :aria-busy="busy">
  <header class="wizard-heading"><div><p class="wizard-step">开始创作前</p><h1 id="environment-wizard-title">检查创作环境</h1><p>文案服务就绪后即可开始；其余能力可稍后配置，缺失项将在创作页顶部提醒。</p></div><I name="Monitor" :size="32" aria-hidden="true"/></header>
  <p class="wizard-summary" role="status">{{busy?'正在检查或启动现有环境，请稍候…':canCreate?'文案服务就绪，可以开始创作。':'文案服务尚未就绪，请按指引配置后重新检查。'}}</p>
  <ul class="wizard-items" aria-label="六类创作环境检查结果"><li v-for="item in items" :key="item.id" :data-status="item.status"><div class="wizard-item-heading"><h2>{{item.name}}</h2><span><I :name="item.status==='ready'?'CheckCircle2':item.status==='startable'?'Play':'CircleAlert'" :size="16" aria-hidden="true"/>{{labels[item.status]}}</span></div><p>{{item.message}}</p><p v-if="item.status!=='ready'" class="wizard-guide">{{item.guide}}</p><div v-if="item.status!=='ready'" class="wizard-item-actions"><button v-if="item.status==='startable'" :disabled="busy" @click="emit('start')">一键启动并检查</button><button :disabled="busy" @click="emit('settings',['media','fonts'].includes(item.id)?'general':'models')">去设置</button></div></li></ul>
  <p class="hint">就绪表示本次服务响应或必要文件检查通过，生成效果仍需在实际创作中核验；检查不会提交内容生成任务。</p>
  <p v-if="error" class="wizard-error" role="alert">{{releaseMessage(error,'环境检查未能完成，请稍后重试或前往设置检查。')}}</p>
  <footer><button :disabled="busy" @click="emit('check')"><I name="RefreshCw" :class="{spin:busy}" :size="16"/>{{busy?'正在检查…':'重新检查环境'}}</button><button class="primary" :disabled="busy||!canCreate" @click="emit('complete')">{{optionalMissing.length?'跳过其他缺失项，开始创作':'开始创作'}}</button></footer>
 </section>
</template>
<style scoped>
.first-run-wizard{width:min(1060px,100%);padding:28px;border:1px solid var(--border,#494357);border-radius:16px;background:var(--panel,#262835);display:grid;gap:18px;box-sizing:border-box}.wizard-heading{display:flex;justify-content:space-between;gap:20px;align-items:center}.wizard-heading h1{margin:4px 0 10px;font-size:var(--app-font-size-page-title,28px)}.wizard-heading p{color:var(--muted,#b5b9cc);line-height:1.7}.wizard-heading .wizard-step{color:#d5b2ff;font-size:var(--app-font-size-caption,14px)}.wizard-heading>svg{color:#c6a3f6;flex-shrink:0}.wizard-summary{padding:12px 16px;background:#ffffff05;border-radius:8px;color:#ddd0ee;line-height:1.7}.wizard-items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wizard-items li{min-width:0;padding:16px;border:1px solid #ffffff12;border-radius:10px;display:flex;flex-direction:column;gap:10px}.wizard-item-heading{display:flex;gap:10px;align-items:center;justify-content:space-between}.wizard-item-heading h2{font-size:var(--app-font-size-body,16px);margin:0}.wizard-item-heading span{display:flex;gap:5px;align-items:center;flex-shrink:0;font-size:var(--app-font-size-caption,14px);color:#f0c4a0}.wizard-items [data-status=ready] .wizard-item-heading span{color:#abe0ca}.wizard-items [data-status=startable] .wizard-item-heading span{color:#d3b5ff}.wizard-items p{line-height:1.7;overflow-wrap:anywhere;font-size:var(--app-font-size-caption,14px)}.wizard-guide,.first-run-wizard .hint{color:var(--muted,#b5b9cc);line-height:1.7}.wizard-item-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:auto}.wizard-item-actions button{min-height:40px;font-size:var(--app-font-size-caption,14px)}.first-run-wizard footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.first-run-wizard footer button{min-height:44px}.wizard-error{padding:12px;border:1px solid #a56c61;border-radius:8px;background:#71383344;color:#ffc3b6;overflow-wrap:anywhere;line-height:1.7}.first-run-wizard :focus-visible{outline:2px solid #d9b2ff;outline-offset:3px}@media(max-width:740px){.first-run-wizard{padding:18px}.wizard-items{grid-template-columns:1fr}.wizard-heading>svg{display:none}.first-run-wizard footer button{width:100%}}
</style>
