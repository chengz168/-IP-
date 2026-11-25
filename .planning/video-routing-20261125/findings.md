# 发现

- `server/content-types.mjs`将故事、商品等题材归类，但目前其返回的`outputMode`未与`video.mode`绑定；题材不是制作模式。
- `VideoPanel.vue`当前只按用户手动选择`single/multi/story/product`渲染；普通单形象含剧情稿时仍可点击生成。
- `confirmCopy`只原子保存`finalText/confirmed`；第四步可独立导航；workflow和`avatarContext`按已存mode运行，需覆盖旁路。
- 当前已存草稿是1000字符扒炉工厂介绍，有镜头/实物展示提示，没有已证实人物对白或剧情冲突；模式现为用户选择的`multi`。因此应尊重当前multi。反馈截图asset的来源任务仍需核实。
- auto/手动选择应独立于`creativePreset`，后者仅为写作/生成提示词预设，不能视为视频模式手动覆盖。
