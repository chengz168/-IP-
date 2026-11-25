# 前端发现

- 原工作区存在上一批分镜后端、测试与 fixture 改动，全部保留。
- 原 localEnvironment 只含本地服务和按需 worker；后端新增 environmentStatus 补足六项检查，前端不自行伪造就绪。
- 激活成功返回 license 对象，再刷新 state 获取授权后的业务状态。
- 全量 npm test 与 npm run build 由负责人集中执行，避免重复运行。
