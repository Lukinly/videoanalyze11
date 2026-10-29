# 常用命令

本项目的常用开发、测试、部署命令速查。部署细节见 [operations.md](operations.md)。

所有命令从仓库根目录执行，当前统一维护分支为 `main`。历史交接文档中的其他目录不再是开发入口。

## 环境准备

```bash
# 要求：Node.js 24+、pnpm（经 corepack）、FFmpeg/FFprobe
# 使用仓库锁定的 pnpm 版本
corepack pnpm install

# 配置环境变量：复制模板并按需替换，不要提交真实 .env
cp .env.example .env
# 设置 GROQ_API_KEY 以及三项 LLM 配置（均只在服务端使用）
```

## 开发模式

原生本地运行（首次按 [本地运行与验证](local-development.md) 安装基础工具并使用 `.env.local.example` 配置）：

```bash
corepack pnpm local:dev
```

自动启动 PostgreSQL、Redis、S3 开发存储、Mailpit、API、Worker 和 Vite；修改源码自动编译重启。访问 http://localhost:5173；Ctrl+C 停止并保留 `.local/` 数据。

已有基础服务时配置 `.env` 后运行 `corepack pnpm build && corepack pnpm db:migrate && corepack pnpm dev`。`dev` 自动加载根目录 `.env`，Worker 入口为 `worker-main.js`。生产环境继续使用下方 Docker Compose。

## 校验与构建

```bash
corepack pnpm typecheck          # tsc -b，全工作区类型检查
corepack pnpm lint               # ESLint 全库
corepack pnpm build              # 按依赖顺序构建全部 workspace 包
```

## 测试

```bash
corepack pnpm test               # 全部单测（vitest run，覆盖 apps/* 与 packages/*）
corepack pnpm test:v0            # 同上，v0 验证入口的别名
corepack pnpm test:acceptance    # 仅跑 tests/acceptance 下的验收测试
corepack pnpm test:postgres      # 正式 SQL 迁移 + PostgreSQL/FFmpeg 集成，需运行中的数据库
corepack pnpm test:e2e           # Playwright 浏览器验证
```

运行单个子包的测试：

```bash
corepack pnpm --filter @videoanalyze/api test
corepack pnpm --filter @videoanalyze/web test
corepack pnpm --filter @videoanalyze/worker test
```

## 数据库迁移

迁移由 Compose 中的一次性 `migrate` 服务在 api / worker 启动前按编号顺序自动执行，
一般无需手动跑。本地手动执行：

```bash
corepack pnpm --filter @videoanalyze/api build
DATABASE_URL=postgres://videoanalyze:videoanalyze@localhost:5433/videoanalyze \
  node apps/api/dist/db/migrate.js
```

迁移文件位于 `apps/api/src/db/migrations/`（`0001_initial.sql` 等），只增不改：
已应用的迁移不可编辑，新增请追加新的编号文件。

## 创建管理员

```bash
# 本地交互式创建，会提示输入密码（至少 8 位）
corepack pnpm admin:create --email admin@example.com

# 或在运行中的容器里创建
sudo docker compose --env-file .env -f infra/docker-compose.yml run --rm api \
  node dist/cli/admin-create.js --email admin@example.com
```

## Docker Compose

以下命令在 Linux/WSL 下通常需要 `sudo`。Compose 项目名为 `videoan`，
容器命名形如 `videoan-api-1`。

```bash
# 启动完整栈（postgres / redis / minio / mailpit / api / worker / web / caddy / migrate）
sudo docker compose --env-file .env -f infra/docker-compose.yml up -d --build \
  postgres redis minio minio-init migrate mailpit api worker web proxy

# 查看服务状态
sudo docker compose --env-file .env -f infra/docker-compose.yml ps

# 跟踪日志
sudo docker compose --env-file .env -f infra/docker-compose.yml logs -f migrate api worker

# 重建并强制重启指定服务
sudo docker compose --env-file .env -f infra/docker-compose.yml up -d --build --force-recreate api minio proxy

# 停止（保留数据卷）
sudo docker compose --env-file .env -f infra/docker-compose.yml down

# 停止并删除数据卷（会清空用户/视频/账单等数据，慎用！）
sudo docker compose --env-file .env -f infra/docker-compose.yml down -v
```

本地 CA 由 Caddy 持久化在 `caddy-data` 卷中，`down -v` 会破坏本地 HTTPS 信任链。

## 本地 HTTPS 与证书

首次启动 Caddy（proxy）后执行一次，导出并信任本地 CA（WSL + Windows 双端）：

```bash
bash scripts/setup-local-https.sh          # 安装本地 CA
bash scripts/setup-local-https.sh --validate   # 仅校验证书是否就绪
```

完成后访问 https://localhost。浏览器若仍报证书告警，重启浏览器，并把
`.local/videoanalyze-local-root.crt` 导入 Windows CurrentUser 受信根存储。

## 健康检查

```bash
curl http://localhost/healthz      # 存活探针
curl http://localhost/readyz       # 依赖就绪检查（数据库/Redis/对象存储，不含凭据）
```

## 本地端到端上传+分析验证

走真实后端流水线验证一个 MP4 上传到分析完成、原片删除且文字结果仍可读取：

默认视频为仓库内的 `.local/test.mp4`，可通过 `VIDEO_PATH` 指定其他本地文件。

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" \
  corepack pnpm verify:local-upload-analysis
```

注意：若宿主机 shell 配置了出站代理（`HTTP_PROXY` / `HTTPS_PROXY`，如 Clash），
本地域名 `localhost` 与 `storage.localhost` 必须都在 `NO_PROXY` 里，否则直传
`storage.localhost` 的请求会被代理劫持并在 TLS 握手时断开。

Node 24+ 下若 shell 里设置了 `NODE_USE_ENV_PROXY=1`，内置 `fetch` **和 `node:https`
都会**读取代理变量，且会回退到小写 `http_proxy` / `https_proxy` / `all_proxy`——
所以小写变量和 `NODE_USE_ENV_PROXY` 也要一并清掉，仅清大写不够。示例：

```bash
env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u all_proxy \
  -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
  NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" \
  NO_PROXY="localhost,127.0.0.1,::1,storage.localhost" \
  corepack pnpm verify:local-upload-analysis
```

成功时脚本只输出一行安全 JSON，不输出邮箱、文件名、URL、凭据或正文：

```json
{"runId":"…","terminalStatus":"completed","originalDeleted":true,"resultAvailability":"available","transcriptSegmentCount":281,"chapterCount":7}
```

配置了摘要 LLM（`llm_api_key` 等）时，`chapterCount` 应大于零；未配置摘要时可为零。
`originalDeleted: true` 与 `resultAvailability: "available"` 同时出现，表示原片和文字结果的生命周期已经解耦。

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `VIDEO_PATH` | 输入视频路径，默认 `test.mp4` |
| `E2E_EMAIL` / `E2E_PASSWORD` | 设置后复用已有账号；不设置则自动注册临时账号并从 Mailpit 读验证码 |
| `E2E_BASE_URL` | 默认 `https://localhost` |
| `MAILPIT_URL` | 默认 `http://localhost:8025` |
| `E2E_TIMEOUT_MS` | 默认 45 分钟（真实 worker/Groq 处理较慢） |

需要 Groq key，且会真实消耗配额。

## 端口一览

| 端口 | 服务 |
| --- | --- |
| 80 / 443 | Caddy 反向代理（入口） |
| 3000 | API |
| 5173 | Web 前端（Vite dev） |
| 5433 | PostgreSQL（宿主侧映射，容器内 5432） |
| 9000 / 9001 | MinIO API / 控制台 |
| 8025 | Mailpit（Web UI 与 API） |

Redis 默认只在容器网络内暴露，未映射到宿主。

## 关键环境变量（.env）

| 变量 | 说明 |
| --- | --- |
| `GROQ_API_KEY` | 分析 worker 的 Groq 密钥，必填 |
| `llm_api_key` / `llm_api_base_url` / `llm_api_model` | 摘要与 AI 笔记 LLM（Anthropic 或 OpenAI 兼容端点）；当前流水线要求三项齐全。也接受大写别名 `LLM_API_KEY` / `LLM_API_BASE_URL` / `LLM_API_MODEL` |
| `LLM_API_PROTOCOL` | `auto`（默认）、`anthropic`、`openai`；DashScope 自动选择 OpenAI 兼容协议 |
| `LLM_CONTEXT_WINDOW` | 摘要 LLM 上下文窗口，默认 `128000`，决定单窗 vs map-reduce |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO 凭据 |
| `PUBLIC_HOST` / `STORAGE_HOST` | 网站与存储域名，见 operations.md 各阶段配置 |
| `MAX_UPLOAD_BYTES` | 最大上传字节数，默认 2 GB |
| `MAX_VIDEO_DURATION_SECONDS` | 服务端探测的视频时长上限，默认 14400（4 小时） |
| `MAX_ACTIVE_RUNS_PER_USER` | 每用户并发分析数，默认 2 |
| `GLOBAL_WORKER_CONCURRENCY` | worker 全局并发，默认 2 |
| `FFMPEG_CONCURRENCY` | 单 worker 的 FFmpeg 并发上限，默认 1 |
| `LONG_VIDEO_CONCURRENCY` / `LONG_VIDEO_THRESHOLD_SECONDS` | 超过 120 分钟的视频处理槽，默认 1 个 |
| `MAX_QUEUED_RUNS_PER_USER` / `MAX_TOTAL_QUEUED_RUNS` | 每用户队列上限 2、全局队列上限 20 |
| `MAX_QUEUE_WAIT_SECONDS` | 新任务允许的预计最长排队时间，默认 3600 秒 |
| `ORIGINAL_RETENTION_DAYS` / `RESULT_RETENTION_DAYS` | 兼容配置；终态原片立即清理，标准结果长期保留，隐私结果完成后保留 24 小时 |
| `TEMP_MEDIA_CAPACITY_BYTES` | 临时媒体容量预算；预计使用量超过 80% 时拒绝新上传，历史结果仍可读取 |
| `RETENTION_SWEEP_INTERVAL_SECONDS` | 清理扫描间隔；处理孤立上传、清理重试、陈旧任务和隐私结果到期 |
| `BACKUP_AGE_RECIPIENT` / `BACKUP_S3_*` | age 加密异地备份；备份排除所有 `ephemeral_*` 表数据 |
