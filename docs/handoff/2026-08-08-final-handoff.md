# videoanalyze 最终会话交接文档

更新时间：2026-08-08  
工作目录：`/mnt/v/Vworkspace/videoanlast`  
当前分支：`feature/v0-v1-web`

## 1. 当前目标

在部署到服务器前，先完成本地 Docker Compose、浏览器上传和 API/MinIO 链路验证；确认本地稳定后，再使用服务器 IP 测试，最后切换到 HTTPS 域名。

## 2. 已完成的主要功能

### 注册邮箱验证码

- `POST /api/auth/registration-code`
- `POST /api/auth/register`
- 验证码 10 分钟有效。
- 同一邮箱 60 秒内不能重复发送。
- 错误 5 次后当前验证码失效。
- 数据库只保存验证码哈希。
- 注册成功后账号直接处于已验证状态。
- 新用户获得 12 点欢迎额度。
- 本地邮件通过 Mailpit 查看：`http://localhost:8025`。

### 上传链路

API/worker 使用 Docker 内部地址：

```env
S3_ENDPOINT=http://minio:9000
```

浏览器使用独立的公共签名地址，不能返回 `minio`：

```env
S3_PUBLIC_ENDPOINT=https://storage.localhost
```

生产环境使用：

```env
S3_PUBLIC_ENDPOINT=https://storage.example.com
```

## 3. 上传问题的完整根因链

### 根因一：浏览器收到 Docker 内部主机名

原先 API 使用 `http://minio:9000` 生成预签名 URL，浏览器无法解析 Docker 服务名 `minio`。

处理方式：API 内部 client 与浏览器 presign client 分离，并增加 `S3_PUBLIC_ENDPOINT`。

### 根因二：本地 Caddy 自动把存储 HTTP 重定向到 HTTPS

本地请求曾返回：

```text
HTTP/1.1 308 Permanent Redirect
Location: https://storage.localhost/...
```

浏览器无法安全跟随跨域预检重定向，导致 `Upload network error`。

本地配置现在改为 Caddy 内部 CA 提供 HTTPS，避免浏览器页面与上传地址协议不一致：

```env
PUBLIC_HOST=https://localhost
STORAGE_HOST=https://storage.localhost
S3_PUBLIC_ENDPOINT=https://storage.localhost
```

本地 Caddyfile 同时把 HTTP 请求重定向到 HTTPS；WSL 和 Windows 浏览器需要信任 `.local/videoanalyze-local-root.crt`。

生产使用独立的 `Caddyfile.production`，域名不带协议，让 Caddy 自动申请公共 HTTPS 证书：

```env
CADDYFILE=Caddyfile.production
PUBLIC_HOST=example.com
STORAGE_HOST=storage.example.com
```

### 根因三：AWS SDK 自动生成了错误的占位 CRC32

较新的 AWS SDK 预签名 PUT URL 自动附带了：

```text
x-amz-sdk-checksum-algorithm=CRC32
x-amz-checksum-crc32=AAAAAA==
```

浏览器实际上传的视频没有对应校验值，MinIO 返回错误；错误响应缺少可用的 CORS 信息时，浏览器将其显示为 `CORS error`。

当前 `apps/api/src/storage/s3-client.ts` 使用：

```ts
requestChecksumCalculation: "WHEN_REQUIRED"
```

新的预签名 URL 不再包含上述占位 checksum 参数。

### 根因四：网站实际 Origin 可能是 HTTPS

即使手动使用：

```text
Origin: http://localhost
```

预检通过，浏览器页面如果已被 Caddy 重定向到 `https://localhost`，实际 Origin 就是 `https://localhost`。因此本地 MinIO CORS 现在同时允许：

```env
MINIO_API_CORS_ALLOW_ORIGIN=http://localhost,https://localhost
```

## 4. 最新代码和配置改动

主要文件：

- `apps/api/src/storage/s3-client.ts`
- `apps/api/src/storage/s3-client.test.ts`
- `apps/api/src/server.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/config/env.test.ts`
- `apps/api/src/storage/s3-storage.ts`
- `infra/docker-compose.yml`
- `infra/reverse-proxy/Caddyfile`
- `infra/reverse-proxy/Caddyfile.production`
- `.env.example`
- `docs/operations.md`
- `tests/acceptance/deployment-config.test.ts`
- `scripts/setup-local-https.sh`
- `scripts/verify-local-upload-analysis.mjs`
- `tests/acceptance/verify-local-upload-analysis.test.ts`

配置文件当前本地默认值应为：

```env
CADDYFILE=Caddyfile
PUBLIC_HOST=https://localhost
STORAGE_HOST=https://storage.localhost
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://storage.localhost
MINIO_API_CORS_ALLOW_ORIGIN=https://localhost,http://localhost
```

生产域名配置应为：

```env
CADDYFILE=Caddyfile.production
PUBLIC_HOST=example.com
STORAGE_HOST=storage.example.com
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://storage.example.com
MINIO_API_CORS_ALLOW_ORIGIN=https://example.com
```

## 5. 已完成的验证

代码验证结果：

```text
corepack pnpm test
52 个测试文件、128 个测试通过

corepack pnpm lint
通过

corepack pnpm typecheck
通过

corepack pnpm build
通过

corepack pnpm test:acceptance
通过

docker compose -f infra/docker-compose.yml config --quiet
通过

git diff --check
通过
```

API 运行时验证结果：

```text
GET http://localhost:3000/healthz
200 OK

GET http://localhost:3000/readyz
200 OK
database: ok
redis: ok
storage: ok

GET /api/auth/me（未登录）
401 Unauthorized，符合预期
```

Caddy/MinIO 本地 HTTP 预检曾验证通过：

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost
Access-Control-Allow-Methods: PUT
```

代码静态验证已通过；本地 HTTPS 容器、证书信任和真实 `test.mp4` worker 解析仍需在 Docker 宿主机执行最后验收。

## 6. 当前必须执行的最后步骤

修改 `.env` 后，重新创建 API、MinIO、Caddy 和 Worker。不要使用 `down -v`：

```bash
cd /mnt/v/Vworkspace/videoanlast

sudo docker compose -f infra/docker-compose.yml up -d --build --force-recreate api minio proxy worker

bash scripts/setup-local-https.sh
```

检查实际容器环境：

```bash
sudo docker compose -f infra/docker-compose.yml exec api printenv S3_PUBLIC_ENDPOINT
sudo docker compose -f infra/docker-compose.yml exec proxy printenv STORAGE_HOST
```

本地预期：

```text
https://storage.localhost
https://storage.localhost
```

验证 HTTPS Origin 预检：

```bash
curl --cacert .local/videoanalyze-local-root.crt -i -X OPTIONS https://storage.localhost/videoanalyze/test \
  -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
```

预期响应包含：

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://localhost
```

之后打开 `https://localhost`，确认浏览器不显示证书警告，再运行真实上传/解析验收：

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/videoanalyze-local-root.crt" corepack pnpm verify:local-upload-analysis
```

## 7. 浏览器上传验收标准

开发者工具 Network 中：

1. `POST /api/videos/upload-session` 返回 `201`。
2. 返回的 `uploadUrl` 协议是 `https`，主机名是 `storage.localhost`。
3. URL 不包含：

```text
x-amz-sdk-checksum-algorithm
x-amz-checksum-crc32
```

4. 预检返回 `204`。
5. 实际 PUT 返回 `200` 或 `204`，不能显示 `CORS error`。

如果仍失败，记录以下信息即可，不要分享完整签名 URL：

- 页面实际 Origin：应为 `https://localhost`
- PUT 请求主机名和端口
- PUT 状态码或浏览器错误类型
- API、MinIO、proxy 最近 100 行日志

日志命令：

```bash
sudo docker compose -f infra/docker-compose.yml logs --tail=100 api minio proxy
```

## 8. Analysis run 排队问题与 Groq 验证

### 参考 pipeline

已对照本机 `agent-reach` 的转写实现：

1. FFmpeg 提取并压缩为单声道、16 kHz、32 kbps 音频。
2. 按约 10 分钟切片，单片预留在 Groq 25 MiB 限制内。
3. 通过 `https://api.groq.com/openai/v1/audio/transcriptions` 以 multipart `file` 调用 Whisper。
4. `agent-reach` 默认使用 `whisper-large-v3`；本项目保留可配置的 `GROQ_ASR_MODEL`，默认 `whisper-large-v3-turbo`，并使用 `verbose_json` 获取时间片段。

对 `/mnt/v/Vworkspace/videoanlast/test.mp4` 的本地 FFmpeg 与项目格式 Groq 请求已验证：视频约 638.6 秒，项目生成的首个音频块约 22.2 MB，Groq 返回 HTTP 200 和 268 个时间片段。因此当前卡在“排队中”时，优先检查队列 Worker，而不是重复上传视频。

### 代码修复

- Worker 开始时先写入 `probing`，不会在下载/探测媒体期间一直显示 `queued`。
- 前端每秒读取 `/api/analysis-runs/:runId`，不再依赖只存在于 API 进程内的 SSE 内存事件。
- API 返回 `totalChunks` 和 `completedChunks`。
- `scripts/setup-local-https.sh` 已包含 `worker`，旧任务在 Worker 启动后会继续消费，不需要重新上传。

### 宿主机诊断命令

```bash
cd /mnt/v/Vworkspace/videoanlast
bash scripts/setup-local-https.sh
sudo docker compose -f infra/docker-compose.yml ps worker
sudo docker compose -f infra/docker-compose.yml logs --tail=150 worker
sudo docker compose -f infra/docker-compose.yml exec -T postgres psql -U videoanalyze -d videoanalyze \
  -c "SELECT id,status,stage,progress,error,updated_at FROM analysis_runs ORDER BY created_at DESC LIMIT 5;"
```

预期 Worker 处于 `running`。如果日志出现 `GROQ_API_KEY is required`，检查 `.env`；如果出现 Groq `401`，更换有效的 `gsk_...` key；如果仍是 `queued` 且 Worker 没有消费日志，说明 Worker 容器未运行或没有连接 Redis。不要粘贴 key、完整签名 URL 或转写正文。

## 9. Git 和安全注意事项

- 当前工作区有大量混合的未提交改动，属于用户已有工作，不能重置或批量清理。
- 当前环境 `.git` 只读，尚未创建提交。
- 不要把 `.env`、Groq key、完整预签名 URL 或日志中的敏感信息交接出去。
- 当前 `.env` 中存在 Groq key，正式部署前建议轮换。
- PostgreSQL、Redis、MinIO 使用命名卷；不要执行 `docker compose down -v`，否则会删除数据。
