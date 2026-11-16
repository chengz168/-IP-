<script setup>
import {inject,computed} from 'vue';
const {currentWorkflow:job,workflowLocked,stopWorkflow,navigate,startWorkflow}=inject('studio');
const labels={queued:'排队中',running:'处理中',stopping:'正在停止',cancelled:'已取消',failed:'失败',unknown:'远程结果待确认',interrupted:'已中断',awaiting_publish:'成片就绪，待发布'};
const view=computed(()=>job.value?.view||job.value);
const retry=computed(()=>view.value&&['failed','cancelled','interrupted','stale'].includes(view.value.status));
const statusText=computed(()=>{const label=view.value?.label||labels[view.value?.status]||view.value?.status||'';return ['awaiting_publish','stale'].includes(view.value?.status)||!job.value?.phase?label:label+' · '+job.value.phase;});
</script>
<template><div v-if="job" class="workflow-job-status" :class="view.status" role="status" aria-label="自动流程状态"><div><strong>{{statusText}}</strong><small v-if="view.message&&(view.current===false||view.status==='awaiting_publish')">{{view.message}}</small><small v-else-if="job.error">{{job.error}}</small><small v-else>成片准备 {{job.progress}}%</small></div><button v-if="workflowLocked" :disabled="job.status==='stopping'" @click="stopWorkflow">{{job.status==='stopping'?'正在停止…':'停止流程'}}</button><button v-else-if="retry" @click="startWorkflow(job.mode)">重新处理</button><button @click="navigate('tasks')">查看任务</button></div></template>
