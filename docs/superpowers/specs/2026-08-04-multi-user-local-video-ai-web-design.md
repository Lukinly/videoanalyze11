# 多用户本地视频 AI Web 服务设计

## 1. 背景与目标

本项目基于 `2026-08-02-local-video-ai-player-design.md`，将原先面向单机 Electron 的本地视频 AI 播放器调整为面向多用户公网部署的 Web 服务。

核心价值仍然是：用户上传一个可播放的视频，服务端完成音频转写和内容结构化，用户可以从摘要、章节、搜索结果或转写片段跳回视频对应时间。

本次实现按 V0 → V1 顺序推进：

- V0 验证“上传视频 → 转写 → 时间戳跳转”的核心闭环。
- V1 补齐摘要、章节、搜索、格式兼容和缓存清理，形成可交付 MVP。

服务端优先运行在 Linux；客户端不绑定操作系统，Windows、macOS 和 Linux 用户通过现代浏览器访问。

## 2. 产品边界

### 2.1 目标能力

- 用户注册、邮箱验证、登录和退出。
- 新用户完成邮箱验证后获得两次完整视频分析试用额度。
- 用户上传视频并查看上传、处理和分析进度。
- 服务端使用平台统一的 Groq API key 完成 ASR 和摘要。
- 每个用户只能访问自己的视频、任务和分析结果。
- V0 提供带时间戳的 transcript 和点击跳转。
- V1 提供摘要、章节、关键要点、搜索和 MKV remux。
- 任务可恢复，已经完成的音频分片不重复请求 ASR。
- 原视频和分析结果按保留策略自动清理。

### 2.2 非目标

- 不实现用户自带 Groq API key。
- 不实现在线视频网站下载。
- 不实现多人协作和共享视频。
- 不实现离线本地模型、说话人识别、逐字字幕编辑和复杂剪辑。
- 不保证所有视频编码均可直接在浏览器中播放。

## 3. 已确认的产品决策

| 决策项 | 结论 |
| --- | --- |
| 部署形态 | Linux 服务端的公网 Web 服务 |
| 客户端 | Windows、macOS、Linux 浏览器 |
| 平台 API key | 由服务端统一配置和使用 |
| key 配置 | 服务端从环境变量 `GROQ_API_KEY` 读取；不读取或输出现有 `.env` 内容 |
| 登录方式 | 邮箱 + 密码 |
| 试用资格 | 注册后必须完成邮箱验证 |
| 试用额度 | 每个新用户两次完整视频分析 |
| 额度计数 | 一个视频的完整转写和摘要任务计一次；同一任务的重试不重复扣除 |
| 原视频保留 | 默认 7 天 |
| 音频和切片 | 任务完成或取消后清理 |
| transcript/摘要 | 默认保留 30 天 |
| 用户删除 | 用户可以主动删除视频及其分析结果 |
| 基础存储 | PostgreSQL + S3 兼容对象存储 |
| 任务系统 | Redis + BullMQ + 独立 Worker |
| 实时进度 | Server-Sent Events（SSE） |

## 4. 系统架构

```text
Browser
  │ HTTPS
  ▼
React Web App
  │ REST API / SSE
  ▼
Node.js API ───────── PostgreSQL
  │                         ├─ users / sessions
  │                         ├─ videos / analysis_runs
  │                         ├─ chunks / transcript_segments
  │                         ├─ chapters / usage_ledger
  │                         └─ retention metadata
  │
  ├──────── Redis + BullMQ
  │               │
  │               ▼
  │          Analysis Worker
  │          ├─ FFprobe / FFmpeg
  │          ├─ Groq ASR
  │          └─ Groq LLM
  │
  └──────── S3 / MinIO Object Storage
              ├─ original videos
              ├─ playback candidates
              ├─ audio chunks
              └─ raw provider responses
```

### 4.1 组件职责

#### Web 前端

负责登录、邮箱验证页面、视频上传、播放器、任务状态、摘要、章节、transcript 和搜索。前端不访问数据库、FFmpeg、服务器文件路径或 Groq API key。

#### API 服务

负责认证、权限校验、上传会话、分析任务创建、额度事务、结果查询、SSE 进度和用户删除操作。API 服务不在请求线程中执行长时间 FFmpeg 或 AI 请求。

#### Analysis Worker

从队列取出带 `userId`、`videoId` 和 `runId` 的任务，执行媒体处理和 AI 流程。每个阶段都写入数据库心跳和状态，完成的 chunk 立即持久化。

#### PostgreSQL

保存租户隔离所需的业务数据、任务状态、分片状态、transcript、章节和额度账本。所有查询必须包含当前用户权限条件或通过服务层统一封装。

#### 对象存储

保存大文件和中间文件。对象 key 使用服务端生成的随机 ID，不直接使用用户提供的文件名或路径。下载通过短时效 signed URL 或授权媒体接口完成。

## 5. 核心数据流

### 5.1 注册与试用

1. 用户提交邮箱和密码。
2. API 规范化邮箱，使用 Argon2id 哈希密码。
3. 创建未验证用户和一次性邮箱验证 token 的哈希。
4. 通过通用 SMTP 配置发送验证链接。
5. 用户点击验证链接后，事务性地标记邮箱已验证并创建两次额度账本记录。
6. 未验证用户不能创建分析任务。

验证 token 只保存哈希值，默认 24 小时过期且只能使用一次。

### 5.2 上传与分析

1. 用户请求创建上传会话。
2. API 校验登录状态、用户配额、当前任务数和文件大小上限。
3. API 创建 `video` 记录和 multipart/presigned upload 信息。
4. 浏览器直接上传到对象存储，避免 API 进程缓存大文件。
5. 上传完成后，API 校验对象存在、大小和基础 MIME 信息。
6. API 创建 `analysis_run`，通过数据库事务预留一次额度，并向 BullMQ 投递任务。
7. Worker 使用对象存储中的对象执行 FFprobe、播放候选验证、音频抽取和切片。
8. 每个 chunk 独立处理并写入数据库；已完成 chunk 通过 `(runId, chunkIndex)` 幂等跳过。
9. 所有 chunk 完成后合并 transcript，V0 标记转写完成。
10. V1 继续调用摘要 provider，校验引用并生成章节搜索索引。
11. 成功后确认额度消耗；服务端失败、未开始 AI 请求的取消和系统级失败释放预留额度。

### 5.3 播放与跳转

V0 以浏览器可以直接播放的 H.264/AAC MP4 为基线。播放器通过授权 URL 加载视频，点击 transcript 时设置 `currentTime` 为 segment 的 `start`，默认保持点击前的播放/暂停状态；是否自动播放由用户设置控制。

V1 对 MKV 等不稳定容器先执行显式排除字幕和数据流的无损 remux，再通过媒体加载事件验证。remux 后仍无法播放时，返回编码不兼容提示，并保留后续 H.264/AAC 重编码入口。

## 6. 认证、授权与安全

### 6.1 会话

- Session token 使用高熵随机值生成。
- 数据库只保存 token 哈希、用户 ID、过期时间、创建时间和撤销时间。
- 浏览器使用 `HttpOnly`、`Secure`、合适 `SameSite` 属性的 Cookie。
- 登录、注册、验证和密码错误接口限流。
- 所有视频、任务和结果读取都校验资源所属 `userId`。

### 6.2 API key

服务端通过 dotenv 或部署环境加载 `GROQ_API_KEY`。实现只检查变量是否存在，不读取、打印、回传或提交现有 `.env` 的具体内容。生产环境推荐使用容器 Secret 或云平台 Secret Manager；`.env` 必须加入 `.gitignore`。

### 6.3 上传安全

- 限制扩展名、声明 MIME、文件大小和视频时长。
- 以 FFprobe 结果作为媒体格式判断依据，不信任浏览器 MIME。
- FFmpeg 进程只访问授权的临时目录和对象存储下载文件。
- 媒体对象与用户对象按前缀隔离。
- 下载链接短时效，删除后立即失效。
- Web 应用启用严格 CSP，禁止任意远程脚本和任意导航。
- 错误日志不得包含 API key、Cookie、授权 URL 或用户敏感文本。

## 7. 数据模型

最小表集合如下：

- `users`: 邮箱、密码哈希、验证状态、状态和时间字段。
- `sessions`: session token 哈希、用户、过期和撤销状态。
- `email_verifications`: 用户、token 哈希、过期和使用状态。
- `videos`: 用户、对象 key、文件指纹、文件大小、时长、播放对象和保留时间。
- `analysis_runs`: 用户、视频、配置哈希、provider/model、阶段、状态、心跳、错误和时间字段。
- `jobs`: 运行任务的队列状态、重试次数和错误。
- `chunks`: 分片范围、对象 key、状态、转写对象、重试次数和错误。
- `transcript_segments`: 运行 ID、起止时间和文本。
- `chapters`: 运行 ID、标题、摘要、来源片段 ID 和派生时间范围。
- `usage_ledger`: 用户、分析运行、额度变更、预留/确认/释放状态和幂等键。

所有用户相关表包含 `user_id` 或可通过外键追溯到用户。`usage_ledger` 使用唯一幂等键防止并发请求重复扣除额度。

## 8. V0 实现边界

V0 必须完成：

- React Web 页面和 API 服务启动。
- 邮箱密码注册、SMTP 验证、登录和退出。
- 用户两次试用额度和原子扣除/释放。
- 大文件对象存储上传。
- H.264/AAC MP4 基线播放。
- FFprobe 元数据读取和第一条音轨选择。
- FFmpeg 音频抽取和按大小约束切片。
- Groq ASR adapter、重试、429 降并发和 chunk prompt。
- transcript 分片落盘、合并和重叠区保守去重。
- SSE 进度、取消、失败提示和重启恢复。
- transcript 时间戳跳转。
- 用户资源隔离和原视频 7 天清理任务。

V0 不包含摘要、章节、FTS 搜索、复杂格式转码和多音轨选择。

## 9. V1 实现边界

V1 在 V0 基础上增加：

- 结构化摘要 provider adapter。
- token 预算判断和超长 transcript 的 map-reduce。
- `sourceSegmentIds` 引用校验和章节时间派生。
- 摘要、章节和关键要点跳转。
- PostgreSQL `pg_trgm` 搜索，短查询使用 `ILIKE` 降级。
- MKV 等容器 remux、播放闭环验证和不兼容提示。
- 原始 provider 响应和中间对象清理。
- transcript/摘要 30 天保留和用户主动删除。
- Docker Compose 部署、健康检查、迁移和基础打包/启动验证。

## 10. Provider 与任务接口

任务层只依赖领域接口，不依赖 Groq 字段名或 HTTP 错误码：

```ts
interface AsrProvider {
  capabilities(): Promise<AsrCapabilities>;
  transcribeChunk(input: TranscribeChunkInput): Promise<TranscribeChunkResult>;
}

interface SummaryProvider {
  capabilities(): Promise<SummaryCapabilities>;
  summarize(input: SummaryInput): Promise<SummaryResult>;
}
```

Groq adapter 负责把领域参数映射成 `response_format`、`timestamp_granularities[]` 等 provider 参数，并将 401、403、429、5xx、超时和参数错误归一化为领域错误。

## 11. 错误与恢复

- 无音轨：任务失败并提示仅支持播放，不支持转写。
- FFmpeg/FFprobe 不可用：健康检查失败并提示服务端安装问题。
- 401/403 或 API key 缺失：立即失败，不重试。
- 429、5xx、网络超时：按 provider 能力退避重试；连续 429 降低 worker 并发。
- 损坏或不支持的视频：保留原文件状态，返回可操作错误。
- Worker 心跳超时：启动恢复扫描将运行任务重新入队；已完成 chunk 不重复提交。
- 摘要 JSON、引用或章节对齐失败：自动修正并重试一次；最终失败时保留可用 transcript。
- 用户取消：停止子进程、清理临时对象并将任务标记为 `cancelled`。

## 12. 保留与清理

- 原视频：默认 7 天。
- 音频文件和 chunk：任务完成、失败或取消后清理。
- 播放 remux/转码文件：随原视频策略清理。
- transcript、摘要、章节：默认 30 天。
- 用户主动删除：删除数据库资源、对象存储对象、搜索索引和关联任务。
- 清理任务必须幂等，删除失败需要记录可诊断错误并在下次运行重试。

## 13. 测试策略

### 单元测试

- 额度预留、确认、释放和并发幂等。
- Session、邮箱 token 和密码校验。
- 视频指纹、媒体时间范围和 chunk manifest。
- transcript 时间偏移、重叠去重和 merge warning。
- 摘要 source segment 对齐、章节单调性和范围修正。
- provider 错误分类、重试和 429 并发降级。

### 集成测试

- PostgreSQL 迁移和用户资源隔离。
- Redis/BullMQ 任务恢复。
- MinIO 上传、下载、删除和过期清理。
- FFmpeg/FFprobe fixture：正常视频、无音轨、多音轨、损坏视频和超限切片。
- Groq adapter 使用 fake provider；测试不会读取现有 `.env` 或真实 API key。

### 端到端测试

- 注册 → 邮箱验证 → 登录 → 上传 → 分析 → 查看 transcript → 点击跳转。
- 两次试用耗尽后禁止第三次任务。
- 两个用户互相无法读取视频和分析结果。
- 429/断网后恢复，已完成 chunk 不重复请求。
- 删除视频后对象和数据库记录清理。

## 14. 部署方式

第一版使用 Docker Compose，包含：

- `web`: React 静态资源和前端入口。
- `api`: Fastify API、认证和 SSE。
- `worker`: FFmpeg、ASR、摘要和清理任务。
- `postgres`: 业务数据库。
- `redis`: 队列和限流状态。
- `minio`: 本地或测试环境的 S3 兼容对象存储。
- `reverse-proxy`: HTTPS、上传大小和安全头配置。

生产环境可以把 PostgreSQL、Redis 和对象存储替换为托管服务，应用代码不改变。部署必须提供健康检查、数据库迁移、结构化日志和基础资源监控。

## 15. 验收标准

V0 验收时：

- 未验证用户不能分析，验证用户获得两次额度。
- 两个用户不能访问彼此的数据。
- 用户可上传基线 MP4 并完成转写。
- 转写分片完成后立即可恢复，强制重启不会重复成功 chunk。
- 点击 transcript 可以跳转并保持原播放状态。
- Groq key 不出现在浏览器、日志和数据库中。
- 视频、音频和缓存按默认保留策略清理。

V1 验收时：

- 可以生成结构化摘要和章节。
- 章节和关键要点时间由 source segment 计算。
- 搜索结果可以跳转 transcript 时间。
- MKV 可以尝试 remux，编码不兼容时给出明确提示。
- 429、5xx、断网、无音轨、损坏视频和错误 API key 有明确状态。
- Docker Linux 部署可以通过健康检查和媒体 fixture 测试。

## 16. 设计自审结论

- 没有未完成内容或未定义的核心接口占位符。
- Electron 方案已明确替换为 Web-first 多租户方案，保留原需求中的媒体、provider、恢复和时间对齐原则。
- V0 与 V1 边界清晰，V0 不依赖 V1 摘要和搜索才能交付。
- 平台统一 API key、邮箱验证、额度账本和对象存储覆盖了公网多用户的主要安全与成本控制点。
- 真实 API key 不需要在开发、测试或文档阶段读取；实现只依赖 `GROQ_API_KEY` 环境变量。
