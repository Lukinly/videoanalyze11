# 积分计费与管理员后台设计

## 目标

将当前“每个用户固定两次试用”升级为可审计的预付费积分系统：新用户完成邮箱验证后获得 12 积分，视频解析按视频大小扣费，用户通过人工充值申请获得积分，管理员可以管理用户、积分和账号状态。

本设计不接入真实支付平台。第一阶段的充值由用户提交申请、管理员审核并手动入账。

## 现有约束

- API 使用 PostgreSQL 保存用户、视频、分析任务和当前 `usage_ledger`。
- 视频的 `file_size` 已保存在 PostgreSQL 的 `videos` 表中。
- 分析任务通过 API 创建并投递到 Redis/BullMQ，由独立 worker 执行。
- 当前已有邮箱验证后发放两次试用额度的逻辑。
- 当前没有角色、账号状态、管理员后台或支付系统。
- 注册表单还需要包含此前确认的双密码校验；确认密码不保存到数据库。

## 范围

### 包含

- 按视频大小计算积分费用；
- 追加式积分账本和分析预留；
- 邮箱验证后的 12 积分初始赠送；
- 用户余额、流水和人工充值申请；
- 管理员账户创建、后台用户管理、积分调整和审计日志；
- 角色、账号状态和强制密码重置；
- 失败任务退款和重复请求幂等；
- 既有数据库的数据迁移。

### 不包含

- 微信支付、支付宝、Stripe 等真实支付接入；
- 自动退款、发票和税务处理；
- 多币种或多种积分类型；
- 删除用户及其历史账单数据。

## 积分规则

### 初始积分

用户完成邮箱验证后一次性获得 12 积分。注册但未验证邮箱的用户不获得积分。

使用唯一业务键 `welcome:{userId}` 写入初始赠送，重复点击验证链接不会重复发放。

### 解析费用

使用数据库中 `videos.file_size` 的实际文件大小，不信任分析请求中重新提交的大小。

本项目采用十进制 MB：`1 MB = 1,000,000 bytes`。

```text
cost = max(1, ceil(file_size_bytes / 10,000,000))
```

示例：

| 文件大小 | 费用 |
| --- | ---: |
| 1–10 MB | 1 积分 |
| 11–20 MB | 2 积分 |
| 21–30 MB | 3 积分 |
| 100 MB | 10 积分 |

费用规则应集中在一个纯函数中，API 和测试共同使用同一规则，避免前端展示和后端实际扣费不一致。

## 数据模型

### 用户权限和状态

在 `users` 增加：

```text
role: user | admin
status: active | suspended
must_change_password: boolean
```

默认新用户为 `user`、`active`、`false`。管理员不能查看用户原密码或密码哈希。

最后一个可用管理员不能被降级或禁用，避免系统失去管理入口。

### 积分流水 `credit_ledger`

积分最终变化使用追加式、不可变流水：

```text
id
user_id
amount                 正数增加，负数扣除
type                   welcome_grant | admin_grant | admin_debit |
                       analysis_charge | refund
reference_id           关联分析任务或充值申请
idempotency_key        唯一
reason
created_by             管理员 ID，可为空
created_at
```

余额为所有有效流水的 `SUM(amount)`。积分调整不覆盖旧记录，管理员可以看到完整历史。

### 分析预留 `credit_reservations`

分析开始时先预留积分，避免并发分析超额：

```text
id
user_id
run_id                 唯一
amount
status                 held | consumed | released
idempotency_key        唯一
created_at
consumed_at
released_at
release_reason
```

预留期间的可用积分为：

```text
积分流水总和 - status = held 的预留总和
```

### 充值申请 `credit_topup_requests`

```text
id
user_id
requested_amount
note
status                 pending | approved | rejected
reviewed_by
review_note
created_at
reviewed_at
```

管理员批准申请时，在 `credit_ledger` 写入 `admin_grant`，并在同一个数据库事务中将申请标记为 `approved`。重复审核不能重复入账。

### 管理员审计日志 `admin_audit_logs`

```text
id
admin_user_id
action                 grant_credits | debit_credits | change_role |
                       change_status | force_password_reset |
                       approve_topup | reject_topup
target_user_id
target_record_id
metadata_json
reason
created_at
```

审计日志只允许新增，不允许管理员在后台修改或删除。

### 密码重置

新增一次性、过期的 `password_reset_tokens`。管理员只能触发重置或要求用户下次登录修改密码，不能读取现有密码。

## 扣费流程

```text
用户上传视频
  ↓
视频记录保存真实 file_size
  ↓
用户点击开始分析
  ↓
读取 videos.file_size 并计算 cost
  ↓
数据库事务锁定用户余额
  ↓
检查可用积分是否足够
  ↓
创建 held 预留并投递分析任务
  ↓
分析成功：写入 -cost 的 analysis_charge，预留变为 consumed
分析失败：预留变为 released，不产生最终扣费
```

预留和扣费必须以 `run_id` 作为幂等键，并在用户行锁或等价事务保护下完成。API 重试、队列重试和 worker 重启不能重复扣费。

### 失败和取消规则

- API 创建失败、队列投递失败、系统异常：全额释放预留；
- AI provider 失败：全额释放预留；
- 处理开始前用户取消：全额释放预留；
- 处理开始后用户主动取消：不退回预留积分；
- 正常完成：预留转为正式 `analysis_charge`。

## 管理员账户和权限

提供一次性 CLI 命令创建首个管理员：

```bash
corepack pnpm admin:create --email admin@example.com
```

命令交互式读取密码，使用现有 bcrypt 机制保存哈希，并设置 `role = admin`。不通过明文密码环境变量自动初始化管理员。

所有管理员 API 在后端重新验证会话和角色，不能只依赖前端隐藏菜单。普通用户访问管理员接口必须返回 `403`，不能泄露用户或积分信息。

## 用户端功能

- 顶部显示当前积分余额；
- 显示积分流水；
- 上传视频后显示预计解析费用；
- 余额不足时阻止开始分析，并显示当前余额和所需积分；
- 提交人工充值申请；
- 查看充值申请的待审核、已通过或已拒绝状态。

## 管理员后台功能

- 用户列表、搜索和筛选；
- 查看用户详情、账号状态、角色、积分余额和积分流水；
- 审核充值申请；
- 手动增加或扣除积分，必须填写原因；
- 修改普通用户和管理员角色；
- 禁用或恢复用户账号；
- 强制用户下次登录修改密码；
- 触发密码重置流程；
- 查看管理员操作审计日志。

管理员不能删除用户及其账单历史。账号禁用采用软状态，禁止登录、上传和创建分析任务。

## API 边界

用户接口：

```text
GET  /api/credits
GET  /api/credits/ledger
POST /api/credit-requests
GET  /api/credit-requests
```

管理员接口：

```text
GET   /api/admin/users
GET   /api/admin/users/:id
PATCH /api/admin/users/:id/role
PATCH /api/admin/users/:id/status
POST  /api/admin/users/:id/credits
POST  /api/admin/users/:id/force-password-reset
GET   /api/admin/credit-requests
POST  /api/admin/credit-requests/:id/approve
POST  /api/admin/credit-requests/:id/reject
GET   /api/admin/audit-logs
```

积分调整使用明确的正负操作类型，而不是允许前端任意提交未审计的余额值。所有写操作都需要服务端校验输入、角色、目标对象和幂等键。

## 既有数据迁移

- 保留现有 `usage_ledger` 历史，不直接删除；
- 将现有试用和分析扣费记录映射为新积分流水，保证已有余额可追溯；
- 不自动给已有用户补发新的 12 积分，避免在未确认规则时改变现有余额；
- 上线后如需给历史用户补发迁移积分，由管理员通过带原因的 `admin_grant` 操作完成；
- 新用户从迁移完成后开始遵循“邮箱验证后 12 积分”的规则。

## 测试策略

采用测试驱动开发，先写失败测试再实现：

1. 费用计算：边界值 10 MB、10 MB + 1 byte、100 MB 和空/非法大小；
2. 初始赠送：验证邮箱重复请求只发放一次 12 积分；
3. 并发预留：余额不足时不能创建预留，两个并发分析不能透支；
4. 幂等性：重复 API 请求、队列重试和 worker 重启不会重复扣费；
5. 成功、系统失败、provider 失败和用户取消分别验证扣费/退款规则；
6. 充值申请：重复批准不能重复入账，拒绝不会产生积分；
7. 权限：普通用户不能访问管理员接口，管理员操作必须产生审计日志；
8. 用户状态：禁用用户不能登录、上传或开始分析；
9. 角色保护：最后一个管理员不能被降级或禁用；
10. 前端验证：余额、费用、充值申请和管理员列表的主要状态有对应 UI 测试；
11. 保留并运行现有注册、登录、邮箱验证、分析和 worker 测试。

## 设计依据

- Stripe 将预付费或促销积分建模为不可变的追加式账本，并区分账本余额和可用余额：<https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits>；
- Stripe 的用量事件支持唯一标识，用于避免网络重试导致重复记录：<https://docs.stripe.com/api/billing/meter-event/create>；
- OWASP 建议采用最小权限、默认拒绝、每次请求检查权限，并记录授权相关操作：<https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>。
