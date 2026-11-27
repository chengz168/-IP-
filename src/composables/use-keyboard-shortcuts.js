// 键盘快捷键系统
import { onMounted, onUnmounted } from 'vue'

/**
 * 快捷键配置
 */
export const ShortcutScopes = {
  GLOBAL: 'global',
  EDITOR: 'editor',
  MEDIA: 'media'
}

/**
 * 解析快捷键字符串
 */
function parseShortcut(shortcut) {
  const keys = shortcut.toLowerCase().split('+').map(k => k.trim())
  return {
    ctrl: keys.includes('ctrl') || keys.includes('control'),
    shift: keys.includes('shift'),
    alt: keys.includes('alt'),
    meta: keys.includes('meta') || keys.includes('cmd'),
    key: keys[keys.length - 1].replace(/^(ctrl|control|shift|alt|meta|cmd)\+?/g, '')
  }
}

/**
 * 检查快捷键是否匹配
 */
function matchesShortcut(event, shortcut) {
  const parsed = parseShortcut(shortcut)
  const eventKey = event.key.toLowerCase()
  if (parsed.key === 'esc') parsed.key = 'escape'

  return (
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.metaKey === parsed.meta &&
    (eventKey === parsed.key || event.code.toLowerCase() === parsed.key)
  )
}

/**
 * 检查是否在输入元素中
 */
function isInputElement(element) {
  if (!element) return false

  const tagName = element.tagName.toLowerCase()
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    element.isContentEditable
  )
}

/**
 * 键盘快捷键 Composable
 */
export function useKeyboardShortcuts(shortcuts, options = {}) {
  const {
    scope = ShortcutScopes.GLOBAL,
    ignoreInputs = true,
    enabled = true
  } = options

  const handlers = new Map()

  // 注册快捷键
  Object.entries(shortcuts).forEach(([shortcut, handler]) => {
    handlers.set(shortcut, handler)
  })

  function handleKeydown(event) {
    if (!enabled || event.defaultPrevented || event.isComposing) return
    if (document.querySelector('.modal[role="dialog"]') && event.key !== 'Escape') return

    // 忽略输入元素中的快捷键（某些快捷键除外）
    if (ignoreInputs && isInputElement(event.target)) {
      // 允许在输入框中使用的快捷键（如 Ctrl+S）
      const allowedInInputs = ['ctrl+s', 'ctrl+shift+s', 'esc']
      const isAllowed = Array.from(handlers.keys()).some(
        shortcut => allowedInInputs.includes(shortcut.toLowerCase()) && matchesShortcut(event, shortcut)
      )

      if (!isAllowed) return
    }

    // 匹配并执行快捷键
    for (const [shortcut, handler] of handlers.entries()) {
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault()
        event.stopPropagation()

        try {
          handler(event)
        } catch (error) {
          console.error('[Shortcut Error]', shortcut, error)
        }

        break
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })

  return {
    handlers
  }
}

/**
 * 全局快捷键管理器
 */
class ShortcutManager {
  constructor() {
    this.shortcuts = new Map()
    this.activeScope = ShortcutScopes.GLOBAL
    this.enabled = true

    this.handleKeydown = this.handleKeydown.bind(this)
    document.addEventListener('keydown', this.handleKeydown)
  }

  register(shortcut, handler, scope = ShortcutScopes.GLOBAL) {
    const key = `${scope}:${shortcut}`
    this.shortcuts.set(key, { shortcut, handler, scope })
  }

  unregister(shortcut, scope = ShortcutScopes.GLOBAL) {
    const key = `${scope}:${shortcut}`
    this.shortcuts.delete(key)
  }

  setScope(scope) {
    this.activeScope = scope
  }

  enable() {
    this.enabled = true
  }

  disable() {
    this.enabled = false
  }

  handleKeydown(event) {
    if (!this.enabled || event.defaultPrevented || event.isComposing) return
    // 弹窗和内部编辑器先处理按键，全局操作不能越过弹窗执行。
    if (document.querySelector('.modal[role="dialog"]')) return

    // 忽略输入元素
    if (isInputElement(event.target)) {
      const allowedInInputs = ['ctrl+s', 'ctrl+shift+s', 'esc']
      const isAllowed = Array.from(this.shortcuts.values()).some(
        ({ shortcut }) => allowedInInputs.includes(shortcut.toLowerCase()) && matchesShortcut(event, shortcut)
      )

      if (!isAllowed) return
    }

    // 按作用域匹配快捷键
    for (const { shortcut, handler, scope } of this.shortcuts.values()) {
      if (scope !== this.activeScope && scope !== ShortcutScopes.GLOBAL) {
        continue
      }

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault()
        event.stopPropagation()

        try {
          handler(event)
        } catch (error) {
          console.error('[Global Shortcut Error]', shortcut, error)
        }

        break
      }
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.handleKeydown)
    this.shortcuts.clear()
  }
}

// 单例实例
let globalManager = null

export function useGlobalShortcuts() {
  if (!globalManager) {
    globalManager = new ShortcutManager()
  }

  return globalManager
}

/**
 * 格式化快捷键显示
 */
export function formatShortcut(shortcut) {
  const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform)

  return shortcut
    .split('+')
    .map(key => {
      const formatted = key.trim().toLowerCase()

      if (formatted === 'ctrl' || formatted === 'control') {
        return isMac ? '⌘' : 'Ctrl'
      }
      if (formatted === 'shift') {
        return isMac ? '⇧' : 'Shift'
      }
      if (formatted === 'alt') {
        return isMac ? '⌥' : 'Alt'
      }
      if (formatted === 'meta' || formatted === 'cmd') {
        return '⌘'
      }

      // 特殊键
      const specialKeys = {
        escape: 'Esc',
        esc: 'Esc',
        enter: '↵',
        return: '↵',
        space: 'Space',
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→',
        backspace: '⌫',
        delete: 'Del',
        tab: '⇥'
      }

      return specialKeys[formatted] || key.toUpperCase()
    })
    .join(isMac ? '' : '+')
}
