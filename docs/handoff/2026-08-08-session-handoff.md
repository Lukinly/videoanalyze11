# videoanalyze 会话交接文档

更新时间：2026-08-08   
工作目录：`/mnt/v/Vworkspace/videoanlast`

## 1. 用户当前要解决的问题

本会话处理了两个问题：

1. 注册页面没有邮箱验证码，导致新注册账号无法完成邮箱验证，随后登录失败。
2. 登录后上传视频点击“上传并分析”时出现 `Upload network error`。

## 2. 已完成的功能

### 注册邮箱验证码

新注册流程现在是：

1. 在注册页输入邮箱。
2. 点击“获取验证码”。
3. 输入邮件中的 6 位数字验证码、密码和确认密码。
4. 提交注册。
5. 注册成功后账号直接写入已验证状态，返回登录即可登录，并获得 12 点欢迎额度。

后端接口：

- `POST /api/auth/registration-code`
- `POST /api/auth/register`

安全规则：

- 验证码有效期 10 分钟。
- 同一个邮箱 60 秒内不能重复发送。
- 错误 5 次后当前验证码失效。
- 数据库只保存验证码哈希，不保存明文。
- 旧的邮箱验证链接流程仍保留，用于兼容旧账号/旧邮件。

主要文件：

- `apps/web/src/auth/RegisterPage.tsx`
- `apps/web/src/api/client.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/auth/auth-service.ts`
- `apps/api/src/db/repositories/auth.ts`
- `apps/api/src/db/migrations/0003_registration_verifications.sql`
- `apps/api/src/db/schema.ts`

### 邮箱实际投递说明

当前 Docker 配置使用 Mailpit 作为测试邮件收件箱，不会把邮件投递到真实 QQ/Gmail 邮箱：

- Mailpit 页面：`http://localhost:8025`
- Docker 内部邮件地址：`http://mailpit:8025/api/v1/send`

如果需要真实邮箱投递，还需要接入真实邮件服务/SMTP，并调整 `MAIL_API_URL` 及邮件发送实现。

## 3. 上传错误的根因与修复

原问题：API 使用 Docker 内部地址 `http://minio:9000` 生成预签名 URL，并直接返回给浏览器。浏览器无法解析 Docker 内部主机名 `minio`，所以 XHR 触发了 `Upload network error`。

已实现修复：

- API 内部访问 MinIO 仍使用 `S3_ENDPOINT=http://minio:9000`。
- 新增 `S3_PUBLIC_ENDPOINT`，专门用于生成浏览器可访问的预签名 URL。
- `createS3ObjectStorage` 支持独立的 `presignClient`。
- Docker 本地默认浏览器地址为 `http://localhost:9000`。

主要文件：

- `apps/api/src/config/env.ts`
- `apps/api/src/server.ts`
- `apps/api/src/storage/s3-storage.ts`
- `apps/api/src/storage/object-storage.test.ts`
- `.env.example`
- `infra/docker-compose.yml`

## 4. 下一会话需要执行的实际验证

### 本机使用 Docker Compose

在项目根目录确认 `.env` 包含：

```env
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000
```

重新构建并启动：

```bash
cd /mnt/v/Vworkspace/videoanlast
sudo docker compose -f infra/docker-compose.yml up -d --build
sudo docker compose -f infra/docker-compose.yml ps
```

确认 MinIO：

```bash
curl http://localhost:9000/minio/health/live
```

然后登录网站，选择一个小的 MP4 文件，点击“上传并分析”。浏览器开发者工具 Network 中的上传 PUT 请求应该指向：

```text
http://localhost:9000/...
```

不能再指向：

```text
http://minio:9000/...
```

如果通过另一台电脑访问服务器，把 `S3_PUBLIC_ENDPOINT` 改成浏览器能够访问的服务器 IP 或域名，例如：

```env
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000
```

并确保服务器防火墙/反向代理允许访问 9000 端口。

### 上传仍失败时的检查顺序

1. Network 中检查 `POST /api/videos/upload-session` 是否返回 200。
2. 检查响应里的 `uploadUrl` 主机名。
3. 检查 `PUT` 请求是网络错误、CORS、403 还是其他 HTTP 状态。
4. 查看日志：

```bash
sudo docker compose -f infra/docker-compose.yml logs --tail=100 api
sudo docker compose -f infra/docker-compose.yml logs --tail=100 minio
```

当前会话所在环境没有 Docker socket 权限，因此没有完成真实容器和浏览器上传验证；只完成了代码、构建和配置语法验证。

## 5. 验证结果

最后一次代码验证结果：

- `corepack pnpm test`：48 个测试文件、113 个测试全部通过。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm lint`：通过。
- `corepack pnpm build`：通过。
- `git diff --check`：通过。
- `docker compose -f infra/docker-compose.yml config --quiet`：通过。

Vitest 的 `workspace file is deprecated` 只是警告，不是失败原因。

## 6. Git/工作区注意事项

当前工作区有大量已有的未提交修改，涉及额度、管理员、运行时依赖、上传和前端等功能。不要执行以下操作：

- `git reset --hard`
- `git checkout -- .`
- 批量删除未跟踪文件

本会话中已提交的相关提交：

- `8d297f6`：注册邮箱验证码设计文档
- `ff8599f`：注册邮箱验证码实施计划
- `baac518`：计划文档清理
- `988fb34`：验证码持久化迁移和数据库实现

注册认证、前端注册页、邮件发送、上传公开端点修复等其他改动仍与工作区中原有修改混合存在，尚未单独提交。下一会话如需提交，应先用 `git diff` 区分改动，避免覆盖用户已有工作。

## 7. 下一会话建议开场动作

新会话开始后先阅读本文件，然后：

1. 检查 `.env` 是否有 `S3_PUBLIC_ENDPOINT`。
2. 使用 Docker Compose 重新构建 API。
3. 实际完成一次小 MP4 上传。
4. 如果上传仍失败，提供浏览器 Network 中 `upload-session` 响应和 PUT 请求的错误状态，再继续处理 CORS、端口或 MinIO 配置。
