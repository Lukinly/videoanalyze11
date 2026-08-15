# Upload Public Endpoint and Domain Deployment Design

## Goal

让视频上传链路可以先在本地 Docker Compose 中完整验证，再在服务器上用 IP 验证，最后切换到 HTTPS 域名；切换阶段只修改环境变量和 DNS/Caddy 配置，不修改应用代码，并始终避免把 Docker 内部的 `minio` 地址返回给浏览器。

## Context and current state

- API 内部读写对象存储使用 `S3_ENDPOINT=http://minio:9000`。
- API 生成浏览器上传和播放签名 URL 时使用独立的 `S3_PUBLIC_ENDPOINT`。
- 本地和服务器 IP 阶段可以使用 HTTP；正式域名阶段必须使用 HTTPS，避免从 HTTPS 网页向 HTTP MinIO 发起混合内容请求。
- Caddy 当前代理网站和 API，但需要显式接收 `PUBLIC_HOST`；生产域名不能依赖容器内默认值。
- 浏览器到对象存储是跨源请求，因此上传链路必须验证 CORS，而不能只验证 API 的 `upload-session` 响应。

## Chosen architecture

### 1. Two endpoints with one storage service

应用保留两个明确的对象存储入口：

- `S3_ENDPOINT`：只供 API 和 worker 使用，默认 Docker 内部地址 `http://minio:9000`。
- `S3_PUBLIC_ENDPOINT`：只用于生成返回浏览器的签名 URL，由部署环境提供。

API、worker 和数据库不会使用公共存储域名。浏览器不会看到 `minio`、Docker 服务名或内部端口。

### 2. Staged public endpoint

每个阶段的配置如下：

| 阶段 | 网站地址 | `S3_PUBLIC_ENDPOINT` | 存储入口 |
| --- | --- | --- | --- |
| 本地 | `http://localhost` | `http://storage.localhost` | Caddy 代理到 MinIO |
| 服务器 IP 验证 | `http://SERVER_IP` | `http://SERVER_IP:9000` | 临时直连 MinIO |
| 正式域名 | `https://example.com` | `https://storage.example.com` | Caddy HTTPS 代理到 MinIO |

正式域名阶段使用同一主域名下的 `storage` 子域名。这样只需要为 `storage.example.com` 增加一条指向同一服务器的 DNS 记录，不需要把 MinIO 的 9000 端口暴露给公网，也不会产生 HTTPS 页面访问 HTTP 上传端点的混合内容问题。

Caddy 的存储反向代理必须保留浏览器请求中的 `Host`，因为该主机名参与 S3 签名校验。代理不能改写对象路径，也不能把公共端点配置成带路径前缀的 URL。

### 3. Caddy and environment wiring

- Compose 将 `PUBLIC_HOST` 和 `STORAGE_HOST` 显式传递给 proxy 容器。
- Caddy 使用 `PUBLIC_HOST` 处理网站/API，使用 `STORAGE_HOST` 处理 MinIO。
- 默认值只服务于本地开发；生产文档要求显式配置公开网站地址、存储地址和生产密钥。
- 服务器 IP 验证阶段可以暂时跳过存储子域名，使用 `SERVER_IP:9000`；绑定域名后切换到 HTTPS 存储子域名。

### 4. Browser upload behavior

浏览器仍然先调用同源的 `POST /api/videos/upload-session`，再对返回的签名 URL 发起 PUT。应用不把视频内容中转到 API。

对象存储端必须允许网站源对签名 PUT/GET 请求进行 CORS。配置应覆盖本地 `http://localhost`、服务器 IP 测试源和正式 HTTPS 网站源，并允许必要的 `PUT`、`GET`、`HEAD`、`OPTIONS` 方法及 `Content-Type`、`x-amz-*` 等请求头。验收测试至少要覆盖预检/上传响应中的 CORS 行为。

## Error handling and safety

- 缺少或错误的公共端点时，API 仍可启动，但浏览器验收必须在部署检查中明确失败并打印实际 `uploadUrl` 主机名，不能把 `minio` 当作可用地址。
- 生产环境的 `S3_PUBLIC_ENDPOINT`、网站域名和 CORS 源必须由 `.env`/Compose 配置提供，不能写死生产域名。
- 签名 URL 不记录到日志；部署文档只记录主机名和 HTTP 状态，不记录完整签名查询参数。
- 保留现有数据库、Redis、MinIO 命名卷，不使用会删除数据的 `down -v` 作为测试步骤。

## Verification plan

### Static and unit verification

继续执行现有验证集合：

- `corepack pnpm test`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm build`
- `corepack pnpm test:acceptance`
- `git diff --check`
- `docker compose -f infra/docker-compose.yml config --quiet`

新增或调整验证以覆盖：

- API 使用内部 client，签名使用公共 client。
- Caddy 取得 `PUBLIC_HOST`/`STORAGE_HOST`。
- Compose 默认本地端点和生产显式端点的配置关系。
- CORS 配置与网站源一致。

### Local integration verification

在本机 Docker Compose 中重建并启动完整服务，检查：

1. `GET /healthz` 和 `GET /readyz`。
2. 注册验证码可在 Mailpit 中收到。
3. 注册、登录、欢迎额度和上传会话。
4. 签名上传 URL 使用 `storage.localhost`，而不是 `minio`。
5. 小型 MP4 从浏览器完成 PUT 上传。
6. API/worker 能读取对象并完成现有分析流程；若外部 Groq 服务不可用，则至少完成上传和队列链路验收，并记录外部依赖限制。

### Server handoff verification

服务器 IP 阶段使用 HTTP 和 `SERVER_IP:9000` 完成一次小文件上传；域名阶段设置网站域名、存储子域名和 HTTPS 后重新执行同一验收。两阶段都只改配置，不改应用代码。

## Non-goals

- 本次不更换 MinIO、PostgreSQL、Redis 或 Groq provider。
- 本次不把上传改成 API 中转。
- 本次不引入购买域名、DNS 服务或云托管对象存储。
- 本次不清理工作区中与该链路无关的未提交改动。

