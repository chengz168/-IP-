# 本地声音运行器

复用 Bandukids/indextts-local 的四个脚本，固定提交 `85655dc9719198d00370879620eb26949010ef57`，原始脚本不改。许可证见同目录 LICENSE，SHA 见 provenance.json。上游 IndexTTS 与模型自身许可单独保留，不能将此运行器的 MIT 许可解释为模型也是 MIT。

独立环境路径：`D:/AI-Runtimes/super-ip/indextts-2.5`。安装、模型下载、CUDA 检查和真实推理是四个不同状态。社区脚本的 stop 不能取消忙碌中的推理，正式工作流接入前需要补全取消和过期产物保护。

安装时使用 Python 3.11 与独立 uv 缓存，不修改 ComfyUI、系统 Python 或用户当前任务配置。默认不下载示例声音。生成测试必须记录参考音频来源和输出散列，不以原始参考声音代替新生成音频。
