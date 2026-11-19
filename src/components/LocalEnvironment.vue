<script setup>
import {computed,inject,ref,watch} from 'vue';
import I from './Icon.vue';
import {call} from '../api';
import {localEnvironmentSummary,localEnvironmentStatus,localEnvironmentConfig,localEnvironmentBusy} from '../local-environment-ui.mjs';
const props=defineProps({configure:Boolean});
const emit=defineEmits(['settings']);
const {state,refresh}=inject('studio');
const report=computed(()=>state.value?.localEnvironment);
const config=ref(localEnvironmentConfig(state.value?.settings?.localEnvironment));
const baseline=ref(JSON.stringify(config.value)),pending=ref(''),error=ref(''),message=ref('');
const dirty=computed(()=>JSON.stringify(config.value)!==baseline.value);
const checking=computed(()=>localEnvironmentBusy(report.value));
const blocked=computed(()=>!!pending.value||checking.value);
const checkLabel=computed(()=>state.value?.settings?.localEnvironment?.autoStart===false?'检查环境':'检查并启动');
// 轮询只更新未修改的配置，保留用户尚未保存的路径和开关。
watch(()=>state.value?.settings?.localEnvironment,value=>{if(!dirty.value&&!pending.value){config.value=localEnvironmentConfig(value);baseline.value=JSON.stringify(config.value);}},{deep:true});
async function operate(action){
 if(pending.value||checking.value)return false;
 if(action==='ensureLocalEnvironment'&&props.configure&&dirty.value){error.value='启动配置尚未保存，请先保存，再检查环境。';return;}
 pending.value=action;error.value='';message.value='';
 const snapshot=localEnvironmentConfig(config.value);
 try{
  const result=await call(action,action==='saveLocalEnvironment'?{settings:snapshot}:{});
  if(action==='saveLocalEnvironment')baseline.value=JSON.stringify(snapshot);
  if(result&&Array.isArray(result.services))state.value.localEnvironment=result;
  await refresh();
  if(action==='saveLocalEnvironment'){config.value=localEnvironmentConfig(state.value?.settings?.localEnvironment);baseline.value=JSON.stringify(config.value);}
  message.value=action==='saveLocalEnvironment'?'启动配置已保存。检查并启动将使用已保存的模型来源与地址。':'本地环境检查已完成，请查看各项实际状态。';
  return true;
 }catch(reason){error.value=reason?.message||'本地环境操作失败，请重试。';return false;}
 finally{pending.value='';}
}
// 设置页切换分类时保留本组件实例，离开确认可读取并单独保存启动配置。
defineExpose({dirty,blocked,pending,save:()=>operate('saveLocalEnvironment')});
</script>
<template>
<section class="local-environment" aria-label="本地环境管理" :aria-busy="blocked">
 <div class="environment-heading"><div><h3>本地运行环境</h3><p class="hint">{{localEnvironmentSummary(report)}}</p></div><button v-if="!configure" @click="emit('settings')"><I name="Settings" :size="16"/>启动设置</button></div>
 <p class="hint">按已保存的模型来源检查本机服务。服务响应和文件预检不代表已经验证生成；声音、口型等按需环境会在执行任务时加载模型。</p>
 <ul v-if="report?.services?.length" class="environment-services" aria-label="本地服务状态">
  <li v-for="service in report.services" :key="service.id" :data-status="service.status">
   <div class="environment-service-heading"><strong>{{service.name}}</strong><span class="environment-service-status"><I v-if="['checking','starting'].includes(service.status)" name="LoaderCircle" class="spin" :size="14"/>{{localEnvironmentStatus(service)}}</span></div>
   <p>{{service.message||'暂无详细检查结果'}}</p><p v-if="service.baseUrl" class="environment-path">服务地址：{{service.baseUrl}}</p><p v-if="service.logPath" class="environment-path">日志：{{service.logPath}}</p>
  </li>
 </ul>
 <p v-else class="hint environment-empty">{{checking?'正在识别当前配置所需的本地服务…':'暂无服务检查结果，可点击下方按钮检查。'}}</p>
 <p v-if="state?.settings?.localEnvironment?.autoStart===false" class="hint">自动启动已关闭：打开软件、生成前和手动检查均只检测现有服务。需要软件启动服务时，请先开启并保存自动启动。</p>
 <div v-if="configure" class="environment-config">
  <label class="environment-auto"><input v-model="config.autoStart" type="checkbox" :disabled="!!pending"/>软件打开时自动检查并启动本地服务</label>
  <p class="hint">仅启动已安装、当前模型配置使用的本机服务。以下路径可留空自动识别；不会下载模型或依赖。</p>
  <label>ComfyUI 安装目录<input v-model="config.comfyRoot" :disabled="!!pending" aria-label="ComfyUI 安装目录" placeholder="留空自动识别现有 ComfyUI 目录"/></label>
  <label>ComfyUI Python 程序<input v-model="config.comfyPython" :disabled="!!pending" aria-label="ComfyUI Python 程序" placeholder="留空自动识别；或填写 python.exe 完整路径"/></label>
  <label>Ollama 程序<input v-model="config.ollamaExecutable" :disabled="!!pending" aria-label="Ollama 程序" placeholder="留空自动识别；或填写 ollama.exe 完整路径"/></label>
  <p class="hint">模型来源和服务地址仍在本页对应能力中配置并保存；本区仅保存启动方式。</p>
 </div>
 <p v-if="error" class="environment-error" role="alert">{{error}}</p><p v-if="message" class="hint" role="status">{{message}}</p>
 <div class="environment-actions"><button v-if="configure" :disabled="blocked||!dirty" @click="operate('saveLocalEnvironment')"><I name="Save" :size="16"/>{{pending==='saveLocalEnvironment'?'正在保存…':'保存启动配置'}}</button><button class="primary" :disabled="blocked" @click="operate('ensureLocalEnvironment')"><I :name="blocked?'LoaderCircle':'RefreshCw'" :class="{spin:blocked}" :size="16"/>{{blocked?(pending==='saveLocalEnvironment'?'正在保存…':'正在检查或启动…'):checkLabel}}</button><span v-if="configure&&dirty" class="hint">启动配置待保存</span></div>
</section>
</template>
<style scoped>
.local-environment{min-width:0;display:grid;gap:14px}.environment-heading,.environment-service-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.environment-heading h3{margin-bottom:4px}.environment-heading button{flex-shrink:0}.environment-heading .hint{margin:0}.environment-services{list-style:none;margin:0;padding:0;display:grid;gap:10px}.environment-services li{min-width:0;border:1px solid var(--border,#393246);border-radius:8px;padding:12px 14px;background:#191b2540}.environment-services p{font-size:var(--app-font-size-caption);margin-top:6px;overflow-wrap:anywhere;white-space:pre-wrap}.environment-service-heading strong{min-width:0;overflow-wrap:anywhere}.environment-service-status{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;color:#b7bfd2;font-size:var(--app-font-size-meta)}[data-status=failed] .environment-service-status,.environment-error{color:#ffb5a4}[data-status=ready] .environment-service-status{color:#9ee0c5}[data-status=starting] .environment-service-status,[data-status=checking] .environment-service-status{color:#cfb6fb}.environment-path{color:var(--muted,#adb2c8);font-size:var(--app-font-size-meta)!important}.environment-config{min-width:0;border-top:1px solid var(--border,#393246);padding-top:14px}.environment-auto{display:flex;align-items:center;gap:10px;margin:0 0 8px}.environment-auto input{margin:0}.environment-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.environment-error{overflow-wrap:anywhere;white-space:pre-wrap}.environment-empty{padding:12px 0}@media(max-width:1150px){.environment-service-heading{align-items:flex-start}.environment-service-status{max-width:45%;white-space:normal;text-align:right}}
</style>
