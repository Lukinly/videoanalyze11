# Docker / SMTP 实施与验收记录（2026-10-29）

已完成 SMTP 与独立生产 Compose 实施。本机 Docker（Linux ARM64 容器）完成镜像构建及端到端验收。21:28（北京时间）另在 Docker 内通过真实 163 SMTP 认证，向用户指定的 163 邮箱发送 1 封注册验证码邮件，网易服务器已接受投递，用户已确认收件箱收到。当前未连接公网服务器。

## 已验证

- `pnpm typecheck`、`pnpm lint`、应用构建通过。
- 自动化测试 431 通过；2 个需要单独 PostgreSQL 测试连接的用例未启用。
- 浏览器回归 12 通过，2 个需要额外真实运行环境的用例未启用。
- API、Worker、Web、Garage 四个镜像构建成功。
- 当前生产 Caddy 配置通过解析检查；没有使用测试域名申请公网证书。
- Docker 内真实 PostgreSQL 完成迁移，Garage 完成私有桶及 CORS 初始化。
- 本地 TLS SMTP 模拟服务完成账号认证、验证码投递、验证码错误与复用拒绝、注册、登录及 Secure/HttpOnly Cookie 检查。
- 完成密码重置邮件、重置令牌单次使用、旧密码失效和新密码登录。
- 通过公网入口形态的 HTTPS 代理完成预签名上传、浏览器 CORS 预检及 Range 部分读取；匿名直接访问对象被拒绝。
- Worker 使用 FFmpeg 生成并处理真实三秒 MP4；ASR 与 LLM 使用 Docker 内的模拟 HTTPS 服务，完成转写、摘要、章节、笔记和 JPEG 时间帧截图。
- Redis 共享每日邮件预算触发后不再投递，未发送的验证码在数据库中失效。
- 伪造 `X-Forwarded-For` 不能改变代理后的认证 IP 计数；跨站邮件请求被拒绝。
- Redis 停止后，相关认证请求返回 503。
- 配置检查确认只有代理映射主机端口，Worker 不挂载 SMTP 密钥。
- 镜像用户确认：API / Worker 为 `node`，Garage 为 `1000:1000`。
- 验收后测试容器、测试卷和临时凭据均已清理，未操作生产数据。

## 真实 SMTP 补充验证

使用与生产相同的邮件适配器，通过 `smtp.163.com:465` 完成 TLS 和账号认证，再发送一封注册验证码。凭据通过进程标准输入临时提供，不写入环境文件、镜像或应用日志。测试容器自动删除。SMTP 接受投递后，用户已确认收件箱收到该邮件，真实发送与接收验证通过。此项不代替未来目标服务器网络环境中的验证。

## 运行方式与记录

完整可重复验收：

```bash
node scripts/verify-docker-deployment.mjs
```

构建及运行详细日志位于本地忽略目录 `.local/`：`docker-final-smoke.log`、`docker-smoke-build.log`、`docker-smoke-start.log`、`docker-smoke-services.log`。这些测试只使用合成凭据，不向外发送邮件或请求付费 AI 服务。

## 正式上线仍需配置

按 [生产部署文档](docker-production.md) 填写真实应用/媒体域名、发件邮箱和模型配置，在服务器密钥文件中保存新 163 授权码及 AI 密钥。完成 DNS、HTTPS、目标服务器出站 465 连通性和 SMTP 认证预检后，通过自己控制的邮箱验证真实收件箱/垃圾邮件投递。

单机 Garage 没有跨服务器副本，备份和恢复按部署文档执行。旧 MinIO 的数据库或对象不会自动导入新生产卷。
