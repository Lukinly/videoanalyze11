# 注册邮箱验证码设计

## 目标

将注册验证从“注册后发送验证链接”调整为“注册页获取并输入邮箱验证码”。验证码校验成功后，服务端直接创建已验证账号，用户无需再点击验证链接即可返回登录。

## 范围

本次调整覆盖 Web 注册页面、认证 API、认证服务、验证码持久化、邮件发送和相关测试。

登录仍使用邮箱和密码；不新增登录验证码。现有邮箱验证链接接口保留，用于兼容改动前已经发送的验证邮件，但新注册流程不再发送链接。

## 用户流程

1. 用户在注册页输入邮箱。
2. 用户点击“获取验证码”。
3. API 生成 6 位数字验证码，保存验证码哈希和过期时间，并通过邮件发送明文验证码。
4. 用户输入验证码、密码和确认密码。
5. 用户提交注册。
6. API 校验邮箱、验证码和密码；校验成功后创建已验证用户，写入 `email_verified_at`，并发放一次注册欢迎积分。
7. 注册页显示注册成功，用户返回登录页。

验证码规则：

- 有效期 10 分钟；
- 单个邮箱每 60 秒最多发送一次；
- 同一邮箱获取新验证码后，旧验证码失效；
- 验证码只能成功使用一次；
- 连续错误达到 5 次后当前验证码失效；
- 数据库只保存验证码哈希，不保存明文；
- API 响应不返回验证码。

之前已经创建但尚未验证的旧用户，可以通过新验证码完成邮箱验证；已经验证的用户不能重复注册。

## 前端设计

修改 `apps/web/src/auth/RegisterPage.tsx`：

- 增加验证码状态、发送状态、剩余倒计时和验证码错误提示；
- 邮箱输入框旁增加“获取验证码”按钮；
- 验证码输入使用 `inputMode="numeric"`、`maxLength={6}` 和 `autoComplete="one-time-code"`；
- 发送验证码时校验邮箱格式，发送期间按钮禁用；成功后开始 60 秒倒计时；
- 注册提交时必须包含验证码；
- 注册成功提示改为“注册成功，请返回登录”，不再提示验证邮件链接。

修改 `apps/web/src/api/client.ts`：

- 增加 `sendRegistrationCode({ email })`；
- 将 `register` 请求类型扩展为包含 `verificationCode`；
- 保留 `verifyEmail` 客户端方法以支持旧验证链接。

## API 设计

新增接口：

```text
POST /api/auth/registration-code
```

请求：

```json
{
  "email": "user@example.com"
}
```

成功响应：

```json
{
  "sent": true,
  "expiresInSeconds": 600
}
```

注册接口调整为：

```text
POST /api/auth/register
```

请求：

```json
{
  "email": "user@example.com",
  "password": "correct horse battery staple",
  "confirmPassword": "correct horse battery staple",
  "verificationCode": "123456"
}
```

成功响应：

```json
{
  "userId": "user_1",
  "verified": true
}
```

认证服务职责：

- `sendRegistrationCode` 规范化邮箱、检查已验证账号、执行发送频率限制、生成验证码并调用邮件服务；
- `register` 在密码校验后校验验证码；
- 新邮箱验证码通过后创建已验证用户；
- 已存在但未验证的旧用户校验其密码后标记邮箱已验证；
- 通过幂等欢迎积分记录确保每个用户只获得一次注册积分。

新增领域错误码：

- `INVALID_REGISTRATION_CODE`：验证码错误、过期或已使用；
- `REGISTRATION_CODE_RATE_LIMITED`：验证码发送过于频繁；
- `REGISTRATION_CODE_EXHAUSTED`：验证码错误次数超过上限。

## 数据持久化

新增 `registration_verifications` 表：

```text
id           TEXT PRIMARY KEY
email        TEXT UNIQUE NOT NULL
code_hash    TEXT NOT NULL
expires_at   TIMESTAMPTZ NOT NULL
used_at      TIMESTAMPTZ
attempts     INTEGER NOT NULL DEFAULT 0
created_at   TIMESTAMPTZ NOT NULL
```

新增迁移文件，不修改已经应用过的迁移。邮箱作为唯一键，发送新验证码时更新同一邮箱的验证码记录。

认证仓储提供：

- 创建或替换邮箱验证码；
- 按邮箱读取未使用验证码；
- 增加错误尝试次数并使验证码失效；
- 原子标记验证码已使用。

现有 `email_verifications` 表和验证链接相关代码暂时保留，不参与新注册流程。

## 邮件发送

邮件服务新增注册验证码发送能力，邮件正文包含验证码和 10 分钟有效期说明，不包含验证链接。现有旧验证邮件发送能力保留，避免影响兼容流程。

## 错误处理

- 邮箱格式不正确时，发送验证码和注册接口都返回 400；
- 已验证邮箱再次请求验证码返回 `EMAIL_ALREADY_REGISTERED`；
- 60 秒内重复请求返回 429，并且不发送邮件；
- 验证码不存在、错误、过期或已使用返回 `INVALID_REGISTRATION_CODE`；
- 错误次数达到 5 次后返回 `REGISTRATION_CODE_EXHAUSTED`，必须重新获取验证码；
- 密码确认不一致时不创建用户、不消耗验证码；
- 邮件发送失败时不返回验证码，保留可重试状态。

## 测试策略

### 认证服务测试

- 发送验证码时保存哈希而不是明文；
- 正确验证码可以创建已验证用户；
- 错误验证码不会创建用户；
- 验证码过期、重复使用和超过错误次数会失败；
- 60 秒内重复发送被拒绝；
- 新验证码使旧验证码失效；
- 旧的未验证用户可以通过验证码完成验证；
- 欢迎积分只发放一次。

### API 路由测试

- 验证验证码发送请求体并返回成功响应；
- 注册接口将验证码传递给认证服务；
- 不返回密码、验证码或会话令牌；
- 错误响应包含稳定的错误码。

### Web 测试

- 注册页展示验证码输入框和获取验证码按钮；
- 邮箱无效时不请求发送验证码；
- 获取验证码成功后按钮进入倒计时；
- 未填写验证码时不能完成注册；
- 注册请求包含验证码；
- 注册成功后显示返回登录提示。

### 验证命令

```text
corepack pnpm vitest run apps/api/src/auth apps/api/src/routes/auth.test.ts apps/web/src/auth
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

## 验收标准

- 注册页有“获取验证码”按钮和验证码输入框；
- 用户可以通过邮箱验证码完成注册；
- 验证成功后数据库中的用户 `email_verified_at` 不为空；
- 注册完成后用户可以直接登录；
- 新注册流程不依赖验证链接；
- 验证码不会以明文落库或出现在 API 响应中；
- 旧验证链接仍可处理已经发出的邮件；
- 相关测试、类型检查、Lint 和构建通过。
