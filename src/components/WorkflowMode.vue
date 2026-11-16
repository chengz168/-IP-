<script setup>
import {inject,computed} from 'vue';import I from './Icon.vue';
const {draft,workflowLocked}=inject('studio');
const selected=computed(()=>draft.value.mode||'manual');
const modes=[['manual','手动','Zap'],['auto','自动','Cloud'],['background','后台','Clock']];
</script>
<template><div class="workflow-mode-control" role="group" aria-label="执行模式"><button v-for="[value,label,icon] in modes" :key="value" :disabled="workflowLocked" :aria-pressed="selected===value" :class="{active:selected===value}" @click="draft.mode=value"><I :name="icon" :size="16"/>{{label}}</button><button class="workflow-mode-help" aria-label="执行模式说明" title="手动：逐步点击执行。自动：第二步确认后，后续步骤串行执行。后台：第二步确认后，创建后台任务异步执行。"><I name="HelpCircle" :size="16"/></button></div></template>
