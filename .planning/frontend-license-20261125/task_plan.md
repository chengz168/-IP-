# 前端授权与首次向导实施计划

- 范围：App.vue、新增激活组件与首次向导、SettingsView.vue、必要前端辅助模块与样式、preload 白名单。
- 契约：state.license；licenseInfo；licenseActivate({code})；environmentStatus 返回六项 items 与 canCreate；usageLimits 默认 10 次与 200000 tokens。
- 约束：不修改后端、main.cjs、package.json、测试；不提交、推送、重启正式实例；保留已有改动。
- 验收：未授权仅激活页；六项三态来自真实检测；文案 ready 才开放创作；其他缺失可跳过且常驻提醒；额度可配置并持久化；编译与隔离 UI 验证。

## 阶段

- [x] 读取入口、设置、本地环境和 IPC 实现，确认后端契约
- [x] 激活组件、环境向导与前端辅助模块
- [x] App 入口分支与常驻提醒
- [x] 设置授权区块、额度配置与 preload 白名单
- [x] 编译、隔离验证和负责人回报

## 错误记录

- 首次 PowerShell here-string 写计划因引号缺失解析失败，未产生业务改动；改用 apply_patch。
