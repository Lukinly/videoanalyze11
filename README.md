# videoanalyze

视频转写、摘要和 AI 笔记 Web 应用。支持本地视频上传及 YouTube、B 站公开链接，提供逐字稿、章节、时间戳跳转、搜索、结果历史和导出。

当前项目统一在本仓库根目录维护，主线为 `main`。Web、API、Worker 和共享领域包均包含在仓库内，无需原来的两个 worktree。

## 项目结构

```text
apps/web/          React + Vite 前端
apps/api/          Fastify API、认证、任务准入和结果服务
apps/worker/       BullMQ Worker、FFmpeg、ASR、摘要、笔记与清理
packages/domain/   共享类型、Zod schema、计费和保留规则
packages/testkit/  测试辅助包
infra/             Docker Compose、Caddy、数据库备份
scripts/           本地 HTTPS、验收、备份与恢复
tests/             验收测试与 fixture 说明
docs/              部署、命令、设计和历史交接
```

PostgreSQL 保存任务、结果和积分台账；Redis 承载任务队列；MinIO 保存上传媒体。媒体解析使用 FFmpeg/FFprobe 和 Groq ASR，摘要与笔记使用可配置的 Anthropic 兼容 LLM。

## 安装与验证

以下命令均从仓库根目录执行。使用 Node.js 24+ 和仓库锁定的 pnpm 11.20.0；宿主机运行媒体集成测试需要 FFmpeg/FFprobe。

```bash
# 若系统没有 Corepack，先安装 npm install --global corepack
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

## 启动应用

安装 Docker Compose，首次运行时复制 `.env.example` 为 `.env`，配置 `GROQ_API_KEY` 及 `llm_api_key`、`llm_api_base_url`、`llm_api_model`。本地邮箱链接可使用 `VERIFICATION_BASE_URL=https://localhost`。

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build \
  postgres redis minio minio-init migrate mailpit api worker web proxy
# 以下证书安装脚本适用于 Linux/WSL；macOS 需自行导出并信任 Caddy 本地 CA。
bash scripts/setup-local-https.sh
```

Web 为 `https://localhost`，Mailpit 为 `http://localhost:8025`。备份服务在配置独立备份存储后单独启动。数据库迁移自动执行；停止服务使用 `docker compose --env-file .env -f infra/docker-compose.yml down`，保留已有数据卷。

真实上传验收需要运行中的服务、有效 Provider 配置和本地测试视频。脚本默认读取仓库内的 `.local/test.mp4`，也可以设置 `VIDEO_PATH`；测试媒体与 `.env` 不提交到 Git。

## 维护资料与当前状态

- [常用命令](docs/commands.md)
- [部署与数据保留](docs/operations.md)
- [整合来源及待修复问题](docs/consolidation.md)

本次统一的是维护入口和代码历史。整合记录列出的上传时长、隐私字段约束、队列一致性和 SSE 问题仍需修复，当前代码不应视为已经完成真实端到端运行验收。
