# Docker 公网部署：163 SMTP 与自建视频存储

当前生产入口是 `infra/docker-compose.production.yml`，与本机开发配置分开。它启动 PostgreSQL、Redis、Garage 私有存储、API、视频 Worker、Web 和 Caddy，以及完成后退出的迁移与存储初始化任务。Mailpit 不参与生产。

API、Worker 和 Garage 使用非 root 用户；API/Worker 去掉 Linux capabilities、限制进程数，日志按大小轮转。生产只映射 Caddy 的 80/443，数据库、Redis、S3 内部接口与存储 RPC 不映射主机端口。SMTP 是连接网易的客户端，无需开放服务器的 25/465 入站端口。

## 1. 准备域名与服务器

安装 Docker Engine 与 Compose v2+。将应用域名（如 `app.example.com`）和媒体域名（如 `media.example.com`）的 DNS 指向服务器，安全组开放 TCP 80/443；SSH 只允许可信来源。Caddy 自动申请并续期公开证书，保留其数据卷。

该配置是单服务器方案，Garage 副本数为 1，不能抵御服务器或磁盘整体损坏。上线前应安排异地备份；同机数据卷不能替代备份。视频存储预算默认 40 GB，需根据实际可用磁盘调整 `TEMP_MEDIA_CAPACITY_BYTES`，并为数据库、Redis、镜像和处理中间文件另留空间。

在仓库根目录操作：

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`：

- `PUBLIC_HOST`：真实应用 HTTPS origin，不带路径或结尾斜杠。
- `STORAGE_HOST`：真实媒体 HTTPS origin，不带路径。
- `SMTP_USER`：完整个人 163 邮箱地址；发件人自动与其一致。
- `LLM_API_BASE_URL`、`LLM_API_MODEL`、`LLM_API_PROTOCOL`：已有模型服务配置。
- 根据邮箱实际运行情况调整站点自己的 `MAIL_DAILY_LIMIT`，默认 100 次尝试/UTC 日；这不是网易承诺额度。单邮箱每天默认 10 次，认证接口每 IP 每分钟默认 20 次。

`NODE_ENV=production` 和正式 SMTP 模式在 Compose 中明确固定。应用不读取整个宿主机 `.env`，只接收 Compose 中列出的配置。

## 2. 初始化密钥文件

宿主机已有 Node.js 24 时：

```bash
node scripts/init-production-secrets.mjs
```

仅安装 Docker 的服务器也可以使用临时容器：

```bash
docker run --rm -u "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" -w /workspace \
  node:24-bookworm-slim node scripts/init-production-secrets.mjs
```

脚本在 `.local/production-secrets/` 生成随机数据库密码、存储访问密钥和 RPC 密钥，不覆盖已有文件。用服务器上的编辑器分别填写以下文件：

| 文件 | 内容 | 授予的服务 |
| --- | --- | --- |
| `smtp_password` | 163 客户端授权码，不是网页版登录密码 | API |
| `groq_api_key` | Groq ASR API key | Worker |
| `llm_api_key` | 摘要、笔记服务 API key | Worker |

其余生成的文件由相应数据库、存储和业务服务使用。不要把凭据粘贴进 shell 命令、Dockerfile、Compose 或 Git。聊天中出现过的授权码应先在 163 后台撤销并重新生成。

Linux 上应用与存储 UID 为 **1000**，需让其能读取挂载文件。若生成文件的宿主机用户 UID 不是 1000：

```bash
sudo chown -R 1000:1000 .local/production-secrets
sudo chmod 700 .local/production-secrets
sudo find .local/production-secrets -type f -exec chmod 600 {} \;
```

若使用 rootless Docker 或 user namespace remapping，应按实际容器 UID 映射设置文件所有者，不要改成全局可读。普通 Compose secrets 是文件挂载，不是自动加密的秘密管理服务。

`SECRETS_DIR` 按 Compose 文件所在的 `infra/` 目录解析。默认 `../.local/production-secrets` 正确指向仓库内的私有目录；也可改成服务器仓库外的绝对路径。自定义目录时，也将同一宿主机绝对路径作为初始化脚本的参数。

## 3. 构建、启动与邮件预检

为减少命令重复，可在当前终端定义：

```bash
dc() { docker compose --env-file .env.production -f infra/docker-compose.production.yml "$@"; }
dc config --quiet
dc up -d --build --wait --wait-timeout 180
dc ps
dc exec api node dist/cli/mail-verify.js
```

首次构建会下载 Node、Python 和媒体依赖。API 镜像不再安装仅 Worker 使用的 FFmpeg；数据库迁移、存储初始化和 API 复用同一镜像。镜像中不包含真实密钥或开发依赖。

API 与 Worker 的 APT 默认使用清华 `mirrors.tuna.tsinghua.edu.cn`，pip 默认使用 `https://pypi.tuna.tsinghua.edu.cn/simple`，直接执行上述启动命令即可，无需重复传换源参数。APT 保留 Debian 签名校验，pip 保留 HTTPS 证书校验。清华安全更新镜像可能存在同步延迟。pip 源仅在 Python 安装阶段配置，调整它不会使之前的 Node 依赖安装和 APT 步骤缓存失效。

清华的 Docker CE 软件源提供 Docker 安装包，不是 Docker Hub 镜像加速器；基础镜像拉取由服务器的 Docker 镜像加速配置负责。npm 保留原有配置（Worker 使用 `registry.npmmirror.com`）。参见[清华 Debian 帮助](https://mirrors.tuna.tsinghua.edu.cn/help/debian/)、[清华 PyPI 帮助](https://mirrors.tuna.tsinghua.edu.cn/help/pypi/)和[清华 Docker CE 帮助](https://mirrors.tuna.tsinghua.edu.cn/help/docker-ce/)。

如果部署地区不适合清华源，可按需覆盖构建参数，例如切回上游：

```bash
dc build --build-arg APT_MIRROR=deb.debian.org \
  --build-arg PIP_INDEX_URL=https://pypi.org/simple api worker
dc up -d --no-build --wait --wait-timeout 180
```

`APT_MIRROR` 只填主机名，`PIP_INDEX_URL` 填完整 HTTPS 地址；Worker 还支持 `NPM_REGISTRY` 构建参数。用自定义源构建后使用 `--no-build` 启动，避免再次按默认源构建。

邮件预检验证 DNS、TCP、TLS 和账号认证，不发邮件，也不证明最终收件箱送达。此后访问正式网页，用自己控制的收件邮箱走一次获取验证码、注册、登录、找回密码流程，检查收件箱与垃圾邮件。

邮件发送使用 `smtp.163.com:465` 和证书校验，单连接复用，限制等待发送数量及网络超时。失败只记录脱敏类别，前端获得通用错误；本次验证码或重置令牌会失效，60 秒重发间隔仍保留。SMTP 已接收但应答丢失时，不能保证“恰好发送一次”。

Garage 在私有 tmpfs 中保存权限为 0600 的 RPC 密钥副本，兼容只读 Docker secret 挂载，同时保持非 root 运行。

认证限流使用现有 Redis，多个 API 实例共享预算，不另起邮件队列。Redis 不可用时相关认证请求返回 503，避免限流失效后继续发信。生产 API 只信任直接反向代理这一跳的客户端地址；不要把 API 3000 端口单独暴露出去。

## 4. 管理员与日常操作

创建尚未注册过的管理员邮箱，按终端提示输入密码：

```bash
dc exec api node dist/cli/admin-create.js --email admin@example.com
```

检查和更新：

```bash
dc logs --tail 100 api worker storage-init migrate
# 修改授权码文件后，重建 API 容器以重新读取文件和连接池配置。
dc up -d --force-recreate api
# 获取基础服务补丁，重新构建应用；先备份，再执行迁移升级。
dc pull postgres redis proxy
dc build --pull api worker web storage
dc up -d --wait
# 停止服务，保留数据。
dc down
```

不要对真实部署执行 `down --volumes` 或 `down -v`。已有数据库卷不会因为编辑密码文件而自动更改数据库密码，需要协调数据库角色密码和业务容器配置。Garage 默认访问密钥同样不能仅通过替换文件完成安全轮换；存量数据先备份，再通过 Garage 管理流程增加/切换访问密钥。

现有 MinIO 数据卷不会被生产配置读取或转换。若需要迁移历史视频，应在确认数据库对象键、用户归属和对象内容完整后，通过 S3 工具复制对象；不要把 MinIO 数据目录直接挂载为 Garage 数据目录。

## 5. 备份与恢复边界

至少备份数据库、Garage 数据及元数据、配置和密钥；备份密钥另行保存。数据库可用 `pg_dump` 获取一致性快照，媒体可通过 S3 兼容备份工具复制到独立机器或对象存储。若直接备份 Garage 卷，应停止写入并一致地备份整个 `storage-data` 卷，不要只复制视频块而漏掉元数据。

备份包含用户信息与视频，需加密后传到异地，定期验证恢复。仓库已有 `scripts/backup-database.sh` 展示 `pg_dump | age` 的数据库加密备份流程；新的生产 Compose 不自动启动尚未配置独立存储的备份容器。

## 6. 不依赖真实邮箱或 AI 账号的 Docker 验收

开发机安装 Node.js 24 和 Docker 后运行：

```bash
node scripts/verify-docker-deployment.mjs
# 镜像已按当前代码构建时，可跳过构建：
node scripts/verify-docker-deployment.mjs --no-build
```

测试启动独立 `videoanalyze-smoke` 项目，使用随机宿主机回环端口、临时数据卷、测试证书和合成凭据。SMTP 及 AI 服务均为测试容器内的模拟服务，不对外投递邮件或请求付费 AI 服务。覆盖首页、验证码注册和复用拒绝、登录安全 Cookie、找回密码、私有媒体上传、CORS、Range 播放、Worker 处理及截图、全站发信预算和 Redis 故障保护。

结束时仅删除测试项目及其临时数据，不操作生产卷。详细构建/启动日志保存在 `.local/`，不要将测试 Compose 覆盖文件用于公网部署。

## 依赖说明

新生产存储采用 Garage v2.5.0，其 S3 API 与应用现有 SDK 对接。原 MinIO 社区仓库已标记不再维护，原镜像在此次拉取检查中返回不存在/无权限错误，因此不继续作为新公网部署的默认依赖。[MinIO 官方仓库](https://github.com/minio/minio)、[Garage 官方部署文档](https://github.com/deuxfleurs-org/garage/blob/main-v2/doc/book/cookbook/real-world.md)

旧 `infra/docker-compose.yml` 保留历史本地配置，不应用于新公网部署；本机日常开发使用 [本地运行文档](local-development.md)。
