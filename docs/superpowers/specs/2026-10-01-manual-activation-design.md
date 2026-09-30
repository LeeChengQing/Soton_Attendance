# 手动付款与手机提醒激活设计

## 目标

为 Soton Auto-Check 增加第一版手动付费解锁流程。新用户购买 ¥12 套餐后获得插件使用权和首个学期的手机提醒；后续手机提醒按 ¥5/学期续期。第一版不接支付平台，收款后由管理员在 Supabase 手动激活。

## 范围

- 插件设置页显示手机提醒套餐、设备激活码、付款说明、提交付款编号和当前授权状态。
- Supabase 保存授权、激活申请和有效期。
- 设备可以查询自己的授权并提交激活申请，但不能自行激活。
- `notification-worker` 和提醒队列在发送前强制检查手机提醒授权。
- 本机自动打卡不受手机提醒付费状态影响。
- 不保存银行卡信息，不把 service-role key 放入扩展。

## 数据模型

### `entitlements`

- `device_id`：关联 `devices.id`
- `plan`：`bundle` 或 `phone_notifications`
- `status`：`pending`、`active`、`expired`、`revoked`
- `phone_notifications`：是否允许 ntfy 提醒
- `starts_at`、`expires_at`
- `source`：第一版固定为 `manual`
- `note`、`created_at`、`updated_at`

每个设备最多保留一条当前手机提醒授权。续期更新 `expires_at`，不创建重复激活权限。

### `activation_requests`

- `device_id`
- `plan`
- `payment_reference`
- `contact`
- `status`：`pending`、`approved`、`rejected`
- `admin_note`
- `created_at`、`reviewed_at`

激活申请只能由持有设备 token 的设备创建；管理员通过 Supabase 后台审核并更新授权。

## API

在现有 `device-api` 增加：

- `entitlement-status`：返回当前设备的套餐、状态和有效期。
- `activation-request`：提交付款编号和联系方式，创建待审核申请。

注册设备时生成用户可复制的短激活码，并保存到设备记录。短激活码只用于人工查找设备，不代替设备 token。

## 插件流程

1. 设置页调用 `entitlement-status`。
2. 未激活时显示 ¥12 新用户套餐和 ¥5 学期续期说明。
3. 用户复制激活码，付款后填写付款编号并提交申请。
4. 用户点击“刷新授权”，读取管理员激活结果。
5. `active` 且未过期时显示手机提醒已解锁；过期时提示续期。

## 通知权限

- `notification-worker` 查询设备的有效 `entitlements` 后才向 ntfy 发送。
- 没有有效授权的队列项标记为 `last_error=subscription_required`，不发送并保留日志。
- 已激活设备继续使用现有 ntfy 主题和通知内容。
- 取消或过期只停止手机提醒，不删除本机课表或自动打卡任务。

## 验收标准

- 新设备能看到唯一激活码和 ¥12/¥5 价格说明。
- 未授权设备提交测试通知时不会收到 ntfy 消息。
- 管理员激活后，设备刷新状态能显示有效期，测试通知可以送达。
- 到期后通知再次被阻止，本机自动打卡仍可运行。
- 设备不能通过修改插件本地状态直接获得服务端通知权限。
- 现有课表、Forms 绑定、打卡日志和 ntfy 配置不被删除。
