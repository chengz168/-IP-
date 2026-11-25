<script setup>
import {computed,onMounted,ref,useId,watch} from 'vue';
import I from './Icon.vue';
import {call} from '../api';
import {licenseDate,missingFactorNames,releaseMessage} from '../release-ui.mjs';
const props=defineProps({license:Object,embedded:Boolean});
const emit=defineEmits(['activated']);
const info=ref(props.license||null),code=ref(''),pending=ref(''),error=ref(''),notice=ref(''),machineInput=ref(null),errorBox=ref(null);
const formId=useId(),missing=computed(()=>{
 const labels=info.value?.missingFactorLabels;
 return Array.isArray(labels)&&labels.length?labels.map(label=>releaseMessage(label,'系统硬件信息')).join('、'):missingFactorNames(info.value?.missingFactors);
});
watch(()=>props.license,value=>{if(value)info.value=value;});
async function inspect(){
 if(pending.value)return;pending.value='info';error.value='';
 try{info.value=await call('licenseInfo');}catch(reason){error.value=releaseMessage(reason,'授权信息暂时无法读取，请重新检查授权。');}finally{pending.value='';}
}
async function activate(){
 if(pending.value)return;error.value='';notice.value='';
 if(!code.value.trim()){error.value='请先粘贴收到的激活码。';return;}
 pending.value='activate';
 try{const result=await call('licenseActivate',{code:code.value.trim()});info.value=result;if(!result?.activated){error.value=releaseMessage(result?.message,'激活未通过，请核对激活码与本机机器码后重试。');return;}code.value='';notice.value='激活成功，授权信息已保存。';emit('activated',result);}
 catch(reason){error.value=releaseMessage(reason,'激活未能完成，请核对激活码后重试；仍有问题请联系授权提供方。');}
 finally{pending.value='';if(error.value)errorBox.value?.focus();}
}
async function copyMachineCode(){
 notice.value='';if(!info.value?.machineCode)return;
 try{await navigator.clipboard.writeText(info.value.machineCode);notice.value='机器码已复制，可发送给授权提供方。';}
 catch{machineInput.value?.focus();machineInput.value?.select();notice.value='自动复制未成功，机器码已选中，请手动复制。';}
}
onMounted(inspect);
</script>
<template>
 <section class="activation-panel" :class="{embedded}" :aria-labelledby="formId+'-title'" :aria-busy="!!pending">
  <header class="activation-heading"><span class="activation-symbol" aria-hidden="true"><I name="ShieldCheck" :size="28"/></span><div><component :is="embedded?'h3':'h1'" class="activation-title" :id="formId+'-title'">{{embedded?'授权状态':'激活超级IP智能体'}}</component><p>使用本机机器码获取离线激活码，授权校验无需联网。</p></div></header>
  <div class="activation-status" role="status"><strong>{{info?.activated?'已激活':info?.status==='expired'?'授权已过期':'尚未激活'}}</strong><span>{{info?.activated?'可使用已授权功能。':'完成激活后进入本地工作台。'}}</span></div>
  <p v-if="info?.message" class="hint">{{releaseMessage(info.message,'请重新输入激活码；仍有问题请联系授权提供方。')}}</p>
  <label class="machine-label" :for="formId+'-machine'">本机机器码</label><div class="machine-code-row"><input :id="formId+'-machine'" ref="machineInput" :value="info?.machineCode||''" readonly :placeholder="pending==='info'?'正在读取机器码…':'机器码暂不可用，请重新检查授权'" spellcheck="false"/><button type="button" :disabled="!info?.machineCode" @click="copyMachineCode"><I name="Copy" :size="16"/>复制机器码</button></div>
  <dl class="license-facts"><div><dt>授权档位</dt><dd>{{info?.tier||(info?.activated?'暂无可靠信息':'未激活')}}</dd></div><div><dt>有效期</dt><dd>{{info?.activated&&info.permanent?'永久使用':info?.expiresAt?licenseDate(info.expiresAt):info?.activated?'暂无可靠信息':'未激活'}}</dd></div><div v-if="info?.issuedAt"><dt>签发日期</dt><dd>{{licenseDate(info.issuedAt)}}</dd></div><div><dt>缺失硬件信息</dt><dd>{{info?(missing||'无'):'读取中'}}</dd></div></dl>
  <p v-if="missing" class="hint">缺失项不参与匹配，至少需要两项可用硬件信息。<template v-if="!info?.machineCode">请检查系统信息读取权限后重试。</template></p>
  <form class="activation-form" @submit.prevent="activate">
   <label :for="formId+'-code'">{{info?.activated?'更换激活码':'激活码'}}</label><textarea :id="formId+'-code'" v-model="code" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="!!pending" :aria-invalid="!!error" :aria-describedby="error?formId+'-error':formId+'-hint'" placeholder="在这里粘贴授权提供方发送的完整激活码"></textarea>
   <p :id="formId+'-hint'" class="hint">重装系统或更换 Windows 账户后，如原授权文件无法读取，请在此重新输入激活码。</p>
   <p v-if="error" :id="formId+'-error'" ref="errorBox" tabindex="-1" class="activation-error" role="alert">{{error}}</p><p v-if="notice" class="activation-notice" role="status">{{notice}}</p>
   <div class="activation-actions"><button type="button" :disabled="!!pending" @click="inspect">{{pending==='info'?'正在读取…':'重新检查授权'}}</button><button class="primary" type="submit" :disabled="!!pending||!code.trim()"><I v-if="pending==='activate'" name="LoaderCircle" class="spin" :size="16"/>{{pending==='activate'?'正在校验激活码…':info?.activated?'更新授权':'激活并继续'}}</button></div>
  </form>
 </section>
</template>
<style scoped>
.activation-panel{width:min(700px,100%);padding:30px;border:1px solid var(--border,#494357);border-radius:16px;background:var(--panel,#262835);display:grid;gap:16px;box-sizing:border-box}.activation-panel.embedded{width:100%;padding:0;background:none;border:0}.activation-heading{display:flex;align-items:flex-start;gap:16px}.activation-heading .activation-title{font-size:var(--app-font-size-section-title,24px);margin:0 0 8px}.activation-heading p,.activation-status span{color:var(--muted,#b5b9cc);line-height:1.7}.activation-symbol{width:48px;height:48px;display:grid;place-items:center;background:#6b498b40;border-radius:12px;color:#d8b9ff;flex-shrink:0}.activation-status{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px;background:#ffffff05;border-radius:8px}.activation-status strong{color:#d7c3ff}.machine-label{margin:0}.machine-code-row{display:flex;gap:10px;min-width:0}.machine-code-row input{min-width:0;flex:1;font-family:monospace}.machine-code-row button{flex-shrink:0}.license-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0}.license-facts dt{color:var(--muted,#b5b9cc);font-size:var(--app-font-size-caption,14px)}.license-facts dd{margin:5px 0 0;overflow-wrap:anywhere}.activation-form{display:grid;gap:10px}.activation-form label{margin:0}.activation-form textarea{resize:vertical;min-height:96px;max-height:240px;overflow-wrap:anywhere}.activation-actions{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end}.activation-actions button,.machine-code-row button{min-height:44px}.activation-panel .hint{margin:0;line-height:1.7;overflow-wrap:anywhere}.activation-error{color:#ffc3b6;background:#71383344;border:1px solid #a56c61;padding:12px;border-radius:8px;overflow-wrap:anywhere;line-height:1.7}.activation-notice{color:#a9e2c8;line-height:1.7}.activation-panel :focus-visible{outline:2px solid #d9b2ff;outline-offset:3px}@media(max-width:640px){.activation-panel{padding:20px}.machine-code-row{flex-direction:column}.license-facts{grid-template-columns:1fr}.activation-heading{gap:10px}.activation-symbol{display:none}}
</style>
