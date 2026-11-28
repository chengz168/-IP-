<script setup>
defineProps({status:{type:Object,required:true}});
</script>
<template>
 <section class="brain-generation-progress" aria-label="IP创作生成进度">
  <div class="brain-generation-caption" role="status" aria-live="polite"><strong>{{status.label}}</strong><span v-if="status.value!==undefined">{{status.value}}%</span><span v-else>处理中</span></div>
  <div class="brain-generation-track" :class="{'is-indeterminate':status.value===undefined}" role="progressbar" :aria-label="status.label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="status.value" :aria-valuetext="status.value===undefined?'处理中，暂无可计算进度':undefined"><i :style="status.value===undefined?undefined:{width:status.value+'%'}"></i></div>
  <p>{{status.detail}}</p>
 </section>
</template>
<style scoped>
.brain-generation-progress{margin:0 0 12px;padding:14px 16px;border:1px solid var(--border,#3b465b);border-radius:10px;background:var(--panel,#202a3b)}
.brain-generation-caption{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:var(--app-font-size-caption);line-height:1.5}
.brain-generation-caption strong{font-weight:500;min-width:0;overflow-wrap:anywhere}
.brain-generation-caption span{flex-shrink:0;color:var(--muted,#b3bfd2);font-size:var(--app-font-size-meta)}
.brain-generation-track{height:6px;margin:10px 0;border-radius:999px;overflow:hidden;background:#ffffff14}
.brain-generation-track i{display:block;height:100%;border-radius:inherit;background:#6e95ff}
.brain-generation-track.is-indeterminate i{width:36%;animation:brain-generation-wait 1.6s ease-in-out infinite}
.brain-generation-progress p{margin:0;color:var(--muted,#b3bfd2);font-size:var(--app-font-size-meta);line-height:1.6;overflow-wrap:anywhere}
@keyframes brain-generation-wait{from{transform:translateX(-100%)}to{transform:translateX(280%)}}
@media(prefers-reduced-motion:reduce){.brain-generation-track.is-indeterminate i{animation:none;transform:translateX(85%)}}
</style>
