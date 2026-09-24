# 本地 HTTPS 与上传解析端到端设计

日期：2026-08-08

## 目标

让当前 WSL 开发环境中的 `https://localhost` 可正常使用，并验证从 HTTPS 页面上传 `/mnt/v/Vworkspace/videoanlast/test.mp4` 到 MinIO、排队、worker 下载、音频处理、Groq 转写直到数据库结果落库的真实后端链路。

## 当前根因

- 当前 Caddy 站点使用 `http://localhost`，因此只监听 HTTP；浏览器访问 `https://localhost` 时没有可用 TLS 服务。
- 当前上传公共地址使用 HTTP，HTTPS 页面下会产生协议/CORS 不一致。
- Caddy 的本地内部 CA 证书尚未安装到 WSL 或 Windows 的信任库。
- 现有单元测试覆盖了路由和 worker 组件，但没有覆盖真实 Compose 服务之间的上传与解析链路。

## 方案

### 本地 HTTPS

将默认 Caddyfile 改为本地专用配置：

- `http://localhost` 和 `http://storage.localhost` 永久重定向到 HTTPS。
- `https://localhost` 使用 `tls internal`，代理 API 和 web。
- `https://storage.localhost` 使用 `tls internal`，代理 MinIO。
- 保留一个独立的生产 Caddyfile；生产通过 `CADDYFILE=Caddyfile.production`、真实域名和 Caddy 自动申请的公共证书运行，不会使用本地 CA。

本地 Compose 默认值改为：

```env
CADDYFILE=Caddyfile
PUBLIC_HOST=https://localhost
STORAGE_HOST=https://storage.localhost
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://storage.localhost
MINIO_API_CORS_ALLOW_ORIGIN=https://localhost,http://localhost
```

API/worker 到 MinIO 的内部地址仍为 `http://minio:9000`，只有浏览器收到的预签名 URL 使用 HTTPS。

### 证书信任

添加 WSL 脚本：

1. 启动/重建 proxy，读取 Caddy 生成的 `/data/caddy/pki/authorities/local/root.crt`。
2. 安装到 WSL 的 `/usr/local/share/ca-certificates` 并运行 `update-ca-certificates`。
3. 如果存在 `powershell.exe` 和 `wslpath`，将同一根证书导入 Windows 当前用户的 `Trusted Root Certification Authorities`。
4. 将证书保存在 `.local/`，不提交到 Git。

这样 WSL/Linux 浏览器和 Windows Chrome/Edge 都能验证 `localhost` 与 `storage.localhost` 的证书；Firefox 等独立证书库仍可手动导入同一根证书。

### 端到端验收

添加可重复运行的本地验证脚本，默认使用 `/mnt/v/Vworkspace/videoanlast/test.mp4`，也支持 `VIDEO_PATH` 覆盖。脚本通过 HTTPS API 执行：

1. 使用 Mailpit 中的注册码注册一次性测试账号，或使用显式提供的 `E2E_EMAIL`/`E2E_PASSWORD` 登录。
2. 创建上传会话，断言预签名 URL 是 `https://storage.localhost` 且没有 CRC32 占位参数。
3. 通过 HTTPS 预签名 PUT 上传真实 MP4。
4. 创建分析任务并轮询状态，直到 `completed`、`failed` 或超时。
5. 使用 Compose PostgreSQL 查询确认分析运行完成、chunk 已完成且 transcript segment 已落库。
6. 输出不包含密码、Groq key 或完整预签名 URL。

脚本只使用当前测试账号的欢迎额度和短期 Mailpit 邮件；用户提供的视频不复制到镜像、不加入 Git。

## 验收标准

- `curl --cacert .local/videoanalyze-local-root.crt https://localhost` 返回 `200`。
- HTTPS 反向代理的 `/api/auth/me` 返回预期的未登录 `401`，证明 API 链路走的是 HTTPS 代理。
- HTTPS storage 预检返回 `204`，`Access-Control-Allow-Origin: https://localhost`。
- 上传返回 `2xx`，实际对象可由 worker 读取。
- 分析任务最终为 `completed`，worker 无未处理异常，数据库中至少存在一个 completed chunk 和 transcript segment 记录。
- 所有现有单元、类型、lint、构建、Compose 配置测试保持通过。

## 不在范围内

- 不把本地 CA 或私钥提交到 Git。
- 不用 `docker compose down -v`，不删除 PostgreSQL、Redis、MinIO 数据卷。
- 不把 `https://localhost` 当作公网用户地址；生产用户使用真实域名。
