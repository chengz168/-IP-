// 增强的通知系统
import { ref } from 'vue'

/**
 * 通知类型及配置
 */
const NotificationTypes = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  PROGRESS: 'progress'
}

const notificationConfig = {
  [NotificationTypes.INFO]: {
    duration: 4000,
    icon: 'HelpCircle',
    persistent: false
  },
  [NotificationTypes.SUCCESS]: {
    duration: 3000,
    icon: 'CheckCircle2',
    persistent: false
  },
  [NotificationTypes.WARNING]: {
    duration: 6000,
    icon: 'CircleAlert',
    persistent: false
  },
  [NotificationTypes.ERROR]: {
    duration: 0, // 需要手动关闭
    icon: 'CircleAlert',
    persistent: true
  },
  [NotificationTypes.PROGRESS]: {
    duration: 0,
    icon: 'LoaderCircle',
    persistent: true
  }
}

/**
 * 通知系统 Composable
 */
export function useNotification() {
  const toast = ref(null)
  const toastTimer = ref(null)

  /**
   * 显示通知
   */
  function notify(message, type = NotificationTypes.INFO, options = {}) {
    const config = notificationConfig[type] || notificationConfig[NotificationTypes.INFO]

    const duration = options.duration !== undefined ? options.duration : config.duration
    const persistent = options.persistent !== undefined ? options.persistent : config.persistent

    toast.value = {
      message,
      type,
      icon: options.icon || config.icon,
      persistent,
      actions: options.actions || null,
      progress: options.progress || null,
      id: Date.now()
    }

    clearTimeout(toastTimer.value)

    if (!persistent && duration > 0) {
      toastTimer.value = setTimeout(() => {
        dismiss()
      }, duration)
    }

    return toast.value.id
  }

  /**
   * 显示成功通知
   */
  function success(message, options = {}) {
    return notify(message, NotificationTypes.SUCCESS, options)
  }

  /**
   * 显示错误通知
   */
  function error(message, options = {}) {
    return notify(message, NotificationTypes.ERROR, options)
  }

  /**
   * 显示警告通知
   */
  function warning(message, options = {}) {
    return notify(message, NotificationTypes.WARNING, options)
  }

  /**
   * 显示进度通知
   */
  function progress(message, percent, options = {}) {
    return notify(message, NotificationTypes.PROGRESS, {
      ...options,
      progress: { percent, ...options.progress }
    })
  }

  /**
   * 更新现有通知
   */
  function update(id, updates) {
    if (toast.value && toast.value.id === id) {
      toast.value = { ...toast.value, ...updates }
    }
  }

  /**
   * 关闭通知
   */
  function dismiss() {
    if (toast.value && !toast.value.persistent) {
      toast.value = null
      clearTimeout(toastTimer.value)
    } else if (toast.value) {
      // 允许关闭持久通知
      toast.value = null
      clearTimeout(toastTimer.value)
    }
  }

  /**
   * 关闭瞬时通知（不包括错误）
   */
  function dismissTransient() {
    if (toast.value && toast.value.type !== NotificationTypes.ERROR && !toast.value.persistent) {
      toast.value = null
      clearTimeout(toastTimer.value)
    }
  }

  return {
    toast,
    notify,
    success,
    error,
    warning,
    progress,
    update,
    dismiss,
    dismissTransient
  }
}
