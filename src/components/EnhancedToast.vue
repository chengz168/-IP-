<script setup>
import { computed, onMounted, ref } from 'vue'
import I from './Icon.vue'

const props = defineProps({
  message: { type: String, required: true },
  type: { type: String, default: 'info' }, // info | success | warning | error | progress
  icon: { type: String, default: null },
  persistent: { type: Boolean, default: false },
  actions: { type: Array, default: null },
  progress: { type: Object, default: null } // { percent, startTime, label }
})

const emit = defineEmits(['close', 'action'])

const isVisible = ref(false)

onMounted(() => {
  // 进入动画
  requestAnimationFrame(() => {
    isVisible.value = true
  })
})

const toastIcon = computed(() => {
  if (props.icon) return props.icon

  const iconMap = {
    info: 'HelpCircle',
    success: 'CheckCircle2',
    warning: 'CircleAlert',
    error: 'CircleAlert',
    progress: 'LoaderCircle'
  }

  return iconMap[props.type] || 'HelpCircle'
})

const toastClass = computed(() => {
  return {
    [props.type]: true,
    visible: isVisible.value,
    'with-actions': props.actions && props.actions.length > 0,
    'with-progress': props.progress !== null
  }
})

function handleAction(action) {
  emit('action', action)
  if (action.close !== false) {
    emit('close')
  }
}
</script>

<template>
  <div class="enhanced-toast" :class="toastClass" role="status" :aria-live="type === 'error' ? 'assertive' : 'polite'">
    <div class="toast-icon">
      <I :name="toastIcon" :size="20" :class="{ spin: type === 'progress' }" />
    </div>

    <div class="toast-content">
      <div class="toast-message">{{ message }}</div>

      <!-- 进度条 -->
      <div v-if="progress" class="toast-progress-wrapper">
        <div class="toast-progress-bar">
          <div
            class="toast-progress-fill"
            :style="{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }"
          ></div>
        </div>
        <span class="toast-progress-text">{{ Math.round(progress.percent) }}%</span>
      </div>

      <!-- 操作按钮 -->
      <div v-if="actions && actions.length" class="toast-actions">
        <button
          v-for="(action, index) in actions"
          :key="index"
          class="toast-action-btn"
          :class="action.variant || 'default'"
          @click="handleAction(action)"
        >
          <I v-if="action.icon" :name="action.icon" :size="14" />
          {{ action.label }}
        </button>
      </div>
    </div>

    <button
      class="toast-close"
      @click="emit('close')"
      aria-label="关闭提示"
      :title="persistent ? '关闭' : '关闭（或等待自动消失）'"
    >
      <I name="X" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.enhanced-toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 15px 17px;
  background: #393147;
  border: 1px solid #8d69af;
  border-radius: 12px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.7);
  min-width: 320px;
  max-width: min(800px, 85vw);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.enhanced-toast.visible {
  opacity: 1;
  transform: translateY(0);
}

.enhanced-toast.error {
  background: #49303a;
  border-color: #ab526e;
}

.enhanced-toast.success {
  background: #29413d;
  border-color: #548f79;
}

.enhanced-toast.warning {
  background: #4a3d2e;
  border-color: #a08055;
}

.enhanced-toast.info {
  background: #2d3548;
  border-color: #5b7a9f;
}

.enhanced-toast.progress {
  background: #35314a;
  border-color: #7d6ba8;
}

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: currentColor;
}

.toast-icon .spin {
  animation: spin 1s linear infinite;
}

.toast-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast-message {
  line-height: 1.6;
  color: #f0f2fa;
  word-break: break-word;
}

.toast-progress-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.toast-progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.toast-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #9657ff, #3659ff);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.toast-progress-text {
  font-size: var(--app-font-size-micro);
  color: rgba(240, 242, 250, 0.8);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

.toast-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.toast-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: var(--app-font-size-micro);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: #f0f2fa;
  cursor: pointer;
  transition: all 0.15s ease;
}

.toast-action-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.toast-action-btn.primary {
  background: linear-gradient(108deg, #d25ef2, #3b52ff);
  border: none;
  color: white;
  font-weight: 500;
}

.toast-action-btn.primary:hover {
  box-shadow: 0 2px 8px rgba(96, 68, 245, 0.4);
}

.toast-close {
  flex-shrink: 0;
  padding: 2px;
  border: 0;
  background: none;
  color: rgba(240, 242, 250, 0.6);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
  margin-top: 2px;
}

.toast-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(240, 242, 250, 0.9);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 移动端适配 */
@media (max-width: 768px) {
  .enhanced-toast {
    min-width: auto;
    max-width: calc(100vw - 32px);
  }

  .toast-actions {
    flex-direction: column;
  }

  .toast-action-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
