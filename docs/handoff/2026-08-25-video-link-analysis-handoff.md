# videoanalyze 视频链接解析功能交接文档

更新时间：2026-08-25  
当前工作树：`/home/sroot/workspace/videoanalyze/videoanlast-worktrees/transient-retention-ai-notes`  
当前分支：`codex/transient-retention-ai-notes`  
当前提交：`b76a333 fix: clear domain build cache in web image`

## 0. 给新会话的直接指令

新会话应先执行：

```bash
cd /home/sroot/workspace/videoanalyze/videoanlast-worktrees/transient-retention-ai-notes
git status --short
git log -5 --oneline
docker compose --env-file .env -f infra/docker-compose.yml ps -a
```

然后完整阅读本文件。不要切换到原工作区开发，不要重新实现已经提交的视频链接功能，也不要清理或覆盖原工作区的未提交修改。

当前建议的下一步顺序：

1. 通过网页分别完成一次 YouTube 和 B 站公开视频的真实端到端解析，确认最终状态为 `completed`。
2. 修正远程视频详情页仍显示“重新选择本地原视频”和“开启声音”的 UX 问题。
3. 修复或绕过 Windows 证书自动导入失败；WSL 内 HTTPS 已经可信。
4. 完成验收后，再决定是否将 `codex/transient-retention-ai-notes` 合并到目标主分支。

## 1. 当前结论

第一期“视频链接作为另一种视频传入方式”已经接入现有解析流水线：

- 首页提供“上传视频解析”和“输入链接解析”两个入口。
- 第一期支持 YouTube 和 B 站公开视频。
- 明确不支持直播、预告直播和直播回放状态。
- 链接预览不会立即扣费或创建分析；用户确认后才进入已有分析流程。
- 链接视频沿用现有积分、队列、转写、摘要、章节、AI 笔记、搜索、导出、保留策略和永久删除功能。
- 远程视频不复制原视频到长期对象存储，只在 Worker 中临时读取字幕或音频。
- 结果页提供“原视频”按钮；章节、逐字稿和 AI 笔记时间戳会生成对应平台的跳转链接。
- 本地上传视频的原功能保持不变。

`agent-reach` 只作为“读取视频平台信息/字幕/媒体”的设计参考，不是项目运行时依赖。运行项目不需要 Codex skill，也不依赖 `/home/sroot/.agents/skills/agent-reach`。

## 2. 工作区和分支关系

### 2.1 应继续使用的工作树

```text
/home/sroot/workspace/videoanalyze/videoanlast-worktrees/transient-retention-ai-notes
branch: codex/transient-retention-ai-notes
HEAD:   b76a333
```

本工作树在写本文档前无未提交代码修改，根目录 `.env` 已存在但被 Git 忽略。

### 2.2 不应修改的原工作区

```text
/home/sroot/workspace/videoanalyze/videoanlast
branch: feature/v0-v1-web
HEAD:   a770cef
```

原工作区包含大量已修改和未跟踪文件，这些内容属于原用户工作状态。不要执行：

```bash
git reset --hard
git checkout -- .
git clean -fd
git add .
```

两个目录是同一 Git 仓库的不同 worktree，源码目录彼此独立，并不存在运行时源码依赖；但二者共享 Git 对象库。同时，Compose 项目名固定为 `videoan`，所以从任一工作树启动 Compose 都可能重建同一组 `videoan-*` 容器。后续只从当前隔离工作树运行 Compose。

## 3. 项目用途和技术结构

videoanalyze 是一个多用户视频知识提取系统。用户上传本地视频或输入公开视频链接后，系统在后台完成媒体准备、转写、摘要、章节、详细 AI 笔记和可搜索结果，并按照视频时长进行积分结算。

主要目录：

```text
apps/
  api/       Fastify API、鉴权、积分、链接检查、数据库仓储、迁移
  worker/    BullMQ Worker、媒体处理、平台字幕/音频读取、ASR、摘要和 AI 笔记
  web/       React + Vite 前端
packages/
  domain/    跨服务领域类型、校验、计费和视频链接规范化
  testkit/   测试辅助代码
infra/
  docker-compose.yml
  reverse-proxy/   Caddy 本地/生产配置
  backup/          加密数据库备份镜像
scripts/
  setup-local-https.sh
  verify-local-upload-analysis.mjs
  backup-database.sh / restore-database.sh
tests/acceptance/  跨模块验收测试
docs/              运维、命令、项目总结、设计与交接记录
```

核心服务拓扑：

```text
Browser -> Caddy -> Web / API
API -> PostgreSQL + Redis + MinIO + Mailpit
Worker -> Redis queue + PostgreSQL + MinIO + Groq/可选摘要模型
Worker -> yt-dlp / bili-cli / bilibili-api-python / FFmpeg
```

## 4. 视频链接功能数据流

### 4.1 浏览器和 API

1. 用户切换到“输入链接解析”。
2. `POST /api/link-imports/preview` 读取公开元数据并返回标题、作者、封面、时长、平台、预计积分和已有解析信息。
3. 用户点击“确认解析”。
4. `POST /api/link-imports/confirm` 创建或复用当前用户的链接视频记录。
5. 前端调用原有分析启动接口，后续队列、积分和结果流程不分本地/链接两套实现。

接口要求登录；URL 最大 2048 字符；链接检查按用户限制为每分钟 12 次。短链解析只允许受控的 B 站域名跳转，防止任意重定向和 SSRF。

### 4.2 平台元数据

- YouTube：API 容器使用 `yt-dlp --dump-single-json --no-playlist`。
- B 站：API 容器使用 `bili video ... --json`，并通过 B 站公开 view API 补充分 P 时长和封面。
- `b23.tv`：最多跟随 5 次跳转，且每一跳必须属于允许的 B 站域名。
- 直播、无法取得正时长的视频、超过 4 小时的视频会在预览阶段拒绝。

支持的主要链接形态：

- `youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/shorts/...`
- `bilibili.com/video/BV...`
- `m.bilibili.com/video/BV...`
- `b23.tv/...`
- B 站 `?p=N` 分 P 链接

### 4.3 Worker 媒体准备

Worker 先尝试使用平台字幕，失败或无字幕时再下载音频并进入原有 Groq ASR 流程：

- YouTube 字幕：`yt-dlp` 下载人工或自动 VTT。
- YouTube 音频：`yt-dlp` 提取 M4A。
- B 站第 1 P 字幕：`bili-cli` timeline JSON。
- B 站其他分 P 字幕：`apps/worker/scripts/bilibili-part.py`。
- B 站所有音频：`bilibili-part.py`，通过 `bilibili-api-python` 获取公开音频流。

B 站 Python 助手必须保留 `detect_best_streams(..., codecs=[])`。当前 `bilibili-api-python 17.4.2` 的 `VideoCodecs.UNKNOWN` 是不可迭代哨兵对象；若省略 `codecs=[]`，会出现：

```text
TypeError: 'object' object is not iterable
```

### 4.4 外部播放和时间戳

`packages/domain/src/link-source.ts` 负责生成可信的规范化链接：

- YouTube 时间戳：`t=<seconds>s`
- B 站时间戳：`t=<seconds>`，保留规范化后的 `p` 参数

结果页和独立 AI 笔记页的时间戳点击都会在新标签页打开平台原视频。用户提供的其他查询参数不会被原样带入跳转链接。

## 5. 关键代码位置

| 范围 | 文件 |
| --- | --- |
| 链接解析与时间戳 | `packages/domain/src/link-source.ts` |
| 链接数据库迁移 | `apps/api/src/db/migrations/0009_link_video_sources.sql` |
| 元数据检查 | `apps/api/src/links/platform-inspector.ts` |
| 预览/确认业务 | `apps/api/src/links/link-import-service.ts` |
| HTTP 路由 | `apps/api/src/routes/link-imports.ts` |
| 链接视频仓储 | `apps/api/src/db/repositories/videos.ts` |
| 前端双入口 | `apps/web/src/app.tsx` |
| 链接预览组件 | `apps/web/src/library/LinkVideo.tsx` |
| 远程结果页 | `apps/web/src/viewing/WatchingWorkspace.tsx` |
| AI 笔记外部时间戳 | `apps/web/src/notes/NotesPage.tsx` |
| 平台字幕/音频加载 | `apps/worker/src/links/platform-source.ts` |
| B 站分 P/音频助手 | `apps/worker/scripts/bilibili-part.py` |
| Worker 接入点 | `apps/worker/src/worker-main.ts` |
| 容器配置 | `apps/api/Dockerfile`、`apps/worker/Dockerfile`、`apps/web/Dockerfile` |

## 6. 数据库变化

迁移 `0009_link_video_sources.sql` 已应用到当前 PostgreSQL 数据卷。`schema_migrations` 当前包含 `0009`。

`videos` 新增：

- `source_platform`: `upload | youtube | bilibili`
- `source_url`
- `external_video_id`
- `source_part`
- `source_author`
- `thumbnail_url`
- `subtitle_language`
- `subtitle_kind`

同一用户、同一平台、同一外部视频 ID、同一分 P 使用唯一索引去重；不同用户之间不共享记录。

## 7. 当前启动方式

### 7.1 环境文件

```bash
cd /home/sroot/workspace/videoanalyze/videoanlast-worktrees/transient-retention-ai-notes
cp .env.example .env   # 仅在 .env 不存在时执行
```

`.env` 至少需要有效的 `GROQ_API_KEY`。真实值不能写入文档、日志或提交。当前运行容器已检测到 Groq Key 配置，但交接文档不记录其内容。

Compose 必须显式传入根目录环境文件；否则 API 与 MinIO 可能收到不同的 S3 密码：

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build \
  postgres redis minio minio-init migrate mailpit api worker web proxy
```

本地启动命令刻意不包含可选 `backup` 服务。

查看状态和日志：

```bash
docker compose --env-file .env -f infra/docker-compose.yml ps -a
docker compose --env-file .env -f infra/docker-compose.yml logs -f migrate api worker
```

停止但保留数据卷：

```bash
docker compose --env-file .env -f infra/docker-compose.yml down
```

不要执行 `down -v`，否则会删除 PostgreSQL、Redis、MinIO 和 Caddy 数据卷。

### 7.2 本地 HTTPS

```bash
bash scripts/setup-local-https.sh
```

当前状态：

- Caddy 本地 CA 已导出到 `.local/videoanalyze-local-root.crt`。
- WSL CA 已安装，WSL 中直接请求 `https://localhost` 返回 HTTP 200，不需要 `curl -k`。
- 自动导入 Windows CurrentUser Trusted Root 失败，PowerShell 报 `InvalidDestinationPath`；Windows 浏览器可能仍显示证书警告。
- 新会话如处理此问题，应先复现 Windows 证书导入，再考虑把证书复制到 Windows 本地临时路径后导入；不要反复重建或删除 Caddy 数据卷。

本地地址：

- Web：`https://localhost`
- API liveness：`http://localhost:3000/healthz`
- API readiness：`http://localhost:3000/readyz`
- Mailpit：`http://localhost:8025`
- MinIO Console：`http://localhost:9001`

## 8. 已完成提交

视频链接功能及其启动修复：

```text
750f651 feat: add YouTube and Bilibili link analysis
ebeb445 fix: build domain before web image
7c5ae3d fix: load root env for compose commands
8efc77c fix: download Bilibili audio through helper
b76a333 fix: clear domain build cache in web image
```

重要修复说明：

- `ebeb445`：Web 镜像在 Vite 前先构建 `@videoanalyze/domain`。
- `7c5ae3d`：Compose 命令和 HTTPS 脚本显式加载根目录 `.env`。
- `8efc77c`：绕过 `bili-cli`/`bilibili-api-python` 默认 codec 扫描错误，B 站音频统一走 Python 助手。
- `b76a333`：Web 镜像构建前删除 `packages/domain/tsconfig.tsbuildinfo`。否则 Docker 会带入增量缓存但排除 `dist`，TypeScript 返回 0 却不生成产物。

API 和 Worker Dockerfile 已有同类 `tsbuildinfo` 清理。不要删除这些清理步骤，除非同时有能证明干净 Docker 构建稳定通过的新方案。

## 9. 最新验证证据

应用代码最新全量验证（提交 `8efc77c` 后）：

```text
94 个测试文件通过
346 项测试通过
typecheck 通过
lint 通过
生产 build 通过
```

提交 `b76a333` 只修改 Web Dockerfile。该提交之后已执行：

- 带真实宿主 `tsconfig.tsbuildinfo` 的 `docker build --target build -f apps/web/Dockerfile .`：通过。
- 完整本地 Compose 构建和启动：通过，所有目标镜像构建成功。
- API `/healthz`：200。
- API `/readyz`：200，database/redis/storage 全部 `ok`。
- WSL `https://localhost`：200。
- 数据库迁移 `0009`：已应用。
- 同一条此前失败的 B 站公开视频在新 Worker 内真实生成 `source.m4a`，大小 1,630,477 bytes。

尚未形成新鲜证据的项目：

- 修复 B 站音频后，尚未通过网页把该视频重新跑到完整 `completed` 终态。
- 尚未记录一条真实 YouTube 视频从链接预览到完整 AI 笔记完成的端到端结果。

因此新会话不应声称“两平台完整真实端到端均已验收”，应先完成第 0 节列出的两次网页验证。

## 10. 已知限制和待办

### 10.1 明确产品边界

- 不支持直播、预告直播或直播状态视频。
- 仅保证公开且当前服务器网络能够访问的视频。
- 私密、会员、登录后可见、地区限制、风控或必须携带 cookies 的视频可能失败。
- 单视频最长 4 小时。
- 第一期仅支持 YouTube 和 B 站。

### 10.2 下一会话优先修复

1. **远程结果页仍显示本地视频操作。**  
   `WatchingWorkspace` 对远程视频已经显示平台卡片，但仍无条件渲染 `ResultActions`，其中包含“重新选择本地原视频”；顶部也仍显示无效的“开启声音”按钮。远程来源应隐藏这些只对本地播放器有效的操作，同时保留导出和永久删除。

2. **失败任务不会自动续跑。**  
   已经进入 `failed` 终态的旧任务不会在 Worker 修复后继续。用户需要回到首页重新提交相同链接；仓储会复用链接视频记录并创建新的分析。不要直接修改数据库状态或手工重推队列，除非先验证积分 reservation/settlement 状态。

3. **Windows HTTPS 证书自动导入失败。**  
   WSL 已可信，失败仅发生在 PowerShell 从 `\\wsl.localhost\...` 路径调用 `Import-Certificate`。修复时需要测试 Windows 本地路径导入，并继续保护 Caddy 数据卷。

4. **平台下载器存在上游漂移风险。**  
   Worker 镜像固定 `yt-dlp==2026.7.4` 和 `bilibili-cli==0.6.2`，后者当前解析到 `bilibili-api-python 17.4.2`。升级任何平台工具前，必须至少验证元数据、字幕、无字幕音频回退和 B 站分 P。

5. **B 站第 1 P 字幕仍使用 bili-cli。**  
   所有 B 站音频已经统一走 Python 助手，但默认第 1 P 的字幕 timeline 仍走 `bili-cli`。若真实视频持续出现字幕读取失败，可考虑让所有 B 站字幕也统一走 Python 助手；必须先写失败测试并保留无字幕时的音频回退。

## 11. 推荐验收步骤

### 11.1 基础质量门槛

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
```

### 11.2 Docker 和健康检查

```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build \
  postgres redis minio minio-init migrate mailpit api worker web proxy

curl -fsS http://localhost:3000/healthz
curl -fsS http://localhost:3000/readyz
curl -fsS https://localhost >/dev/null
```

### 11.3 网页真实验收

对 YouTube 和 B 站各执行一次：

1. 登录 `https://localhost`。
2. 切换“输入链接解析”。
3. 粘贴公开、非直播、短时长测试视频。
4. 检查预览标题、作者、时长、封面和预计积分。
5. 确认解析，观察 queued/running/completed。
6. 检查积分扣费只有一笔且金额匹配时长快照。
7. 检查逐字稿、摘要、章节和 AI 笔记。
8. 点击多个时间戳，确认跳转到平台对应时间。
9. 点击“原视频”，确认平台新标签页打开。
10. 检查历史记录能够重新打开结果。

不要把测试账号密码、API Key、完整签名 URL、完整转录正文或平台下载响应写入交接记录。

## 12. 新会话可直接使用的开场提示

```text
请继续 /home/sroot/workspace/videoanalyze/videoanlast-worktrees/transient-retention-ai-notes
上的 videoanalyze 工作，分支是 codex/transient-retention-ai-notes。

先完整阅读：
docs/handoff/2026-08-25-video-link-analysis-handoff.md

不要修改或清理 /home/sroot/workspace/videoanalyze/videoanlast；它是另一个包含大量未提交内容的 worktree。
不要重新实现已经提交的 YouTube/B站链接解析。

先确认 git 状态和 Compose 健康，然后按交接文档第 0 节顺序：
1. 做 YouTube/B站各一次真实网页端到端验收；
2. 修复远程结果页的本地视频按钮和无效声音按钮；
3. 处理 Windows 本地 CA 导入失败；
4. 最后再讨论分支整合。

所有改动使用测试先行；完成声明前运行与风险匹配的验证。不要输出 .env 或任何密钥。
```

## 13. 参考文档

- `docs/project-summary.md`：项目和目录总览。
- `docs/operations.md`：部署、HTTPS、保留和备份说明。
- `docs/commands.md`：常用命令。
- `docs/handoff/2026-08-15-transient-retention-ai-notes-handoff.md`：保留、积分和 AI 笔记阶段的历史交接。
- `docs/superpowers/plans/2026-08-15-ai-notes-long-video-tiered-billing-implementation.md`：长视频、计费和 AI 笔记实施记录。

本文件是 2026-08-25 视频链接功能阶段的最新事实来源；若与 2026-08-15 交接文件的“待办状态”冲突，以本文件、Git 提交和当前测试结果为准。
