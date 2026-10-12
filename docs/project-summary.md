# videoanalyze 项目总结

> 2026-10-12 整合说明：当前项目已统一到仓库根目录的 `main`。本文保留 2026-08-15 的历史架构梳理，功能状态、启动方式及已知问题以 [README](../README.md)、[运行说明](operations.md) 和 [整合记录](consolidation.md) 为准。后续已增加平台链接解析，摘要与 AI 笔记也已成为当前 Worker 的必需阶段。

> 更新日期：2026-08-15 · 分支：`codex/transient-retention-ai-notes`
> 本文是项目结构与技术链的完整梳理，用于交接、复盘与后续开发索引。

---

## 1. 项目概述

**本地视频智能解析播放器**。用户上传本地视频，系统自动完成：

> 上传 → 音频提取 → 语音转写（ASR）→ 大模型智能摘要 → 生成可点击跳转的章节/转写/搜索

核心价值：把长视频变成**可检索、可跳转、可复盘**的结构化知识内容。点击摘要、章节或转写片段，视频自动跳到对应时间点。

- 形态：**Web 应用**（浏览器上传 + 服务器分析），非最初设计的 Electron 桌面端
- 分析流水线：**V0 转写 + V1 摘要**，V1 摘要为可选增强，失败不影响转写结果

---

## 2. 整体架构

### 2.1 分层映射

原设计文档的五层（UI / 本地任务 / 媒体处理 / AI 服务 / 数据存储）在 monorepo 中映射为：

| 设计层 | 实际模块 | 说明 |
|---|---|---|
| UI 层 | `apps/web` | React 单页应用，播放器 + 历史恢复 + 摘要/章节/转写/搜索/导出面板 |
| 服务编排层 | `apps/api` | Fastify HTTP 服务：认证、上传、额度、任务入队、SSE、搜索、管理 |
| 任务/媒体处理层 | `apps/worker` | BullMQ 消费端：ffmpeg 抽音频、切片、Groq 转写、LLM 摘要 |
| AI 服务层 | `apps/worker/src/providers` | Groq ASR / DeepSeek（Anthropic 兼容）摘要，抽象为 `AsrProvider` / `SummaryProvider` |
| 数据存储层 | `infra` + `apps/api/src/db` | PostgreSQL / Redis / MinIO / Caddy，SQL 迁移 + 仓储模式 |
| 契约层 | `packages/domain` | 三端共享的 zod schema、类型、错误码、provider 契约 |

### 2.2 依赖关系

```
packages/domain ──► apps/api   （schema / DomainError / 契约）
      ▲          ──► apps/worker（schema / provider 接口 / 重试策略）
      │          ──► apps/web   （仅部分类型）
      └─ 纯函数，零运行时依赖（仅 zod）
```

### 2.3 Docker Compose 拓扑（项目名 `videoan`）

```
浏览器 ──HTTPS──► Caddy(proxy :80/443) ──► web(nginx, 静态) / api(:3000)
                                              │           │
                                          PostgreSQL(5433) Redis(6379)
                                              │           │
                                          MinIO(9000/9001) Mailpit(8025)
                                              │           │
                                          worker ◄──BullMQ 队列（Redis）── api
                                          (ffmpeg + Groq + DeepSeek)
                                              │
                                      retention sweep（临时媒体/隐私结果）
```

- 一次性服务：`migrate`（按编号顺序执行 SQL 迁移）、`minio-init`（建桶）
- 命名卷：`postgres-data / redis-data / minio-data / caddy-data / caddy-config`（`down -v` 会清库）
- 反向代理：本地用 Caddyfile（内部 CA，`https://localhost` / `https://storage.localhost`）；生产用 Caddyfile.production（Let's Encrypt 自动证书）

---

## 3. 项目结构

```
videoanlast/
├── apps/
│   ├── api/                     # @videoanalyze/api — HTTP 后端
│   │   └── src/
│   │       ├── server.ts        # 组合根：建 Pool/S3/队列/服务，buildApp()
│   │       ├── app.ts           # Fastify 工厂（DI 可测），路由注册 + 安全头 + 错误处理
│   │       ├── routes/          # auth / uploads / analysis / search / media / credits / admin / health
│   │       ├── auth/            # auth-service / authorization / passwords(bcrypt) / tokens
│   │       ├── storage/         # s3-client(双 client) / s3-storage / upload-service / object-keys
│   │       ├── analysis/        # analysis-service（入队、额度预留）/ credit-cost
│   │       ├── events/          # progress-hub（进程内 SSE 广播）
│   │       ├── search/          # search-service（pg_trgm GIN / ILIKE）
│   │       ├── results/         # 结果历史、详情、删除与生命周期门禁
│   │       ├── retention/       # 临时对象容量统计与并发容量闸门
│   │       ├── db/
│   │       │   ├── migrations/  # 0001~0004 SQL（只增不改）
│   │       │   ├── repositories/# 纯 SQL 仓储（users/videos/credits/admin/auth/analysis-runs/search）
│   │       │   ├── schema.ts    # drizzle 表定义（仅类型）
│   │       │   └── test-database.ts  # pg-mem 并行 schema
│   │       ├── config/env.ts    # 全部环境变量 + 默认值
│   │       └── cli/admin-create.ts
│   ├── worker/                  # @videoanalyze/worker — 分析流水线
│   │   └── src/
│   │       ├── worker-main.ts   # BullMQ Worker + 每 job 编排 v0→v1→completed
│   │       ├── queue/           # analysis-consumer / queues("video-analysis")
│   │       ├── analysis/        # v0-runner / transcript-merge / settlement / chunk-manifest
│   │       ├── summary/         # v1-runner / token-budget / windowing / alignment
│   │       ├── media/           # ffmpeg(参数构建) / ffprobe / process-runner / playback-compatibility
│   │       ├── providers/       # groq-asr(+curl 传输) / anthropic-summary / groq-summary / http-client / summary-prompt
│   │       └── retention/       # 终态清理、定时 sweep、陈旧任务与隐私结果清理
│   └── web/                     # @videoanalyze/web — 前端
│       └── src/
│           ├── app.tsx          # 无路由库，路径条件渲染 + 会话门控
│           ├── api/client.ts    # fetch 封装 / ApiError / SSE / XHR PUT 上传
│           ├── player/          # VideoPlayer.tsx（原生 <video> + PlayerController ref）
│           ├── auth/            # Login / Register(验证码) / VerifyEmail / ResetPassword
│           ├── library/         # 上传保留模式 + AnalysisHistory 历史列表
│           ├── viewing/         # 历史工作区、本地挂载、导出与永久删除
│           ├── analysis/        # AnalysisProgress.tsx（SSE + 1s 轮询兜底）
│           ├── summary/ chapters/ search/ transcript/ credits/ admin/
│           └── styles.css       # 单文件全局样式（无 CSS 框架）
├── packages/
│   └── domain/                  # @videoanalyze/domain — 共享契约（zod + 类型 + 错误码 + provider 接口）
├── infra/
│   ├── docker-compose.yml
│   └── reverse-proxy/           # Caddyfile / Caddyfile.production
├── scripts/                     # setup-local-https.sh / verify-local-upload-analysis.mjs
├── tests/acceptance/            # deployment-config / setup-local-https / v0-v1 / verify-local-upload-analysis
└── 2026-08-02-local-video-ai-player-design.md  # 需求与架构基线
```

---

## 4. 核心代码技术链

### 4.1 `packages/domain` — 契约层

- 技术：TypeScript + **zod**（唯一运行时依赖），`tsc -p` 构建，vitest 测试
- 职责：三端（api/web/worker）共享的 schema、类型、错误契约、provider 抽象
- 模块：
  - `auth.ts` — `emailSchema`（trim/小写/邮箱/max320）、`publicUserSchema`
  - `analysis.ts` — `analysisStageSchema`（queued/probing/extracting_audio/chunking/transcribing/merging_transcript/summarizing/indexing/completed）、`analysisStatusSchema`（queued/running/cancelling/cancelled/completed/failed）、`transcriptSegmentSchema`（refine `end > start`）
  - `summary.ts` — `summaryResultSchema`：`oneLineSummary` + `overallSummary` + `chapters`（≤15，含 `sourceSegmentIds` + `bullets`）
  - `media.ts` / `quota.ts` — 媒体信息、额度预留结果枚举
  - `provider.ts` — **provider 契约**：`AsrProvider` / `SummaryProvider` 接口、`ProviderError`、`classifyProviderFailure`、`getRetryDecision`（指数退避 ≤3 次，429 触发降并发）
  - `errors.ts` — `DomainError` + 约 23 个错误码（UNAUTHORIZED / CREDITS_EXHAUSTED / NO_AUDIO_TRACK / UPLOAD_TOO_LARGE / ANALYSIS_CONFLICT…）

### 4.2 `apps/api` — 后端服务

- 技术栈：**Fastify 5** + `@fastify/cookie`、**pg**（仓储层全用原生 SQL）、**drizzle-orm**（仅表定义类型）、**bullmq**（Redis 队列）、**@aws-sdk/client-s3 + s3-request-presigner**（MinIO）、**bcryptjs**（12 轮）
- 关键设计：
  - **双 S3 client**：内部 client 走 `S3_ENDPOINT=http://minio:9000`；浏览器预签名 client 走 `S3_PUBLIC_ENDPOINT`（本地 `https://storage.localhost`）。浏览器绝不收到 Docker 内部主机名
  - **分析入队**：`POST /api/videos/:videoId/analysis-runs` → 校验额度（`credit-cost.ts`：1 信用点 / 10MB）→ 事务预留（`SELECT ... FOR UPDATE`）→ 建 run → `bullmq queue.add("analysis", {userId, videoId, runId})`，失败则释放预留
  - **SSE 进度**：`GET /api/analysis-runs/:runId/events` 走进程内 `progress-hub` 广播；前端另有 1s 轮询兜底（SSE 在 API 重启后不可靠）
  - **搜索**：`GET /api/analysis-runs/:runId/search`，自动在 `pg_trgm` GIN 与 `ILIKE` 间选择（适配中文短查询）
  - **安全头**：`nosniff` / `X-Frame-Options` / CSP `default-src 'none'`；会话 cookie HttpOnly
- 路由全表：

| 路由组 | 方法 | 说明 |
|---|---|---|
| `/api/auth/*` | POST | 注册验证码(60s 限频)/注册/登录/登出/改密/重置 |
| `/api/videos/upload-session` | POST | 建视频行 + 预签名 PUT URL（900s） |
| `/api/videos/:id/analysis-runs` | POST | 额度预留 + 建 run + 入队 |
| `/api/analysis-runs` | GET | 当前用户结果历史（含可用/到期/已删除状态） |
| `/api/analysis-runs/:id` | GET / POST cancel / GET events | 查询持久结果 / 取消 / SSE；到期或删除返回 410 |
| `/api/analysis-runs/:id/results` | DELETE | 永久删除正文与检索内容，保留最小审计和计费快照 |
| `/api/analysis-runs/:id/search` | GET | 全转录 + 章节全文检索 |
| `/api/videos/:id/playback-url` | GET | 预签名下载 URL（900s） |
| `/api/videos/:id` | DELETE | 删除对象 + 标记 deleted |
| `/api/credits*` / `/api/credit-requests*` | GET/POST | 余额/台账/充值申请 |
| `/api/admin/*` | GET/PATCH/POST | 用户/角色/封禁/授信/充值审批/审计（requireAdmin） |
| `/healthz` `/readyz` | GET | 存活 / 就绪（db+redis+storage） |

- 认证与信用体系：注册发放 6 位邮箱验证码（哈希存储，5 次错失效）→ 直接已验证 + **12 欢迎额度**（幂等 `welcome:<userId>`）；登录签发会话 token（32 字节，SHA-256 后入库）；余额 = 台账总和 − 冻结预留

### 4.3 `apps/worker` — 分析流水线

- 技术栈：**bullmq Worker**（并发 `GLOBAL_WORKER_CONCURRENCY` 默认 2）+ **ioredis** + **pg** + **@aws-sdk/client-s3**；ffmpeg/ffprobe 用系统二进制（Docker apt 安装，无 npm 包）
- 每 job 编排（worker-main）：`v0 转写 → v1 摘要（可选）→ completed → 结算信用点 → 清理原片/音频/切片`；异常终态同样先持久化和结算，再清理临时媒体
- **V0 转写**（`analysis/v0-runner.ts`）：`probing(0.02) → extracting_audio(0.1) → transcribing(0.2) → merging_transcript(0.95)`
  1. `ffmpeg` 抽音频：`-ar 16000 -ac 1 -map 0:a:0 -c:a flac`（**单声道 16kHz FLAC**）
  2. 切片（`chunk-manifest.ts`）：600s/块、8s 重叠、`maxBytes 20MB`；超限递归二分——保证单请求低于 **Groq 25MiB 上限**
  3. **Groq ASR**（`providers/groq-asr.ts` + `groq-asr-curl.ts`）：`POST /openai/v1/audio/transcriptions`，`verbose_json` 拿时间片段，模型 `whisper-large-v3-turbo`。**默认走 curl 而非 fetch**：key 写 0600 临时文件 `--header @file` 传递，避免进程 argv 泄露；响应头落盘解析最终状态码 + Retry-After
  4. 合并转录（`transcript-merge.ts`）：按起点排序、去重叠重复
- **V1 摘要**（`summary/v1-runner.ts`）：`summarizing(0.1) → indexing(0.95)`
  - **token 预算**（`token-budget.ts`）：估算 `Σ ceil((len+24)/4)`，>60% contextWindow 走 **map-reduce** 否则单次
  - **map-reduce**：窗口切分（45s 重叠）→ 并行逐窗摘要 → 每窗章节转成合成片段（`map-i-j`）→ 最终 reduce 汇总 → 展开 `sourceSegmentIds`
  - **章节对齐**（`alignment.ts`）：由 `sourceSegmentIds` 求 `min(start)/max(end)` 钳位；零匹配则 `{0, duration, alignmentWarning:true}`
  - **紧凑 id 往返**：喂给 LLM 前把 `<runId>_seg_N` 压成 `seg_N`（模型会自动截断长 id 导致对齐失败），返回后映射回真实 id 再持久化
- **DeepSeek 摘要**（`providers/anthropic-summary.ts`）：Anthropic 兼容端点 `{base}/v1/messages`，`x-api-key` 认证（非 Bearer）；**必须 `thinking:{type:"disabled"}`**（否则 thinking 吃光 max_tokens 返回空 text），解析首个 `type:"text"` 块；`summarySystemPrompt` 显式写明 JSON schema
- 状态写入：`setStage` 单条 SQL 同时更新 stage/progress/status/heartbeat；`chunking` 阶段枚举存在但 worker 不单独发（隐式在 getChunks）

### 4.4 `apps/web` — 前端

- 技术栈：**React 19 + Vite 7**（无路由库、无视频播放器库——原生 `<video>` 包成 `VideoPlayer`，暴露 `PlayerController` ref：`seek`/`getCurrentTime`）；单文件 `styles.css`（BEM 风格 + `:root` token）
- API 客户端（`src/api/client.ts`）：
  - `request<T>`：fetch 封装，`credentials:"include"`（cookie 会话），非 2xx 抛 `ApiError(status, code)`
  - `putUpload`：**XHR PUT** 直传预签名 URL（带上传进度），不走 fetch
  - `subscribeToAnalysis`：`EventSource` SSE `/events`，监听 `progress` 事件
- 上传流程：选择标准/隐私结果模式 → 额度前端预估 → `createUploadSession` 拿预签名 URL → XHR 直传 `storage.localhost` → 播放本地 blob URL → `startAnalysis`
- 历史恢复：新客户端按 run ID 读取持久文字结果；原片已清理时可重新选择本地文件，仅创建 blob URL，不上传也不计费；时长误差超过 2 秒需确认
- 进度展示：**SSE 为主 + 1s 轮询兜底**，阶段中文映射（`transcribing→转写中` 等），断线 1.5s 重连
- 交互闭环：`playerRef.current?.seek(seconds)` 由 ChapterList / TranscriptPanel / SearchPanel 的 `onSeek` 回调触发；转录超 500 段自动虚拟滚动

### 4.5 基础设施与部署

- 迁移链（`apps/api/src/db/migrations/`，只增不改，事务内执行，记录于 `schema_migrations`）：
  - `0001_initial`：`pg_trgm` + 核心表（users/sessions/videos/analysis_runs/jobs/chunks/transcript_segments/chapters/usage_ledger）
  - `0002_credit_billing_admin`：角色/状态字段 + 信用台账/预留/充值申请/审计/重置 token
  - `0003_registration_verifications`：注册邮箱验证码
  - `0004_summary_results`：`analysis_runs.summary_json` + `chapters.alignment_warning`（V1 摘要）
  - `0005~0007`：临时对象/结果生命周期、隐私 `ephemeral_*` 表、清理租约与稳定失败分类
- 三个部署阶段：本地（internal CA）→ 服务器 IP 临时验证 → 域名 HTTPS（Caddy 自动证书）
- 保留策略：孤立上传最多 24 小时；任务终态后原片、音频和 chunk 立即清理并可重试；标准文字结果保留，隐私文字结果完成后 24 小时到期；用户可提前永久删除正文
- 容量保护：临时媒体预计占用超过配置容量的 80% 时拒绝新上传，但历史读取保持可用
- 备份：`pg_dump` 流式进入 age 加密，再上传到独立 S3；不产生明文 dump，且排除所有 `ephemeral_*` 表数据

---

## 5. 端到端数据流

```
浏览器
  │ 1. 注册(邮箱验证码) → 登录(cookie) ──► api
  │ 2. POST /upload-session ──► 预签名 PUT URL（storage.localhost）
  │ 3. XHR PUT 直传 MinIO ──► videos.original
  │ 4. POST /analysis-runs ──► api：额度预留 + 建 run + BullMQ 入队(redis)
  ▼
worker
  │ 5. 下载视频 → ffprobe 探测 → ffmpeg 抽 mono 16kHz FLAC
  │ 6. 切片(600s/8s/20MB) → Groq ASR(curl, whisper-large-v3-turbo) 逐块转写
  │ 7. 合并转录 → 写 transcript_segments（<runId>_seg_N）
  │ 8. v1：compact id → DeepSeek(/v1/messages, thinking disabled) 摘要
  │    → 章节对齐(sourceSegmentIds→时间) → 写 summary_json + chapters
  │ 9. 结算：consume credit reservation
  ▼
浏览器
  │ 10. SSE + 轮询 拉到 completed → 展示 摘要/章节/转录/搜索
  └──► 点击章节/片段 → playerRef.seek(seconds)
```

---

## 6. 关键设计决策与踩坑记录

这些决策是后续维护必须知道的“为什么”：

1. **Provider adapter + 运行时能力探测**——第三方 API 限制不写死进架构（设计文档基线）。`AsrProvider`/`SummaryProvider` 接口 + `capabilities()`（contextWindow、structuredOutput），worker 按预算决定单次或 map-reduce。
2. **浏览器预签名与内部 client 分离**——浏览器只能用 `storage.localhost`/公共域名，绝不能用 `minio`；`S3_PUBLIC_ENDPOINT` 必须为裸 origin。
3. **`requestChecksumCalculation: "WHEN_REQUIRED"`**——避免 AWS SDK 自动附加 `x-amz-checksum-crc32=AAAAAA==` 占位，导致浏览器直传 MinIO 失败。
4. **Groq ASR 走 curl**——规避 fetch 的 multipart/体积限制，API key 用 0600 临时文件 + `--header @file`，不进 argv；响应头落盘解析规避代理/100-continue 干扰。
5. **DeepSeek 必须禁用 thinking**——Anthropic 兼容端点默认 thinking，会吃光 `max_tokens` 返回空 text（间歇性 `did not match schema` 的根因）；解析首个 text block 兜底。
6. **LLM 输入用紧凑 segment id**——模型会把 `<runId>_seg_N` 截断成 `seg_N`，导致 `alignChapter` 零匹配、章节时间退化为整段；输入压缩、返回后映射回真实 id。
7. **chapters.id 主键加 runId 前缀**——模型返回 `ch1/ch2` 非全局唯一，多 run 插入撞主键。
8. **切片必须重编码（非 `-c copy`）**——stream-copy 的 FLAC 切片保留源 STREAMINFO 总时长，尾块声明时长超过实际采样，ASR 返回 502。
9. **SSE + 轮询双轨**——SSE 只存在于 API 进程内，API 重启即断；前端 1s 轮询兜底，避免“卡在排队中”。
10. **V1 摘要失败不致死 run**——摘要属 P1 增强，失败仅记日志，转写结果保留。
11. **E2E 需清代理环境**——宿主机 Clash + `NODE_USE_ENV_PROXY=1` 会让 Node 24 的 `node:https` 也走代理（读小写 `https_proxy`）；见 `docs/commands.md`。

---

## 7. 测试与验证策略

- **单元测试**：Vitest，160 个用例全绿。DB 测试用 **pg-mem** + `test-database.ts` 并行 schema；服务/路由测试用 DI 注入 fake；`media.integration.test.ts` 跑真实 ffmpeg（lavfi 1s fixture）
- **验收测试**（`tests/acceptance/`）：除部署、HTTPS 和 V0/V1 外，覆盖断线后恢复、终态原片删除、隐私 24 小时到期、永久删除保留账本、80% 容量闸门、重复清理隔离与零上传本地挂载
- **真实 E2E**：`corepack pnpm verify:local-upload-analysis`（需 Groq key）；成功输出只含 run ID、终态、原片删除/结果可用状态与聚合数量
- **质量门槛**：`typecheck` / `lint` / `build` / `test` / `test:acceptance` / `docker compose config --quiet`

发布前以当前分支的全量命令结果为准；真实验证的安全输出格式与代理清理方式见 `docs/commands.md`。

---

## 8. 现状与后续方向

已完成（V0 + V1）：
- ✅ 注册/登录（邮箱验证码、会话、12 欢迎额度）
- ✅ 预签名直传 + 分析入队 + BullMQ 流水线
- ✅ V0：ffmpeg 抽音频 + 切片 + Groq 转写 + 合并转录
- ✅ V1：DeepSeek 摘要（单次/map-reduce）+ 章节对齐 + 前端展示与点击跳转
- ✅ 信用点记账/预留/结算、管理员后台、充值审批、搜索（pg_trgm）
- ✅ 本地 HTTPS、Caddy 反代、迁移链、部署文档
- ✅ 临时媒体容量闸门、终态清理/重试、陈旧任务回收与计费对账
- ✅ 标准/隐私结果隔离、历史恢复、24 小时隐私到期、永久删除与 Markdown 导出
- ✅ 排除隐私正文的 age 加密异地数据库备份和维护模式恢复

待办/后续（下一阶段设计）：
- `duration-tiered-v2` 阶梯积分、服务端真实时长计费与不可变计费快照
- 单视频上限 4 小时、长视频队列/FFmpeg/ETA 保护
- 默认详细 AI 笔记、map-reduce、独立笔记页/目录/时间戳跳转和 Markdown/纯文本下载
- 当前播放片段高亮、多音轨选择、SRT / JSON 导出
- MKV remux → MP4 验证（playback-compatibility 已就绪未接线）
- 离线 faster-whisper、说话人识别、翻译

---

## 9. 参考文档

- 需求与架构基线：`2026-08-02-local-video-ai-player-design.md`
- 部署：`docs/operations.md` · 常用命令：`docs/commands.md`
- 交接记录：`docs/handoff/2026-08-08-final-handoff.md`
