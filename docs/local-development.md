# 本地运行与验证

从仓库根目录执行命令。Node.js 24+；pnpm 由 Corepack 固定为 11.20.0。

## macOS 原生开发（无需 Docker）

首次安装依赖：

```bash
npm install --global corepack
brew install postgresql@16 redis mailpit ffmpeg
corepack pnpm install --frozen-lockfile
cp .env.local.example .env  # 仅首次执行；保留已有凭据
```

填写 `.env` 中的 `GROQ_API_KEY` 和 `llm_api_key`、`llm_api_base_url`、`llm_api_model`。
LLM 支持 Anthropic Messages 和 OpenAI 兼容 Chat Completions 两种协议。`LLM_API_PROTOCOL=auto`（默认）自动识别阿里云 `/compatible-mode/v1`、`/openai/v1` 和完整 `/chat/completions` 地址，其余默认使用 Anthropic。通用 OpenAI 兼容端点请显式设置 `LLM_API_PROTOCOL=openai`；程序在 base URL 后追加 `/chat/completions`。Anthropic 模式追加 `/v1/messages`。Qwen 请求会关闭思考模式并使用 JSON 输出，用于结构化摘要与笔记。

```bash
corepack pnpm local:dev
```

该命令初始化 `.local/postgres` 中独立的 PostgreSQL 数据目录，启动仅监听回环地址的 PostgreSQL（5433）、Redis（6379）、S3 兼容开发存储（9000）、Mailpit（8025），自动构建并迁移数据库，然后启动 API、Worker 和 Vite。所有数据保存在 `.local/`，Ctrl+C 停止本次启动的进程，再次运行保留数据。遇到已占用端口时命令会停止并报错，不接管已有服务。

- 应用：http://localhost:5173
- 注册验证码邮件：http://localhost:8025（填写自己的邮箱后在此查看验证码即可）
- 健康检查：http://localhost:5173/readyz
- 基础服务日志：`.local/postgres.log`、`.local/redis.log`、`.local/mailpit.log`

缺少 Provider 配置时仍可使用 Web、注册登录和上传接口；Worker 暂不启动，分析任务会等待。填好配置后重启 `local:dev` 启用分析。不要在未配置 Worker 时反复提交任务。

开发存储使用固定的 `S3RVER` 凭据，仅用于本地开发；PostgreSQL 只允许本机连接并使用 trust 认证。正式部署使用 Docker Compose 和 MinIO，采用 `.env.example`，不使用上述开发凭据。若使用 Intel Mac、Linux 或自定义 PostgreSQL 位置，设置 `POSTGRES_BIN_DIR` 指向包含 `postgres`、`initdb`、`pg_isready` 的目录。

## 平台链接工具（可选）

本地上传不需要平台下载工具。启用 YouTube、B 站链接导入需要 Python 3.10+、yt-dlp 和 bilibili-cli。可以使用 uv 安装独立环境：

```bash
brew install uv
uv venv --python 3.12 .local/platform-tools
uv pip install --python .local/platform-tools/bin/python yt-dlp==2026.7.4 bilibili-cli==0.6.2
```

`local:dev` 自动把该环境的 bin 目录加入 PATH；重启后生效。Docker 镜像已经包含这些工具。公开平台可能要求验证或限制访问，平台真实链接仍需使用可访问的视频另行验收。

本机开发模式在 B站 CLI / API 被 HTTP 412 限制时，会尝试使用已安装并连接 Chrome 的 OpenCLI 读取视频信息和字幕。它复用浏览器当前会话，不导出 Cookie；需保持 Chrome 和 OpenCLI 扩展可用。视频时长按所选分P读取，字幕保留原时间戳。没有可读字幕时仍使用音频下载和 ASR；浏览器备用通道不提供音频下载，下载也受平台访问限制。

设置 `BILIBILI_BROWSER_FALLBACK=0` 可关闭浏览器备用通道；本机开发以外默认关闭，只有显式设置 `BILIBILI_BROWSER_FALLBACK=1` 才启用。Docker / 无桌面部署不会自动依赖宿主机浏览器。

## 使用已有基础服务

将 `.env` 指向已有 PostgreSQL、Redis、S3 和邮件服务后执行：

```bash
corepack pnpm build
corepack pnpm db:migrate
corepack pnpm dev
```

`dev` 会先构建，再同时监听 TypeScript 与服务文件变更，Worker 使用实际任务入口 `worker-main.js`。Vite 将 `/api`、`/healthz`、`/readyz` 代理到本机 3000 端口。修改 `.env` 后需要重启。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:postgres  # 基础服务运行中；使用 .env 的 DATABASE_URL
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e      # 构建产物的浏览器登录页检查
```

`test:postgres` 在随机隔离 schema 中执行正式 SQL 迁移和真实 FFmpeg 处理，验证新上传时长探测、标准与隐私结果、笔记到期时间、不可变计费、幂等扣款和终态媒体清理。AI 响应使用 fixture，不调用外部 Provider；完成后删除测试 schema。

完整单测中的 PostgreSQL 集成测试默认跳过，设置 `TEST_DATABASE_URL` 可纳入。仅将测试数据库地址作为该变量传入。

准备短视频（以下截取仓库已有的本地测试文件；也可换成自己的视频）：

```bash
ffmpeg -i .local/test.mp4 -t 15 -c copy .local/smoke.mp4
```

基础业务验证，不消耗 AI 配额：

```bash
VIDEO_PATH=.local/smoke.mp4 E2E_BASE_URL=http://127.0.0.1:5173 \
  E2E_STORAGE_ORIGIN=http://127.0.0.1:9000 E2E_SMOKE_ONLY=1 \
  corepack pnpm verify:local-upload-analysis
```

真实浏览器注册、登录、直传、SSE 和取消验证（创建任务后立即取消）：

```bash
E2E_RUNTIME=1 E2E_BASE_URL=http://127.0.0.1:5173 \
  corepack pnpm test:e2e
```

真实 Groq 和 LLM 端到端验证，需要 Worker 正在运行，会消耗 Provider 配额：

```bash
VIDEO_PATH=.local/smoke.mp4 E2E_BASE_URL=http://127.0.0.1:5173 \
  E2E_STORAGE_ORIGIN=http://127.0.0.1:9000 \
  corepack pnpm verify:local-upload-analysis
```

增加 `E2E_RETENTION_MODE=privacy` 验证隐私模式。脚本检查逐字稿、章节、AI 笔记、唯一扣款及原片删除后结果可读。HTTP 仅允许显式选择的 loopback 地址，默认 HTTPS 验证保持不变。
