<script setup>
defineProps({drafts:{type:Object,required:true},configured:{type:Object,default:()=>({})},globalConfigured:Boolean});
const capabilities=[['text','文本模型'],['vision','素材视觉标记'],['tts','语音合成'],['asr','语音识别'],['image','非口播图片'],['video','非口播视频'],['avatar','数字人口型'],['clone','声音克隆'],['extract','分享链接提取'],['brain','主页文案采集']];
</script>

<template>
<div class="settings-form-section capability-key-settings"><h3>各能力独立密钥</h3><p class="hint">云端服务可分别配置密钥；未配置或清除后沿用全局密钥。本机引擎不使用这些密钥。这里只显示配置状态，已保存密钥不会回显。</p>
 <div v-for="[scope,label] in capabilities" :key="scope" class="capability-key-row" :data-key-scope="scope">
  <div class="capability-key-heading"><label :for="'key-action-'+scope">{{label}}</label><span class="hint">{{configured[scope]?'已配置独立密钥':globalConfigured?'沿用全局密钥':'尚未配置密钥'}}</span></div>
  <div class="two-fields"><select :id="'key-action-'+scope" v-model="drafts[scope].action" :aria-label="label+'密钥操作'"><option value="keep">保持不变</option><option value="set">设置独立密钥</option><option value="clear">清除并沿用全局</option></select><input v-if="drafts[scope].action==='set'" v-model="drafts[scope].value" type="password" autocomplete="new-password" :aria-label="label+'独立密钥'" :aria-invalid="!!drafts[scope].error" :aria-describedby="'key-hint-'+scope" placeholder="输入此能力的服务密钥"/><p v-else class="hint">{{drafts[scope].action==='clear'?'保存后清除该能力密钥，沿用全局配置。':'已保存的内容保持不变。'}}</p></div>
  <p :id="'key-hint-'+scope" class="hint" role="status">{{drafts[scope].error||''}}</p>
 </div>
</div>
</template>

<style scoped>
.capability-key-row{padding:12px 0;border-top:1px solid var(--border,#393246)}
.capability-key-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px}
.capability-key-heading label{font-weight:600}
.capability-key-heading .hint{margin:0;text-align:right}
.capability-key-row .two-fields{align-items:center}
.capability-key-row p:empty{display:none}
</style>
