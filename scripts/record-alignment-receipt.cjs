const fs=require('node:fs');
// 当前批次放在文档开头，历史证据保留原有语境，不覆盖旧报告。
const summary='2026-11-14公共布局与自动/后台批：77/77测试通过（1617.1488ms，退出0）；最终build3213模块，主JS325.85kB/CSS129.01kB，3.47秒退出0；目录打包退出0，41个源码/构建文件与app.asar哈希一致，含cover-worker页面和preload。打包EXE首次启动仍未验收，未绕过历史自动审批拒绝。以下旧批次的“最新”只在当时成立。';
const layout='两尺寸1400×1000/1100×760、四档字号各49状态共392，列举几何问题0、pageErrors空；增加步骤行中心、状态间距、画布最小尺寸/比例和模板加载检查。首轮几何通过后人工仍发现84px高画布，已补600px编辑器最小高度和正文滚动；最终小窗大字号画布186.75×332px，图层属性可打开，生成/添加文字按钮滚动后真实命中。已实看15页对照及关键窄窗截图，不能称全状态或像素一致。';
const workflow='已实现真实串行队列、快照/输入锁/重复拒绝、停止/中断/远程未知、新旧共用启动和后台封面。已有视频跳过配音/复用视频→本地识别→FFmpeg剪辑→本地标题/抽帧/封面→发布信息实际完成，停awaiting_publish；H264/AAC 360×640/8秒，封面1080×1920，原有2条导出记录严格保留，新增发布记录0。两处抽帧确认新增字幕，但源片已烧录字幕、新字幕偏小，便签误识别为变迁，不认定内容质量通过。';
const remaining='整体goal维持active。字体/图标/标签/空态及部分面板位置仍有差异，全部教程连续音画和按钮、真实IP学习、素材语义索引、克隆/口型服务、平台发布及全部模板同源效果尚未完成。巡检改变独立验收草稿后，历史待发布标签与当前产物失效仍可能冲突，下一步先校正摘要，不改写历史。';
const restored='已关闭隔离PID29404，源码PID18552打开原pip-desktop-workspace；整个studio.json含updatedAt与本批基线严格一致，恢复截图已等待15模板实际加载。总收据：evidence/validation/alignment/delivery-report.json；视觉对照：alignment/comparisons。';
function prepend(file,text){let content=fs.readFileSync(file,'utf8');const titleEnd=content.indexOf('\n');fs.writeFileSync(file,content.slice(0,titleEnd+1)+'\n'+text+'\n\n'+content.slice(titleEnd+1).trimStart());}
prepend('docs/验证收据.md',[summary,layout,workflow,restored,remaining].join('\n\n'));
prepend('docs/逐页视觉验收.md',[summary,layout,'侧栏/步骤三列、改写标题与正文/控件字号、栅格留白、模式栏居中、状态条间距已校正。中文显式回退微软雅黑后更接近原图，但未确认原厂实际字体。对照中任务内容、滚动位置和执行状态不同，不能当作同状态逐像素验收。',remaining].join('\n\n'));
prepend('docs/功能差距矩阵.md',[summary,workflow,layout,remaining].join('\n\n'));
let matrix=fs.readFileSync('docs/功能差距矩阵.md','utf8');
matrix=matrix.split('\n').map(line=>line.startsWith('| 自动流程 |')?'| 自动流程 | 主进程串行队列、输入锁、新旧共用启动、停止/中断/未知；已有视频→识别→剪辑→标题/封面→发布信息真实实测，停待发布 | 克隆/口型及平台发布待接入；历史状态与产物失效的摘要需校正，未完整实测原厂自动链与恢复算法 |':line.startsWith('| 任务中心 |')?'| 任务中心 | 统计、六列任务表、分页/筛选/搜索、七阶段与嵌套详情、自动/后台执行记录已有真实桌面验收 | 历史待发布标签与当前失效产物可能冲突；第七阶段真实发布未接入；字体图标和全部状态仍有差距 |':line).join('\n');
matrix=matrix.replace('其中IP大脑、语义混剪、自动流程、模板效果与视觉细节等仍有本地开发和核对工作','其中IP大脑、语义混剪、自动流程的剩余摘要和质量工作、模板效果与视觉细节等仍有本地开发和核对工作');fs.writeFileSync('docs/功能差距矩阵.md',matrix);
prepend('docs/自动与后台流程实现验收.md',[workflow,remaining,'本批列举执行契约已实现，详细功能证据workflow-jobs/functional-report.json，总收据alignment/delivery-report.json。下面保留原设计与验收标准。'].join('\n\n'));
let auto=fs.readFileSync('docs/自动与后台流程实现验收.md','utf8');auto=auto.replace('状态：设计后开始实施','状态：列举契约已实现并有本地链路验收');fs.writeFileSync('docs/自动与后台流程实现验收.md',auto);
for(const file of ['task_plan.md','progress.md'])fs.appendFileSync(file,'\n\n## 2026-11-14公共布局与自动流程批收尾\n\n'+[summary,layout,workflow,restored,remaining,'文档整体补丁曾因标题/整行上下文不匹配被拒，未写入；现按真实标题和行前缀更新，失败不算成功。'].join('\n\n')+'\n');
console.log('六份进度及验收文档已更新，整体目标未完成。');
