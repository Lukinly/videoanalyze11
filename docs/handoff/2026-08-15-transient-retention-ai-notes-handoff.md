# 临时媒体保留、积分升级与 AI 笔记交接文档

更新时间：2026-08-15  
原工作区：`/mnt/v/Vworkspace/videoanlast`  
隔离工作区：`/mnt/v/Vworkspace/videoanlast-worktrees/transient-retention-ai-notes`  
隔离分支：`codex/transient-retention-ai-notes`

## 0. 完成状态（2026-08-15 更新）

本交接文档中原列出的剩余任务现已全部完成。后续章节保留的是接手时的历史状态，不再代表当前待办。

- Task 5 的两个 fencing/积分释放问题已修复；Task 6–9 的结果生命周期、UI、备份和验收均已完成。
- 下一阶段功能已完成：`duration-tiered-v2` 真实时长计费与不可变快照、4 小时上限、详细 AI 笔记及隐私隔离、独立笔记页与导出、队列/FFmpeg/长视频并发保护。
- 实施计划：`docs/superpowers/plans/2026-08-15-ai-notes-long-video-tiered-billing-implementation.md`。
- 最终自动验证：87 个测试文件、316 项测试通过；typecheck、lint、生产 build 通过；7 个 acceptance 文件、52 项验收测试通过。
- 已在现有 PostgreSQL 数据卷上成功应用迁移 `0008`；18 条旧分析保持原计费状态，未被回填新快照。
- 真实本地上传验证通过：终态 completed、原片已删除、结果可用、281 个转录片段、5 个章节；验证器内部同时确认 AI 笔记存在、`duration-tiered-v2` 快照有效且仅有一笔金额匹配的分析扣费。
- 真实验证中发现并修复了模型时间戳格式漂移：只采用模型返回的真实 segment ID，时间戳始终由服务端转录片段解析；非法结构会重试一次，虚构引用仍会拒绝。

## 1. 用户要求与下次执行原则

后续会话继续完成临时媒体保留、结果生命周期、阶梯积分、4 小时视频和详细 AI 笔记。

用户明确要求节省时间与 token：

- 不要重新审查已经通过审查的 Task 1–4。
- 不要在每个小改动后重复运行全量测试或发起多轮泛化复核。
- 有关联的实现应放在同一个批次完成，并一次性运行关联测试。
- Task 5 只修复本文件记录的两个未解决问题；修复后进行一次定向复核。
- Task 6–8 可以分别做必要的测试先行，但在一个里程碑结束后统一做一次跨任务审查。
- Task 9 再统一运行全量 test、typecheck、lint、build、acceptance 和真实本地验证。
- 除非出现新的确定性失败，不要重复运行已经有新鲜通过证据的同一命令。
- 审查必须针对具体风险和变更范围，不做无边界代码库巡检。

建议测试节奏：

```text
修改一个行为 -> 运行能证明该行为的最小 RED/GREEN 测试
完成一个关联批次 -> 一次运行相关目录/包测试 + typecheck
完成 Task 5–8 -> 一次合并代码审查
完成 Task 9 -> 一次全量发布验证
```

## 2. 隔离与安全状态

原工作区包含大量未提交修改，未被清理、重置或覆盖。所有后续实现均在隔离分支完成。

隔离分支基线：

- `6c11c01 chore: snapshot existing unfinished implementation`
- 基线验证：60 个测试文件、171 项测试通过。

不要对原工作区或隔离工作区执行：

```bash
git reset --hard
git checkout -- .
git clean -fd
git add .
```

## 3. 已完成且无需重复复核的任务

### Task 1：保留策略契约与数据库状态

提交：`65b2231 feat: add transient retention schema`

- 新增 `standard | privacy` 保留模式及结果可用状态。
- 新增迁移 `0005_transient_retention.sql`。
- 新增临时对象和三类 `ephemeral_*` 隐私结果表。
- Drizzle 和 pg-mem 测试结构已同步。
- 已通过规格与质量审查。

### Task 2：上传跟踪与容量保护

提交：

- `43d2038 feat: track transient uploads and enforce capacity`
- `d07f948 fix: serialize transient capacity admission`

- 临时对象默认 24 小时兜底到期。
- 容量为 40,000,000,000 字节；70% 告警，超过 80% 拒绝。
- 并发上传采用数据库锁进行原子容量准入。
- 到期但尚未物理删除的对象继续计入容量。
- 已通过修复复审。

### Task 3：隐私结果隔离

提交：`ccaf320 feat: isolate privacy analysis results`

- 普通正文只进入普通表，隐私正文只进入 `ephemeral_*`。
- 隐私结果成功完成后精确设置完成时间加 24 小时。
- 分析接口支持保留模式并默认 `standard`。
- 保存任务级 `display_name`；持久结果提交后清除分片正文载荷。
- 已通过规格与质量审查。

### Task 4：所有终态后的媒体清理

提交：

- `15d84c4 feat: delete media after terminal analysis`
- `0174301 fix: make terminal media cleanup recoverable`

- 成功、失败和取消均在终态提交后清理原视频、音频和分片。
- 清理具备五分钟租约、过期认领、写入 fencing 和幂等重试。
- S3 对象不存在视为成功。
- 本地递归删除严格限制为 `/tmp/videoanalyze/<runId>`。
- 终态写入未确认时不会结算积分或删除媒体。
- 已通过修复复审。

## 4. Task 5 当前状态

已提交：

- `b5ef00b feat: schedule retention and privacy expiry`
- `026792e fix: fence retention cleanup and stale runs`

已实现：

- 启动时立即清扫，此后每 900 秒执行一次，进程内不重叠。
- shutdown 先关闭清扫调度，再关闭 BullMQ 和 PostgreSQL。
- 陈旧任务判定为创建超过 4 小时且心跳严格超过 15 分钟。
- 临时对象使用可恢复的五分钟 claim 租约和 token fencing。
- 隐私结果到期事务只删除三类 `ephemeral_*`、chunk 正文并写入删除标记。
- 到期后 ResultStore 会拒绝重新写入隐私正文。
- 清理错误会移除控制字符并截断到 500 字符。
- 最新聚焦验证：66/66 通过，typecheck 和改动文件 lint 通过。

### Task 5 仅剩两个问题

下次只修复这两个问题，不要重新审查已经解决的四项：

1. **陈旧 worker 没有立即停止后续工作。**
   `ResultStore.updateStage()` 已能返回 `false`，但 `worker-main.ts` 的普通 `setStage` 丢弃返回值。摘要 provider 和部分 chunk 创建仍可能在失去写入许可后继续。应让失败的 stage fencing 中止 runner，并在创建 chunk 元数据前执行同一许可检查。

2. **陈旧失败任务的积分释放仍依赖可变的 `analysis_runs.error`。**
   worker 的 merge warning 可能覆盖该字段，使后续 reconciliation 找不到仍为 `held` 的 reservation。应改为稳定、不可被普通错误覆盖的标记或直接依据“终态 failed + held reservation + 明确失败分类/时间”查询，不再依赖通用错误文本精确相等。

修复要求：

- 为上述两个行为各写一个失败测试并观察 RED。
- 完成后一次运行 retention/results/analysis/credits/queue/migration 关联测试和 typecheck。
- 只进行一次定向复核，复核范围仅限这两个问题和修复差异。
- 通过后在 SDD 台账中标记 Task 5 complete，不再发起第二次泛化审查。

## 5. 尚未实施

### 保留策略计划

- Task 6：结果历史、详情、搜索门禁、永久删除和 HTTP 410 API。
- Task 7：历史列表、Markdown 导出、本地原视频重新挂载、隐私到期 UI。
- Task 8：排除 `ephemeral_*` 的 age 加密异地数据库备份与恢复流程。
- Task 9：完整生命周期验收与真实本地上传验证。

计划文件：`docs/superpowers/plans/2026-08-12-transient-video-result-retention-implementation.md`

### 下一阶段功能

仍未编写实施计划和代码：

- `duration-tiered-v2` 阶梯积分：60/90/120/180/240 分钟分别为 60/95/130/220/310 积分。
- 服务器真实时长计费和不可变计费快照。
- 单视频上限提升到 4 小时。
- 默认生成详细 AI 笔记，长视频采用 map-reduce。
- 独立 AI 笔记页面、目录、时间戳跳转、Markdown/纯文本下载。
- 队列、FFmpeg、长视频和预计等待时间保护。

设计文件：`docs/superpowers/specs/2026-08-12-next-phase-ai-notes-long-video-pricing-design.md`

## 6. 推荐的下一会话顺序

1. 阅读本交接文档，不重新扫描或复核 Task 1–4。
2. 阅读 Task 5 报告和最新修复差异，只修复两个未解决问题。
3. 一次性运行 Task 5 关联测试并做一次定向复核。
4. 连续实施 Task 6–8；每项只运行最小行为测试，里程碑末统一跑相关包测试。
5. 对 Task 5–8 做一次合并审查。
6. 实施 Task 9，并只在此时运行全量发布验证。
7. 保留策略完成后，根据下一阶段设计写一份精简实施计划，将计费、长视频后端、AI 笔记持久化和笔记 UI 按关联模块分批实现。

## 7. 相关记录

- SDD 台账：`.superpowers/sdd/2026-08-12-transient-video-result-retention-implementation/progress.md`
- Task 1–5 brief、report 和 review package 均位于同一个 SDD 工作区。
- Task 5 最新修复报告：`.superpowers/sdd/2026-08-12-transient-video-result-retention-implementation/task-5-report.md`

下次应以 Git 提交、SDD 台账和本文件为事实来源，不要因上下文缺失而重新执行已完成任务。
