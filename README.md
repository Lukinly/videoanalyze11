# videoanalyze

视频转写、摘要和 AI 笔记 Web 应用。支持本地视频上传及 YouTube、B 站公开链接，提供逐字稿、章节、时间戳跳转、搜索、结果历史和导出。

首页对访客开放，提供产品示例与功能介绍。访客可以先选择本地文件或填写链接，点击上传分析、读取视频信息或顶部登录入口时再打开账号弹窗。登录、注册和找回密码在弹窗中完成，关闭弹窗或登录成功都会保留已选文件与链接；个人结果和分析接口仍要求登录。

平台链接读取成功后即可使用官方播放器预览，无需等待 AI 分析完成。分析工作台和笔记页也使用同一播放器，时间点在页内跳转，并保留“打开原视频”入口。YouTube 使用官方 IFrame API 控制跳转及同步进度；B站保留所选分P，通过官方 `t` 参数重新加载到指定时间，当前不回传连续播放进度。播放器的可用性及清晰度由原站提供，加载失败或禁止外嵌时仍可打开原站；不额外下载或缓存预览视频。

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

PostgreSQL 保存任务、结果和积分台账；Redis 承载任务队列；MinIO 保存上传媒体。媒体解析使用 FFmpeg/FFprobe 和 Groq ASR，摘要与笔记使用可配置的 Anthropic 或 OpenAI 兼容 LLM（含通义千问）。

AI 笔记按“标题、时间范围、原视频画面、正文”展示，每节只保留一个回看入口。时间范围来自所引用逐字稿的起止时间，截图选取中间的引用时刻。新分析在原片清理前提取 JPEG 并随笔记保存，共用笔记的访问权限、删除及隐私到期规则，无需额外数据库迁移。

为控制长视频的处理时间和结果大小，每份笔记最多保存 24 张截图，图片总量约 3 MB。平台视频取流失败时保留文字笔记；已有笔记如果缺少截图，可在笔记页选择同一本地原视频，在浏览器内临时补图与回看，无需重新上传或分析。原片已清理且没有本地文件时，无法补出历史画面。

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

## 本机快速启动（macOS，无需 Docker）

```bash
brew install postgresql@16 redis mailpit ffmpeg
# 仅首次复制；已有 .env 时保留配置
cp .env.local.example .env
# 填写 Groq 和 LLM 配置后启动
corepack pnpm local:dev
```

访问 http://localhost:5173，验证码在 http://localhost:8025 查看。命令自动启动基础服务、构建、迁移和应用；Ctrl+C 停止，数据保留在 `.local/`。缺少模型凭据时 Web/API 可用，Worker 等待配置。详见 [本地运行与验证](docs/local-development.md)。

## Docker 启动应用

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

- [2026-10-29 本地部署版本说明](docs/local-deployment-2026-10-29.md)
- [常用命令](docs/commands.md)
- [部署与数据保留](docs/operations.md)
- [整合来源及待修复问题](docs/consolidation.md)

已修复新上传时长探测、隐私笔记约束、队列补发和跨进程 SSE，并补齐本地启动入口。真实 PostgreSQL/FFmpeg 集成与浏览器注册上传已验证；2026-10-19 使用真实 Groq 和通义千问完成了标准、隐私模式短视频的完整分析与计费清理验收，详见 [验收记录](docs/validation-2026-10-19.md)。长视频和平台链接仍需单独验收。
