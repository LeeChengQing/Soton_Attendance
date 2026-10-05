# 授权与激活机制审计及加固实施方案

审计日期：2026-10-05（按工作区现有文件静态检查）。

## 范围与结论

本次只读查看源码、Supabase migrations/tests、打包脚本和现有说明；未连接 Supabase，未查询线上数据库，未执行 SQL/迁移，也未运行构建或测试。以下关于数据库现状的结论是“迁移源码规定了什么”，不是对线上 schema、Edge Function 部署版本或项目设置的实时核验。

当前授权是**手机提醒订阅授权**，不是整款扩展的总授权。手机提醒的 key 在服务器端兑换、entitlements 在服务器端核验；本机课表自动化并不依赖 entitlement。仓库中存在未提交改动，下面以当前工作区文件为审计对象；这些改动不是本任务造成的，本任务只新增本文件。

## A. 扩展端现状

### 授权与付费判断点

| 判断点 | 现状与证据 |
|---|---|
| 手机提醒授权查询 | 设置页调用 `getEntitlementStatus()` 并依据返回的状态、功能位、开始/截止时间显示或隐藏手机提醒状态卡；见 [src/options.js](../src/options.js#L66) 的 `updatePhoneStatusVisibility` 和 [src/options.js](../src/options.js#L78) 的 `refreshEntitlementStatus`。 |
| 激活 | 设置页将用户输入交给 `redeemActivationKey`，成功后再从服务器刷新 entitlement；见 [src/options.js](../src/options.js#L108)。表单及激活说明位于 [src/options.html](../src/options.html#L43)。 |
| 本机自动打卡 | 定时器从本机 sessions/bindings/profile/records 计算并触发表单工作流；`processSchedule()` 没有调用授权查询或以 entitlement 作条件，启动、安装、闹钟都会继续处理；见 [src/background.js](../src/background.js#L78)、[src/background.js](../src/background.js#L87)、[src/background.js](../src/background.js#L157)。因此付费授权不是全局门禁。 |
| 手机提醒发送 | 客户端仅向服务器同步任务/通知队列；服务端 worker 读取 entitlement，过期、撤销、未授权时拒绝发送；见 [supabase/functions/notification-worker/index.ts](../supabase/functions/notification-worker/index.ts#L12) 与 [supabase/functions/_shared/entitlement.ts](../supabase/functions/_shared/entitlement.ts#L8)。 |
| 门禁集中度 | entitlement UI 查询集中在 `options.js` 一处，但它只影响手机状态展示。扩展其他付费功能没有统一授权中间件；本地自动打卡路径也没有门禁。 |

说明明确写明授权只控制手机通知、本机自动打卡不受影响，见 [README.md](../README.md#L34) 和 [src/options.html](../src/options.html#L35)。如果产品目标现在要求把本机自动打卡也变为付费功能，需要先明确其 SKU/entitlement feature 名称和迁移策略；不能把现有行为误报为已锁定。

### key、设备标识与 token 存储

- 激活 key 在 [src/options.js](../src/options.js#L108) 被提交，`src/cloud.js` 只将它放进单次请求体（[src/cloud.js](../src/cloud.js#L81)）；未找到将成功激活 key 写入 `chrome.storage.local` 的实现。**⚠️ 不确定**：浏览器/扩展崩溃转储或用户手工输入历史不在源码可判定范围。
- 安装标识 `attendanceCloudDeviceKey`（`chrome-${crypto.randomUUID()}`）、服务端 UUID `attendanceCloudDeviceId`、设备 bearer token `attendanceCloudToken` 和 ntfy topic 保存于 `chrome.storage.local`；见 [src/cloud.js](../src/cloud.js#L29)、[src/cloud.js](../src/cloud.js#L38)、[src/cloud.js](../src/cloud.js#L48)。它们是可由本机扩展环境读取/改写的普通字符串，token 以明文存储；服务端只存 token 的 SHA-256，见 [supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L74) 与 [supabase/migrations/0001_attendance_backend.sql](../supabase/migrations/0001_attendance_backend.sql#L16)。
- 扩展没有授权令牌（短期、签名、绑定设备的 entitlement token）或内置验签公钥实现。当前 `attendanceCloudToken` 是设备 API bearer 凭据，并非授权证明；服务端表中的 `auth_token_hash` 是其哈希。
- API 基址硬编码在 [src/cloud.js](../src/cloud.js#L4)，扩展发出 POST JSON 请求且只按需发送设备 bearer token，没有显式 `apikey`/anon key 请求头，见 [src/cloud.js](../src/cloud.js#L6)。服务端 Edge Function 在环境变量中读取 service role key，见 [supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L5)。

### 离线行为

- 本机自动打卡使用本地日程；网络失败只会影响云同步/手机提醒队列，不能阻止本机日程执行：`processSchedule()` 的执行链独立于云队列（[src/background.js](../src/background.js#L87)、[src/background.js](../src/background.js#L120)）。手机授权查询失败时 UI 显示错误并隐藏有效授权卡（[src/options.js](../src/options.js#L98)），但源码中没有持久化离线宽限判定或按 72 小时锁定。结论：**手机状态界面 fail-closed，本机功能不锁定；服务端手机投递因服务端 entitlement 校验而拒绝。**

## B. Supabase 侧现状（基于仓库迁移源码）

### 表与权限

- `public.devices` 含 `device_key`、`auth_token_hash` 等字段，定义见 [supabase/migrations/0001_attendance_backend.sql](../supabase/migrations/0001_attendance_backend.sql#L16)。同一 migration 建立 schedules、attendance_logs、notification_preferences、push_subscriptions、notification_outbox（同文件 #L26、#L42、#L59、#L68、#L84）。
- `public.activation_keys` 储存 `key_hash`、产品计划、有效期、兑换状态和绑定设备；`public.entitlements` 储存设备授权状态、功能位和有效期；见 [supabase/migrations/20260930174454_shop_activation_keys.sql](../supabase/migrations/20260930174454_shop_activation_keys.sql#L8) 和 #L26。2026-10-04 migration 增加 `sem_subscription` 计划，并使该计划期限由兑换时服务端计算，见 [supabase/migrations/20261004172303_china_sem_subscription_expiry.sql](../supabase/migrations/20261004172303_china_sem_subscription_expiry.sql#L1) 与 #L14。
- `private.phone_subscription_recovery_challenges` 保存恢复挑战及 HMAC、设备目标等字段；RLS 开启并拒绝直接访问，见 [supabase/migrations/20261002080603_phone_subscription_recovery.sql](../supabase/migrations/20261002080603_phone_subscription_recovery.sql#L2) 与 #L23。
- `devices` 及其他业务表开启 RLS、为 `anon`/`authenticated` 建立拒绝策略并撤销直接权限，见 [supabase/migrations/0001_attendance_backend.sql](../supabase/migrations/0001_attendance_backend.sql#L119)。activation_keys 和 entitlements 同样有 deny-direct 策略及 revoke，service_role 被授予表操作权限，见 [supabase/migrations/20260930174454_shop_activation_keys.sql](../supabase/migrations/20260930174454_shop_activation_keys.sql#L48)。
- activation RPC `redeem_activation_key(text, uuid)` 限制只有 service_role 可执行（同 migration #L61、#L141）；设备与队列 RPC 也仅允许 service_role（[supabase/migrations/20261001100000_attendance_reliability.sql](../supabase/migrations/20261001100000_attendance_reliability.sql#L168)）；手机恢复 RPC 同样只授予 service_role（[supabase/migrations/20261002080603_phone_subscription_recovery.sql](../supabase/migrations/20261002080603_phone_subscription_recovery.sql#L269)）。

### RPC / Edge Functions

- `redeem_activation_key` 校验 SHA-256 key hash、状态、兑换期限，并写入兑换设备及 entitlement；不支持配置的“每 key 最多 2 台”，当前是一把 key 只能兑换一次绑定一个设备；见 [supabase/migrations/20260930174454_shop_activation_keys.sql](../supabase/migrations/20260930174454_shop_activation_keys.sql#L75) 与 #L98。最新版对学期订阅的有效期计算见 [supabase/migrations/20261004172303_china_sem_subscription_expiry.sql](../supabase/migrations/20261004172303_china_sem_subscription_expiry.sql#L44)。
- Edge Functions：`device-api`、`send-reminders`、`notification-worker`；配置中均 `verify_jwt = false`，见 [supabase/config.toml](../supabase/config.toml#L3)。`device-api` 自己校验设备 bearer token、通过 service_role 访问表/RPC 并处理 entitlement 与 key 兑换，见 [supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L5)、#L100、#L131、#L353。其动作还包括设备注册、数据同步、事件、日志、通知读取/回执等（同文件 #L353）。调度与 worker 分别读取 service role 环境变量，见 [supabase/functions/send-reminders/index.ts](../supabase/functions/send-reminders/index.ts#L7) 及 [supabase/functions/notification-worker/index.ts](../supabase/functions/notification-worker/index.ts#L8)。
- `redeem_activation_key` 和 entitlement 查询会区分 invalid/used/revoked/expired 状态及 HTTP 状态码，见 [supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L153)。激活没有按 IP/key 的限流；源码中存在设备恢复专属速率限制，但不能代替激活接口限流，见 [supabase/migrations/20261002080603_phone_subscription_recovery.sql](../supabase/migrations/20261002080603_phone_subscription_recovery.sql#L88)。

### anon 直接访问风险判断

按仓库 migration，anon 对 `activation_keys`、`entitlements`、`devices` 的表权限已撤销且 RLS deny-direct；源码未发现扩展携带 anon key 或 service role key。因此**仓库所描述的配置没有 anon 直接表读写漏洞证据**。不过这是 migration 静态结论，尚未对线上权限目录做只读核验；部署漂移仍属 **⚠️ 不确定**。扩展的 API URL 对用户可见属正常；service role 不在扩展，而只从服务端环境变量取用。

## C. 代码层绕过分析（未实施攻击）

| 场景 | 结果 | 依据 / 边界 |
|---|---|---|
| 修改本地扩展代码 | 若目标是解锁本机自动打卡，当前本来无需授权，直接可用；若伪造 UI 的手机授权状态，可绕过显示层，但不能在服务端数据库创建 entitlement 或通过服务端 worker 的授权校验。修改扩展也能做不受支持的自定义客户端；这不是服务器端授权成功。 | 本机调度未检查 entitlement：[src/background.js](../src/background.js#L87)；服务器发送检查：[supabase/functions/notification-worker/index.ts](../supabase/functions/notification-worker/index.ts#L12)。扩展代码可读取并修改的本地逻辑属于可绕过的客户端控制。 |
| 修改 storage | 将 `attendanceCloudDeviceId`、`attendanceCloudToken` 替换成随机值不能伪造服务器身份；复制真实 token 会复制设备 API 的 bearer 身份。伪造 UI 没有服务端授权效果。删除 storage 后会生成新安装标识/凭据，且可能进入注册/恢复分支。 | [src/cloud.js](../src/cloud.js#L29)、[src/cloud.js](../src/cloud.js#L38)、[supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L74)。 |
| 拦截/伪造服务器响应 | 可欺骗本地 UI 或被修改过的客户端，但远端 `notification-worker` 仍基于数据库 entitlement 判定。当前不存在客户端验签令牌，因此不能声称已有防伪签机制。 | UI 消费响应：[src/options.js](../src/options.js#L78)；服务端发送判定：[supabase/functions/_shared/entitlement.ts](../supabase/functions/_shared/entitlement.ts#L8)。 |
| 复制 ZIP 给他人 | ZIP 不含 Chrome `storage.local`，新用户通常会新注册设备，不能凭 ZIP 获得原 entitlement；把原设备的 storage/token 一并复制则可克隆 API 身份。重复兑换同一 key 会因已兑换失败。没有 key 粒度双设备席位模型，也不能限制每 key 两台。 | 扩展从本机 storage 初始化：[src/cloud.js](../src/cloud.js#L29)；单 key 单设备兑换：[supabase/migrations/20260930174454_shop_activation_keys.sql](../supabase/migrations/20260930174454_shop_activation_keys.sql#L98)。 |
| 重装扩展重置设备 ID | 删除 storage 后产生新 `deviceKey` 并注册新设备；原 key 已绑定，不能用原 key 再次兑换。用户可用另一把未兑换 key 绑定新 device；当前没有统一 2 台上限。现有手机恢复通过旧 key + 原 ntfy 接收渠道验证转移设备凭据，不等于普通重置放行。 | 生成新设备 key：[src/cloud.js](../src/cloud.js#L38)；key 单次兑换见上；恢复流程在 [supabase/migrations/20261002080603_phone_subscription_recovery.sql](../supabase/migrations/20261002080603_phone_subscription_recovery.sql#L60)。 |

客户端最小化/混淆只增加逆向成本，不算授权边界。有效边界应是服务器对受保护资源逐次校验签名令牌或 entitlement。

## D. 目标设计逐项差距

| 目标 | 状态 | 现状与差距 |
|---|---|---|
| 1. 默认锁定、无权时所有付费功能不可用并显示激活页 | ❌ 未满足 | 目前手机提醒订阅 UI 是设置页的可选折叠区域（[src/options.html](../src/options.html#L35)）；未授权不锁本机自动打卡（[src/background.js](../src/background.js#L87)）。需明确哪些功能收费，并为每个门禁使用统一 entitlement policy。 |
| 2. key + 随机安装 ID；校验 hash/状态/到期/设备上限；写表并返回绑定 ID、48h 签名 token；客户端公钥验签 | ⚠️ 部分满足 | 随机安装标识、SHA-256 hash、状态/有效期、兑换写表均有（[src/cloud.js](../src/cloud.js#L38)、[supabase/functions/device-api/index.ts](../supabase/functions/device-api/index.ts#L131)、[migration](../supabase/migrations/20260930174454_shop_activation_keys.sql#L75)）；当前单 key 一次一设备；没有设备席位配置、签名令牌、公钥验签。 |
| 3. 启动和每 12–24h 刷新；默认 72h 离线宽限；过宽限锁定；撤销/退款下次刷新失效 | ❌ 未满足 | 仅手动/打开相关 UI 查询 entitlement，没有统一启动及定时 token refresh、缓存签名授权、离线宽限；数据库撤销状态对服务端手机发送生效，但没有通用授权 refresh 接口。 |
| 4. IP/key 限流、失败阈值、统一错误、服务端审计日志 | ❌ 未满足 | redeem 区分失败原因；未找到兑换端 IP/key 限流、失败计数或审计表/事件。Recovery 限流是其他功能。 |
| 5. 核心价值改为带有效 token 的服务器功能/数据 | ⚠️ 部分满足 | 手机提醒投递已由服务器 entitlement 控制；二维码/OCR、表单填写、排程执行主要在客户端。尚无通用 signed token API 和授权内容接口。服务器化候选见下。 |
| 6. 无 service role/高权凭证进扩展；anon 无授权表直接权限，只走受控函数 | ✅ 已满足（源码设计） | 扩展源码只有 API URL，无 service_role；服务端从环境变量读取 service_role。migration 对表 deny-direct 并撤销 anon 权限（上文 B）。**线上实际配置未查，部署状态不确定。** |
| 7. 管理员可撤销 key、重置设备绑定、查看激活记录 | ⚠️ 部分满足 | 数据模型有 revoked 状态；recovery 允许经原手机校验后换绑；未找到受控管理员操作 API、审计记录视图或管理员界面。直接 SQL 人工操作虽可行但无受控运营流程。 |

## E. 分阶段实施方案

下列新增 migration、函数、测试和部署步骤均先在独立 staging 项目完成；本文 SQL 仅为草稿，不能直接作为 production 执行指令。每一步独立提交/发布，使用独立回滚点。

### P0 — 确定授权范围与安全基线（独立交付）

- **文件**：新增 `docs/activation-entitlement-contract.md`（或将本文件决策表转为规格）；不先改功能代码。
- **交付**：定义产品计划、feature code、当前只有手机提醒是否收费、设备席位语义（默认 2 个活跃安装）、换机/释放席位策略、退款/撤销生效 SLA、离线宽限例外。确定 `install_id` 的可复用/可清除规则和服务器端设备表的唯一约束。
- **staging 验证**：由产品确认 entitlement 样例和 feature 到门禁映射；检查未知 feature 默认拒绝。
- **回滚**：规格文件可独立撤销；无线上影响。

### P1 — 激活 / 刷新 / 审计后端（先部署兼容接口）

- **文件**：新增 migration `supabase/migrations/<timestamp>_activation_tokens.sql`、Edge Function `supabase/functions/activation-api/index.ts`（建议单独于宽泛 `device-api`）、共享验签/限流代码 `supabase/functions/_shared/activation-token.ts`；更新 `supabase/config.toml` 与 backend tests。
- **模型草案**：扩展 `activation_keys`（席位上限/状态/撤销原因）；规范 `devices` 唯一 `install_id` 并加活动席位关联；新增 `activation_audit_events`（仅 hash 前缀/截断 ID，不记录明文 key 或 bearer）；必要时为不同 SKU 建 feature entitlements。所有授权表 RLS deny-direct，anon 无 table grants。只允许受控 activation/refresh RPC；函数 `SECURITY DEFINER SET search_path = ''`，全程 schema-qualified，先撤销 `PUBLIC/anon/authenticated` 默认执行权限，按设计角色最小授予。Admin RPC 只给受控后台角色。
- **函数处理**：Edge 接受原始 key + install ID；服务端规范化并计算 key hash；对 key row 锁定；统一外部失败码/响应体；事务内校验状态、退款/撤销、期限和席位、upsert device/entitlement、写审计事件；成功时 Edge 生成短期签名授权。Refresh 以已登记设备 bearer 或轮换后的设备凭据定位设备，不再要求明文 key。
- **SQL 伪代码草稿（禁止直接执行）**：

```sql
-- staging-only 草稿；真实 migration 需先审阅约束、索引、锁顺序与现有数据。
create table public.activation_audit_events (
  id bigint generated always as identity primary key,
  event_at timestamptz not null default pg_catalog.clock_timestamp(),
  event_type text not null,
  key_fingerprint text,
  install_id_hash text,
  result_code text not null,
  request_id text
);
alter table public.activation_audit_events enable row level security;
revoke all on public.activation_audit_events from public, anon, authenticated;

create or replace function public.activate_install(p_key_hash text, p_install_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- TODO: bounded inputs; lock key then install/seat rows; generic denial;
  -- validate key status, refunded/revoked/expiry, configurable max_devices;
  -- atomically upsert device+entitlement and append audit event.
  return pg_catalog.jsonb_build_object('ok', false, 'error', 'activation_unavailable');
end;
$$;
revoke all on function public.activate_install(text, uuid) from public, anon, authenticated;
grant execute on function public.activate_install(text, uuid) to service_role;
```

  此草稿刻意不包含可执行授权逻辑；实现前必须替换 TODO 并在 staging 覆盖并发兑换、锁顺序和错误统一测试。更严格的方案是只让 Edge Function service_role 调用 RPC，anon/扩展永不直连表或 RPC；若最终选择 anon 直接调用 RPC，则仅授予窄函数执行权限，并把其所有参数和调用者能力视为不可信输入。
- **staging 验证**：只用伪造 key。验证首次激活、同设备幂等、两台可激活、第三台失败、并发第三台只有一个结果、过期/撤销/退款拒绝；断言表仍无 anon 读写权、直接 RPC 不可越权；审计不含明文 key/token。
- **回滚**：先关闭 staging Edge Function 路由；保留审计数据；按 dependency 顺序撤回新增函数/列/表。不要在 production 部署前假设可无损 drop。线上回滚脚本先在 staging 用真实 schema 副本演练。

### P2 — 非对称授权 token 与扩展验证器

- **文件**：新增 `src/entitlement.js`（schema、feature gate、签名验签、clock/宽限）；修改 `src/cloud.js`（refresh）、`src/background.js`（启动刷新/定时报警、每个敏感功能前校验）、`src/options.js`/`src/options.html`（激活/锁定页）；修改 `scripts/build.mjs` 以构建参数注入 API URL、部署环境和**公钥**；新增 entitlement 单元与集成测试。
- **token**：采用 Ed25519 或 ES256 JWS；claims 至少含 `iss`、`aud`、`sub`/install ID、`iat`、`nbf`、`exp`、`jti`、授权 feature/plan、key/entitlement 版本。客户端固定可信公钥并检查算法白名单、发行者、受众、时间和 install ID；拒绝 `none`、未知 `kid`、未知 feature 和解析异常。私钥仅在服务端签名服务密钥管理设施/Secret 中，禁止进入仓库、扩展、日志、构建参数或 CI 输出；生产和 staging 用不同 keypair/kid。
- **密钥生命周期（只写流程，不生成密钥）**：由组织批准的 KMS/HSM 或离线受控密钥管理流程生成非对称 keypair；导出公钥给构建团队，私钥不可导出或限权给 activation Edge Function；用版本化 `kid` 支持轮换；先发带新旧公钥的扩展版本，再切换签名 key，确认活跃客户端升级率后撤销旧 key；泄漏时立即停用私钥、切换 keypair 并撤销对应 `kid` token。审计只记录 `kid`，不得记录签名私钥或完整 token。
- **有效期策略**：token 默认 48 小时，在线设备每 12 小时刷新；服务端每次刷新重新检查购买、撤销、退款、到期和设备席位。默认离线宽限 72 小时按“最后一次成功签名授权时间”计，过期或超过宽限则 fail-closed。设备时钟倒拨不能无限续期：保存单调递增的服务端签发时间/最大可信时间并处理系统时钟回拨；私钥签名令牌本身不防本地系统时钟被篡改，需评估平台限制。
- **staging 验证**：有效/过期 token、签名修改、伪造 issuer/aud、错误 install ID、未知 feature、未来 nbf、过期后 72 小时内/外、时钟回拨、启动 refresh 离线、撤销/退款后 refresh；断言过宽限及无效签名一律拒绝。
- **回滚**：保留一个版本周期双验证器/双 key ID；关闭新签发而不撤除旧公钥，回退扩展到兼容代码；已签发 token 到期后再移除旧验证路径。回滚不得重新开启无授权付费功能。

### P3 — 服务器价值功能与统一门禁

- **文件**：修改 `src/background.js`、`src/options.js`、`src/cloud.js`，新增 `src/entitlement.js` 与受控 `supabase/functions/entitlement-content/index.ts`；若收费范围只包括手机提醒，则保留本地打卡免费但在界面/文档清楚标注。
- **统一门禁**：定义如 `requireFeature('phone_notifications')`。扩展本地门禁只用于 UI/减少无效工作，安全边界必须放服务器。所有服务器数据/服务请求都验证短期 token 和 feature；请求也绑定 install ID。未知状态默认拒绝。
- **候选服务端化与成本**：

| 候选价值 | 服务端化方式 | 成本 | 隐私/限制 |
|---|---|---|---|
| 手机提醒（现有） | 继续通过 server queue + worker 投递，每次实际投递校验 entitlement；减少 ntfy 主题作为唯一凭证的授权含义。 | 低至中（已有服务端投递） | 要处理重试、退款即时失效及主题迁移。 |
| 高价值课程表/学校学期模板、预置配置 | 服务器按 token feature 返回版本化模板/映射数据，扩展离线只缓存非敏感版本；敏感高级模板请求时校验。 | 中 | 可缓存内容仍可能被提取；授权阻止正常服务使用，不阻止已下载数据复制。 |
| 私有表单结构/映射规则库 | 服务器只返回用户当前任务所需、最小化的映射/规则；接口验证 token 和 feature。 | 中至高 | Form URL/课程信息属用户数据；需要数据最小化、保留期限、访问审计。 |
| 云端 OCR/排课/智能解析额度 | 扩展上传用户主动选择的文件，服务端按 token 校验并按量限额；优先只上传提取文本或临时文件。 | 高 | 需要额外隐私告知、删除策略、成本/滥用控制；现有本地 OCR 不应未经同意改为上传。 |
| Forms 自动填写/提交 | 不建议迁至普通服务器：依赖用户 Chrome 登录 cookie、前端 DOM 和用户在场/设备状态。可把高价值决策规则放服务端，但浏览器仍执行。 | 高 | 服务器无法安全取得用户 Forms 会话；不应要求用户上传学校密码/cookie。 |

- **staging 验证**：无 token、错误 feature、过期 token、撤销后、换设备、离线分别验证 API；数据接口不得把 key/hash/服务凭据返回客户端。
- **回滚**：按 API 版本路由回旧数据接口；对已经下载的非敏感静态配置按版本和缓存期限回退；不撤销用户本机排程数据。

### P4 — 限流与管理员运营

- **文件**：activation Edge Function、中间层 IP 限速配置；migration 增加限流 bucket/审计表；新增只供管理员执行的 Edge Function（验证独立管理员身份/MFA，并固定审计）。
- **行为**：按 IP 与 key hash 双维限流；设置短窗口、滚动失败上限、指数退避/封禁与告警；统一失败体（例如 `activation_unavailable`）和状态码，日志内部保留安全原因码。明文 key 只在请求进程短暂存在，禁止访问日志记录请求体；key hash 可作为审计指纹但应考虑 HMAC 指纹避免离线关联。代理头仅信任已配置网关写入的 IP 头。
- **管理员能力**：`revoke_key(key_id, reason)`、`reset_key_devices(key_id, specific_install_id, reason)`、`list_activation_audit(filters)`，仅服务端管理员身份可调用；撤销/解绑/查看均写追加审计事件；解绑席位不得删除历史 entitlement 而导致审计断链。管理员查看仅呈现掩码 key/安装标识，不呈现 key 原文或 token。
- **staging 验证**：IP/key 阈值与恢复时间、统一错误响应、key 是否存在不可区分、伪造 X-Forwarded-For 无法逃限；管理员非授权拒绝、授权撤销/单设备解绑生效且记审计。
- **回滚**：停止管理端入口，保留审计表只读；限流规则回退到更严格默认；不因回滚自动恢复已撤销 key。

### P5 — 兼容发布和构建产物门禁

- **文件**：修改 `scripts/build.mjs`、`scripts/package-candidate.mjs`、`package.json`、`.gitignore`；将当前固定 API URL 改为显式 build config；增加 `build:staging` 与 `build:release`，release 对 staging URL、测试 key、调试开关 fail build。
- **staging 验证**：检查 manifest、源码映射、构建 hash、secret 扫描、手动加载扩展和旧版升级迁移；不同环境产物标记清晰；产物没有私钥或 service role。
- **回滚**：保留上个正式 ZIP、provenance 和签名公钥版本；通过扩展商店/分发渠道发布兼容修复。旧版若不能理解授权锁，服务器不能依赖客户端 gate 保护服务器价值；服务端 API 采用显式旧版拒绝/用户升级提示或短期兼容策略，具体截止日公告用户。

## F. 构建产物与密钥扫描

### 当前命令与产物

- `npm run build`：由 [package.json](../package.json#L8) 调用 `scripts/build.mjs`，重建 `extension/`（[scripts/build.mjs](../scripts/build.mjs#L5)）。该脚本会清空并重建 extension 文件夹；本任务没有执行它。
- `npm run candidate`：会运行测试、构建、smoke 并打包候选产物；`npm run release` 会同样执行 release 模式，定义见 [package.json](../package.json#L13)。本次不运行。
- ZIP 由 `scripts/package-candidate.mjs` 写入 `outputs/`；候选文件名为 `Soton-Auto-Check-v<版本>-candidate-Windows-macOS.zip`，正式包名为 `Soton-Auto-Check-V1.0-Release-Windows-macOS.zip`，见 [scripts/package-candidate.mjs](../scripts/package-candidate.mjs#L64)。
- 当前检查器核对允许文件清单、JS/HTML/JSON 中若干高权限密钥标记、源码 bundle 一致性和 ZIP 往返，见 [scripts/package-candidate.mjs](../scripts/package-candidate.mjs#L32)。它没有通用扫描测试 key、调试开关、秘密熵值或后门的证明能力，必须增加规则并人工审阅差异。

### 发布前检查清单

1. `npm run build`；审阅 `extension/` 中生成的 `manifest.json`、`background.js`、`options.js` 和所有静态资源。
2. `npm run candidate` 或 `npm run release`（仅在独立 release 工作区、staging 流程完成后；不要把上述自动化命令当成本次审计已执行）。
3. 对 `extension/` 和 ZIP 展开内容扫描 `SUPABASE_SERVICE_ROLE_KEY`、`sb_secret_`、私钥 PEM、`ATTENDANCE_SCHEDULER_SECRET`、staging 项目地址、测试 key 字面值、调试 bypass/feature flags、`if (true)`/隐藏管理员路径等；同时检查 source map、`.env`、CSV、provenance 是否误入包。
4. 使用 allowlist 校验 ZIP 文件清单；与上一正式包做源文件级 diff。重点审查任何跳过 entitlement、签名验证、环境识别和 API 基址的代码。
5. 用无授权、失效授权、篡改 token、撤销 key 的 staging 账号手工走完整 UI，确认锁定页和服务器 API 拒绝；再以有效 staging key 确认激活。
6. 核对生成的 ZIP 哈希和构建来源；不在对话、构建日志或 provenance 中打印任何真实密钥、明文 key、service role 或私钥。

### 本次对现有产物的静态检查结果

只读检查了当前 `extension/` 目录的可执行/配置文本，以及 `outputs/Soton-Auto-Check-V1.0-Release-Windows-macOS.zip` 和仓库根目录 `Soton-Auto-Check-v1.0.0-Windows-macOS.zip` 中的 JS/JSON/HTML/CSS/MJS/MD 文本条目；检查了 service role / scheduler secret 标记、`sb_secret_`、私钥 PEM 标记、`test.activation.key` / `fake.key` 字样和常见 `bypass` / `forcePremium` / `backdoor` 字样。**未发现这些预设特征。**此结果不等于证明产物不存在任意未知凭据或逻辑后门；二进制资源、JWT/测试 key 的其他格式、任意编码字符串和逻辑层面的恶意路径需要进一步人工审阅。未运行构建或 ZIP 打包，避免覆盖当前生成目录。

## G. 风险与未决问题

- 🔴 **产品收费边界待确认**：当前订阅只控制手机提醒；是否要把本机 Forms 自动打卡也纳入付费，目标描述没有点名 SKU。实施前必须有 entitlement feature 清单。
- 🔴 **客户端可篡改**：Chrome 扩展源码和本地存储均由用户控制。任何仅客户端的锁定都可绕过；只有服务端不给受保护价值才能形成真正边界。
- 🔴 **线上状态未核验**：没有连接线上，Edge 部署版本、实际 RLS/grants、Secrets、函数日志配置、是否启用额外限流均为 ⚠️ 不确定。先在 Supabase Dashboard 只读查看并导出 schema/config，不将只读核验误当变更。
- 🔴 **备份敏感性**：activation_keys 中的 hash、devices 中的认证 hash、entitlements 属敏感运营数据；备份目录必须被 Git 忽略并验证忽略状态，禁止上传工单/聊天/仓库。
- 🟠 **匿名 API 暴力猜 key**：当前兑换错误可区分 key 是否存在/状态且未发现激活限流；需统一外部响应，并谨慎配置网关/IP 识别和告警。
- 🟠 **密钥撤销的离线窗口**：48h token 加 72h grace 意味着在线断开时最多存在更长离线使用窗口；签发 TTL 与宽限语义应按产品风险审批，撤销只能在下次成功联网 refresh 生效。
- 🟠 **设备 ID 可重置/克隆**：客户端 install ID 可被删除，bearer token 可被复制。席位控制依赖服务端并发安全的安装记录、设备恢复流程和管理员解绑。
- 🟠 **退款源与状态同步**：当前表中 revoked 可表达撤销，但未找到支付平台退款 webhook/可靠对账实现；退款到 revoke 的时延未定义。
- 🟠 **扩展 URL 环境配置**：当前 API URL 固定，需防止 staging build 指向 production、release build 指向 staging；CI 需验证 allowlist。
- 🟡 **过渡期旧版兼容**：旧版只理解长寿命设备 bearer token 和 entitlement JSON，不验证 JWS；服务器端 API 发布新门禁时必须定义旧版期限与更新提示。
- 🟡 **审计可识别性**：日志既要让管理员调查 key 状态，又不能泄漏原始 key/token；确定 keyed fingerprint、保留期和访问审计规则。
- 🟢 **既有基础**：key hash、事务兑换、service-role 隔离、RLS deny-direct、服务器手机通知 entitlement gate、构建 ZIP allowlist 已存在，可复用但仍需 staging 回归。

## H. 环境、备份与发布操作规程

### H1. production 数据备份（只读导出；真正变更前立即做）

本任务没有执行以下步骤。生产项目只允许只读查看；只有经 staging 全部验证、获准排期后，才执行“上线”步骤。

1. 在本地仓库先准备敏感目录：新增 `.gitignore` 规则 `/backups/`；建立 `backups/supabase-prod-readonly/YYYYMMDD/`（例如 `20261005`）。运行 `git check-ignore -v backups/supabase-prod-readonly/20261005/activation_keys.csv` 确认路径被忽略后再保存导出。此项是未来操作要求，本次不改 `.gitignore`。
2. 登录 Supabase Dashboard，确认项目名称/项目 ref 和组织后，打开 **Table Editor**，依次选 `public.activation_keys`、`public.devices`、`public.entitlements`，使用 Export/Download CSV 导出完整表（不是当前页面筛选行）。文件命名为 `production_20261005_activation_keys.csv`、`production_20261005_devices.csv`、`production_20261005_entitlements.csv`，放入上述被忽略目录。导出包含敏感 hash，按机密备份管理，限制本机磁盘访问并加密磁盘/归档。
3. 在 Supabase SQL Editor 对**生产库只运行只读计数**，将计数单独记录在同一目录的 `manifest.txt`（不要记录任何行内容）：

```sql
select 'activation_keys' as table_name, count(*) as row_count from public.activation_keys
union all
select 'devices', count(*) from public.devices
union all
select 'entitlements', count(*) from public.entitlements;
```

4. 对照 CSV 数据行数（总行数减 1 行标题）与 `manifest.txt` 的 SQL 行数；检查 CSV 首行列名与 Table Editor 完整列一致、文件非空、UTF-8 可读。另记录导出时间、项目 ref（可记在本机私密 manifest）、文件大小和 SHA-256。导出失败或计数不符时不得进行任何变更。
5. 若迁移会改动其他表、外键、触发器或业务数据，迁移影响表也必须同样导出；评审 migration 影响清单后更新备份集合，不能只备份这三张表。
6. **恢复演练必须先在 staging**：建立空白且 schema 匹配的恢复目标；用 Table Editor CSV import 或受控 `psql` 导入，先导入 `devices`，再导入 `activation_keys` 和 `entitlements`（前两表外键依赖 devices；注意 entitlement 设备依赖）。逐表回读计数并抽查关联。production 事故恢复时先冻结写入/调度、确认恢复边界与受影响依赖表，依照 staging 演练过的 SQL/导入脚本执行事务化恢复；不要盲目 TRUNCATE/CASCADE，因为会级联删除课程、日志和通知数据。若要求精确回到备份快照，需同步备份并恢复所有受影响依赖表，恢复前确认级联范围及时间窗口。
7. 验证备份可恢复后仍保留加密原件直到变更观察期结束；过期安全删除备份及临时副本。任何备份绝不提交 Git。

### H2. 建立独立 staging Supabase 项目

1. 在 Supabase Dashboard 创建**独立** staging 项目，使用单独项目名、独立数据库密码、独立 secrets/签名 keypair；不要把 production URL、secret 或数据导入 staging。免费计划每个组织最多 2 个活跃项目（按任务提供的约束）。若已达到上限：优先暂停一个非生产、可恢复的测试项目；若不能暂停，则由组织管理员在另一个合规组织/付费额度中创建 staging。不得通过覆盖 production 或临时把 staging 指向 production 来规避限制。
2. 从仓库 migration 在 staging 创建结构，不导入 production 行数据。先核对 migration 顺序，再把 `supabase/config.toml` 的 project ref 通过安全本地 CLI 配置指向 staging；所有 CLI 命令显式校验当前 ref。建议在新项目完成 schema dump/比较，而非复制线上数据。
3. 只在 staging seed 文件中灌入少量合成数据：用测试脚本生成随机假 key，再只把 key hash 放入 `activation_keys`；假设备 ID、随机测试 token hash 与测试 entitlement 单独标记 `note='staging_fixture'`。禁止复制 production key hash、device hash、真实主题或用户数据。测试 key 只能存在受保护的本地测试环境，不进入 release 构建、日志或文档。
4. 将 API endpoint/key 做成构建时参数，不硬编码。建议 `src/cloud.js` 不再定义固定 URL；`scripts/build.mjs` 从环境变量/显式 build 参数读取 `ATTENDANCE_ENV`、`ATTENDANCE_API_URL`、`ATTENDANCE_SUPABASE_ANON_KEY`，只编译公开 anon key 和 staging endpoint。使用 `.env.staging.local`（`.gitignore` 已忽略 `.env*`）或 CI secret 注入，不提交文件；构建脚本校验 staging profile 的域名、禁止 service_role/私钥，并在 manifest/版本名可见地标记 staging。当前实际 API 硬编码位于 [src/cloud.js](../src/cloud.js#L4)，生成 manifest 也固定 host permission，见 [scripts/build.mjs](../scripts/build.mjs#L34)。
5. 先构建到独立 staging 输出目录，手动确认 `manifest.json` host permissions 只含 staging API 和必要 Forms 域名；加载 staging 扩展，绝不能用它覆盖正在使用的生产安装。

### H3. staging 验证清单

| 测试 | 预期结果 |
|---|---|
| 新 key + 新随机 install ID 激活 | hash 匹配且 key 可用时事务成功，设备/entitlement/audit 一致，签名 token 的 sub/install 与设备一致，TTL 48h。 |
| 同一设备重复激活/请求重试 | 幂等返回同一授权或安全更新；不得多占一个设备席位、重复记账。 |
| 第 2 个设备激活 | 默认上限 2 时允许；席位值可由服务端配置覆盖。 |
| 第 3 个设备激活 | 拒绝；已有两设备状态不变，返回通用错误，服务端审计保留内部原因。 |
| 已过期 key / entitlement | 激活或 refresh 拒绝；客户端无授权进入锁定态，服务端价值 API 拒绝。 |
| key 被撤销 | 后续 refresh 拒绝并清除/标记客户端 token；服务端 API/worker 同时拒绝。 |
| 退款 | staging 模拟退款事件更新授权状态；下一次 refresh 失效，观察最长延迟符合合同。 |
| 在线 refresh 正常 | 启动时与 12h 定时 refresh 更新令牌；令牌绑定正确 install ID。 |
| 离线宽限 | 最后签发授权后 72h 内按批准策略允许缓存 feature；超过 72h 自动锁定；服务器功能离线无法访问。 |
| token 篡改/伪造/错误签名/错误 install ID | 公钥验签或 claim 检查失败，所有付费门禁 fail-closed。 |
| 暴力猜 key | IP 与 key hash 两类限流均触发；达到失败阈值后冷却；外部错误体/状态不暴露 key 存在性；不记录请求明文。 |
| anon 直接访问 | REST table select/insert/update 均拒绝；只能通过列明且最小权限的受控函数路径；不能调用管理员 RPC。 |
| 管理操作 | 管理员可撤销某 key、释放指定席位、查看脱敏审计；非管理员均拒绝，所有变更留审计。 |

### H4. staging 通过后的 production 发布与回滚

1. **生产仍按只读对待，直到变更获准且 staging 证据完整**：确认 staging migration hash、测试报告、备份三表及所有受影响表、恢复演练记录、窗口/负责人。迁移不得指向 production staging ref；上线审批后才显式选择 production 项目。
2. 上线前立即重新导出 H1 所列全部影响表并复核行数。production 免费项目没有自动备份这一前提下，此人工备份为必需门槛。
3. 推荐顺序：先部署兼容的签名公钥验证扩展版本/旧 API；再发布新增表与只增不删 migration、RLS deny-direct 和受控函数；再设置 Edge secrets / 限流 / 签名私钥（只在服务端 secret manager）；部署 Edge Function；运行只读 grants/RLS 冒烟检查；启用签发但先对内部测试 key 灰度；最后逐步扩展到用户。所有命令都明确 production ref 并由第二人复核，SQL 草稿先经 DBA review。
4. 上线立即核验：匿名不能读写授权表；新 key 激活一次且设备席位正确；旧 key/hash 不被日志吐出；refresh 返回签名 token 且扩展验签通过；撤销后 refresh 和受保护 API 拒绝；旧版 upgrade 行为、手机投递、恢复流程、Supabase 错误率/限流告警均正常。不要通过输出 secrets/token 做核验。
5. **回滚**：先关闭 activation/refresh Edge 路由或停止新 token 签发；保留 key/审计记录以供调查；回滚兼容扩展/API 到上一可用版本；只执行已在 staging 验证过的 down migration。若迁移/运营步骤修改了三表数据，则冻结写入，按事故窗口选择事务化逆向 SQL 或使用 H1 备份恢复；若恢复会影响外键依赖表，连同这些表一并恢复。先在 staging 完整演练，production 由 DBA 手动核对影响行数；恢复后验证计数、外键、授权抽样和 API 拒绝行为。不得直接 TRUNCATE/CASCADE 或把测试数据写入 production。
6. **旧版本兼容**：旧版不会验签，灰度期旧版继续走旧 entitlement 响应时它只能保护既有服务端手机提醒；不能让旧版访问新增的高价值受保护 API。按明确公告的最短兼容窗口，旧版收到升级提示后服务端拒绝新 premium API；保持本地数据迁移兼容，旧安装无需清空 storage。关闭旧 API 前统计仍使用旧版的匿名兼容请求，但统计不含 bearer/key 明文。

## 结语

优先顺序是先确认付费边界，再补服务器签名 entitlement、席位事务、刷新/离线策略、统一错误与审计，随后把真正有价值的数据服务放到服务器门后，最后上线客户端门禁和兼容发布。当前最重要的现实边界是：本地扩展无法可靠地保护本地执行价值；服务器端授权校验才是有效控制点。
