# 个人 163 邮箱 SMTP 与 Docker 公网部署调研

实施状态：已按调研实施 SMTP 与独立生产 Compose；当前运行步骤和 Garage 自建存储方案以 [部署文档](docker-production.md) 为准。下文保留调研时的现状与设计快照。

调研日期：2026-10-29。基于当前仓库代码与服务商、库作者、Docker 的官方资料。本文件是实施设计；文中的新增配置、文件与命令还未接入现有代码，不能仅复制变量就认为已启用 SMTP。

## 结论

保留 Fastify + TypeScript 后端，在 API 容器内使用 **Nodemailer** 连接个人 163 邮箱 SMTP。开发环境保留 Mailpit。用户浏览器不接触 SMTP 凭据，也无需另建 SMTP 服务器容器。

GitHub Releases 与 npm registry 交叉核实，当前 Nodemailer 为 **10.3.0**。10.x 支持 Node.js 20+、ESM 和内置 TypeScript 类型，适配项目 API 的 Node.js 24；不需要额外安装 `@types/nodemailer`。实施时固定版本并更新 pnpm 锁文件。[官方说明](https://nodemailer.com/)、[10.3.0 发布记录](https://github.com/nodemailer/nodemailer/releases/tag/v10.3.0)

对比：

| 选择 | 与本项目的关系 | 建议 |
| --- | --- | --- |
| Nodemailer | SMTP、TLS、连接复用及诊断能力可以封装进现有 mailer 接口 | 首选 |
| emailjs（Node.js SMTP 库） | 同样能连接 SMTP，支持 TLS 与 TypeScript | 可行，但目前没有足以替代 Nodemailer 的项目需求 |
| 专属邮件服务 HTTP SDK | 依赖对应服务，不是直接连接个人 163 SMTP 的客户端 | 当前不采用 |

emailjs 指 `eleith/emailjs` 维护的 Node.js 库，不是前端发送邮件的浏览器服务。[emailjs 官方仓库](https://github.com/eleith/emailjs)

个人邮箱建议定位为小规模验证方案。这是基于项目规模与交付需求的工程判断，不是网易对验证码业务送达率的保证。本次未查得可核实、适用于所有个人 163 账号的固定每日发信额度，不应承诺“每天固定可发送多少封”。需要在真实服务器上以实际账号验证，并设置站点自己的发送预算。

## 当前项目需要改什么

| 位置 | 已确认的现状 | 实施方向 |
| --- | --- | --- |
| `apps/api/src/server.ts` | 三类邮件都内联调用 Mailpit HTTP API，发件人写为 `no-reply@videoanalyze.local` | 提取共享邮件内容和发送适配层；SMTP 使用真实的 163 发件地址 |
| `apps/api/src/config/env.ts` | 只读取 `MAIL_API_URL`，没有 SMTP 配置 | 新增传输模式、SMTP 参数及密码文件读取、校验 |
| `apps/api/src/auth/auth-service.ts` | 已注入 `sendRegistrationCode`、`sendVerification`、`sendPasswordReset` | 保持业务接口，替换实现即可 |
| `infra/docker-compose.yml` | API 使用 `env_file`，但又硬编码 `MAIL_API_URL` 为 Mailpit | 显式选择 SMTP 模式，并只给 API 挂载 SMTP 授权码 |
| `infra/reverse-proxy/Caddyfile.production` | 已支持公开应用域名和对象存储域名 | 公网部署选择此文件，设置 DNS、HTTPS 与公网回调地址 |

当前已有验证码 10 分钟有效、同邮箱 60 秒发送间隔、最多 5 次验证错误及哈希存储。公网部署还需补按可信客户端 IP、收件邮箱及全站预算的限制，不能只依赖同邮箱间隔。

## 163 账号与连接参数

| 参数 | 目标值 |
| --- | --- |
| SMTP 主机 | `smtp.163.com` |
| SMTP 端口 | `465` |
| 连接加密 | TLS 直连，Nodemailer 中为 `secure: true` |
| 登录用户名 | 完整个人邮箱地址，例如 `your-sender@163.com` |
| 登录凭据 | 邮箱客户端授权码，不是网页版登录密码 |
| 发件人地址 | 与该 163 账号保持一致，显示名称可使用产品名称 |

主机和端口由华为云与腾讯云官方接入文档交叉核对，均明确个人 163 邮箱的 SMTP 设置。[华为云参数表](https://support.huaweicloud.com/usermanual-astroflow/astroflow_05_0025.html)、[腾讯云接入说明](https://ioa.cloud.tencent.com/support/199262718652653568/)

账号准备路径：登录 163 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启包含 SMTP 的服务 → 按提示完成验证并生成客户端授权码。具体安全验证方式以账号页面为准。网易官方授权码帮助页本次无法直接读取，操作路径已用阿里云官方接入文档核对，该文档也链接到网易帮助页。[账号准备说明](https://help.aliyun.com/zh/model-studio/connector/netease-mail)

验证码场景只需要应用向用户发邮件；用户在自己的邮箱中接收并填写验证码。项目不必通过 IMAP/POP3 登录邮箱去读取验证码。如果之后确实要让应用读取客服回复、退信，再单独设计收信模块。

当前开发网络已实际完成到 `smtp.163.com:465` 的 TLS 握手，证书校验通过，协商为 TLS 1.3。这个检查未登录邮箱、未发送邮件，不能代表未来公网服务器的连通性、账号认证或真实送达。

## 推荐实现

建议新增：

```text
apps/api/src/mail/
  mailer.ts            # 沿用 AuthService 的业务方法
  mailpit-mailer.ts    # 保留现有 HTTP 开发适配
  smtp-mailer.ts       # Nodemailer 适配
  templates.ts         # 三类邮件的公共主题与正文
  smtp-mailer.test.ts
```

依赖安装目标：

```bash
corepack pnpm --filter @videoanalyze/api add --save-exact nodemailer@10.3.0
```

启动时创建并复用一个 transporter，不按每封邮件重复初始化。建议先保持当前“接口等待 SMTP 接收结果”的流程，给连接和发送设置超时。代码轮廓如下，变量必须先通过配置校验：

```ts
const transport = nodemailer.createTransport({
  host: smtpHost,
  port: 465,
  secure: true,
  auth: { user: smtpUser, pass: smtpAuthorizationCode },
  pool: true,
  maxConnections: 1,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
  disableFileAccess: true,
  disableUrlAccess: true
});
```

这些连接数和超时是项目的保守起始配置，不是网易额度。保持证书验证开启。API 优雅退出时关闭 transporter。[SMTP 配置](https://nodemailer.com/smtp)、[连接复用](https://nodemailer.com/smtp/pooled)

邮件发件人使用服务端固定配置的 `{ name, address }`，收件人使用项目现有邮箱校验后的地址，正文不接收任意附件或远程资源。不要继续使用 `.local` 发件地址，也不要冒用自己网站域名作为 163 账号的发件地址。域名邮箱的认证需要对应服务商支持，不能通过在自己网站的 DNS 中配置记录来控制 `163.com`。

需要同时处理的业务细节：

- 当前先保存验证码，再调用发送。发送明确失败时需记录失败并允许受控重发，避免提示成功、实际上未发送；不能为了重发绕过限流。
- 注册验证码、验证链接、找回密码共用同一适配器。重置链接继续使用可信的 `VERIFICATION_BASE_URL`，不能从客户端或任意 Host 请求头拼接。
- 认证失败不自动反复重试；连接临时故障仅允许有界重试。重试使用同一有效期内的验证码，避免每次重试生成新码。
- SMTP 接收成功不等于已进用户收件箱。前端采用“已发送，请检查收件箱及垃圾邮件”一类表述，不承诺送达。
- 日志只保留脱敏错误类型和必要追踪信息，不记录授权码、验证码、邮件正文和重置链接；关闭 SMTP 调试日志。
- 若之后引入 BullMQ 邮件队列，应独立于长视频任务，并检查任务中验证码的过期时间、敏感载荷保护和重复投递，而不是直接复用视频队列。

## Docker 目标配置

以下新增 SMTP 变量需要由适配层实现后才生效：

```dotenv
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sender@163.com
MAIL_FROM_ADDRESS=your-sender@163.com
MAIL_FROM_NAME=十一视频笔记
SMTP_PASSWORD_FILE=/run/secrets/smtp_password

NODE_ENV=production
CADDYFILE=Caddyfile.production
PUBLIC_HOST=https://app.example.com
STORAGE_HOST=https://media.example.com
S3_PUBLIC_ENDPOINT=https://media.example.com
VERIFICATION_BASE_URL=https://app.example.com
MINIO_API_CORS_ALLOW_ORIGIN=https://app.example.com
```

`SMTP_SECURE` 必须按字符串值解析，不使用 `Boolean("false")`。授权码建议放在服务器仓库外的文件，只通过 Compose secret 授予 API：

```yaml
services:
  api:
    environment:
      MAIL_TRANSPORT: smtp
      SMTP_HOST: smtp.163.com
      SMTP_PORT: "465"
      SMTP_SECURE: "true"
      SMTP_USER: ${SMTP_USER:?set SMTP_USER}
      MAIL_FROM_ADDRESS: ${SMTP_USER:?set SMTP_USER}
      MAIL_FROM_NAME: 十一视频笔记
      SMTP_PASSWORD_FILE: /run/secrets/smtp_password
    secrets:
      - smtp_password

secrets:
  smtp_password:
    file: ${SMTP_PASSWORD_FILE_ON_HOST:?set absolute host secret file path}
```

这是局部示意，不是可直接取代整个 Compose 文件的完整部署文件。`SMTP_PASSWORD_FILE` 是本项目拟实现的文件读取约定，不是 Docker 自动把文件内容变为密码；普通 Compose secret 是文件挂载，不等于加密托管。授权码文件必须让 API 容器的非 root `node` 用户可读，不能假设文件型 secret 的 `uid/gid/mode` 会自动改写宿主机文件权限。[Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/)、[服务 secrets 参数](https://docs.docker.com/reference/compose-file/services/#secrets)

只需允许 API 容器向外连接 `smtp.163.com:465`，不需要把服务器的 465/25 端口发布到公网。某些云厂商限制出站 25，例如阿里云建议第三方 SMTP 使用 465；具体仍需验证所选服务器的出站规则。[阿里云说明](https://help.aliyun.com/zh/document_detail/56130.html)

## 当前 Compose 的公网部署改动

1. 将 Mailpit 设为开发配置，生产不启动它，不暴露 8025。
2. 删除 PostgreSQL 5433、API 3000、MinIO 9000/9001 的不必要公网映射，或仅绑定回环地址；数据库与存储服务通过容器网络互通，用户上传经存储域名的 HTTPS 代理。
3. 替换当前硬编码的数据库默认密码，同时统一更新 migrate、api、worker、backup 的连接配置；不能只改 PostgreSQL 容器密码而保留旧连接串。
4. 配置真实应用和存储域名，选择已有 `Caddyfile.production`，校对公开 URL 与对象存储 CORS，保持 Caddy 证书数据卷持久化。
5. 在公网入口、真实客户端 IP 识别及 Redis 中实现邮件相关限流。当前 API 不能直接暴露后再无条件信任客户端转发 IP 头。

Docker 发布端口默认会对外部开放；Caddy 的自动 HTTPS 要求正确 DNS、外部可达的 80/443 及持久化可写数据目录。[端口发布说明](https://docs.docker.com/engine/network/port-publishing/)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)

## 验收顺序

1. 单测：传输模式、465/TLS 配置、密码文件缺失、收发件地址、三类邮件内容及错误脱敏。
2. 本地回归：保留 Mailpit 测试注册和密码重置；新增 SMTP 适配的替身测试，不向用户发送邮件。
3. 在目标服务器的 API 容器中执行连接与认证预检；`transporter.verify()` 本身不发送邮件，也不证明收件人最终收到。[预检能力边界](https://nodemailer.com/smtp#verifying-the-configuration)
4. 经明确指定测试收件人后，发送真实测试邮件，检查收件箱、垃圾邮件、发件人显示及回复地址；再验证注册验证码和找回密码的完整页面流程。
5. 重启容器验证 secret、配置、持久化与实际域名仍有效，确认公开端口仅为预期入口。

此次只完成调研与实施设计，未安装邮件依赖、修改发送逻辑、存储真实授权码或发送真实邮件。尚缺服务器厂商和地区、域名、预期发送量及目标服务器网络验证。聊天中出现过的真实授权码应在正式部署前更换，新授权码仅写入服务器密钥文件。
