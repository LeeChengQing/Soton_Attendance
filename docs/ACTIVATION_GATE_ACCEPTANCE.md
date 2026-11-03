# 激活门禁交付与验收

日期：2026-11-03。扩展源码位于 `src`；本次只构建 `dist/attendance-v1.1.0`，仓库根目录的已生成运行文件未替换。

## 调查结论与变更

- 授权 API：`src/cloud.js` 与构建所用 `src/v1.0.5/background-cloud.js`。两者现在复用 `src/plugin-license.js`，令牌继续保存在既有 `attendanceCloudToken`，不新增令牌存储位置。
- 原有 `attendancePluginLicense` 只保存方案和到期时间，否定响应会删除缓存，也没有宽限状态；现在保留历史激活证据与明确政策响应，以支持失败时放行。
- 设置页原“插件授权”表单已移除，保留只读授权、到期时间、设备 ID、检查授权、续费、客服与降低透明效果开关。侧栏入口保留。
- 新增 Liquid Glass 门禁、默认/错误/已失效变体、加载/成功/限流、版本/维护状态、键盘焦点约束、系统回退与中英文文案。i18n 保持既有语言模块，新增键集中在 `gate.*`；补齐缺失授权及连接文案。
- 安装打开设置页，初始应用隐藏，锁定时背景 inert / aria-hidden；popup 锁定只显示激活入口，图标角标为 `!`，已有打卡告警不会被授权状态刷新清掉。
- 原开发开关确实参与单独的调试构建；现在发布分支在编译期移除，并在构建目录和最终 ZIP 上强制断言。`scripts/scan-release.mjs` 可单独扫描 ZIP 并输出 JSON。
- 测试工具沿用 node:test、esbuild、Playwright 和本机 Chrome，未安装新依赖。变更保留未提交状态。

## 所有自动执行入口

| 入口 | 授权约束 |
|---|---|
| 安装/启动、NEXT/MAINTENANCE/retry 告警、重建课表触发的 `processSchedule` | 新运行打开标签页前调用 `requirePluginLicense()` → `getActivationGate({refresh:true})` |
| 设置页、popup 的 `MANUAL_CHECK_IN` | 相同授权检查，继续复用既有任务身份与原子提交约束 |
| `RUN_TEST_NOW` | 相同授权检查；原有测试表单白名单、时限与显式授权继续生效 |
| 自动追补、失败恢复形成的新运行 | 重新进入 `processSchedule`，同样检查授权 |
| `OPEN_MANUAL_RESUBMIT` | 打开新表单前检查授权，不放宽原有人工确认条件 |
| `START_CHECK` | 单项检查打开表单前检查；无运行身份的内容脚本填写前再经 `AUTHORIZE_AUTOMATION` |
| `START_SETUP` / `GET_SETUP_ITEM` | 课型检查及取填写参数使用相同状态来源 |
| `attendance-preflight:*` / `GET_PREFLIGHT` | 预检打开新标签页及取参数前检查；已运行预检的超时清理仍可完成 |
| `GET_RUN` / `RESERVE_SUBMISSION` / 运行中的前台回退 / 各类报告 | 已启动运行继续，保留标签页身份、任务配置、日期、截止时间、提交锁等原有校验 |
| `AUTHORIZE_AUTOMATION` | 对已有匹配标签页的 launched/pending 运行继续放行；独立新填写必须通过共享门禁 |

删除界面遮罩不会删除这些后台检查；门禁不清除课表、资料或打卡记录。

## 自动验证

针对性命令：

`node --test tests/activation-gate.test.js tests/activation-gate-browser.test.js tests/activation-release.test.js tests/cloud-entitlements.test.js tests/license-key.test.js tests/background.test.js tests/package-candidate.test.js tests/settings-sender.test.js tests/permissions.test.js`

结果：**117/117 通过**，零失败。覆盖状态机、72 小时边界、失败时放行、明确拒绝的重启保持、激活竞争、总超时、合成密钥泄漏检查、键盘/焦点、输入/错误、成功延迟、限流、中英文、强制颜色/减少动效、透明度开关、尺寸、入口拦截、发布移除和合成干净/污染 ZIP。

`node --test scripts/extension-smoke.mjs`：**1/1 通过**。使用真实 MV3 扩展、真实消息和存储、实际停止并重启 service worker；授权 API 使用合成响应，阻止所有外部 HTTP(S) 网络与生产域名，不提交学校表单。脚本更新了旧授权表单定位、过时的货币按钮定位及缺少周起始日期的合成数据。

`node scripts/build.mjs`：候选构建和产物断言通过。最终 ZIP 扫描结果见 `../outputs/activation-gate-release-scan.json`。构建后再次运行 MV3 检查，最终结果以该报告为准。

Impeccable 检查返回空发现，但检查器缺少可选解析模块，处于降级模式，不能当作完整对比度审计。真实 Chrome 截图已人工查看；正式验收仍须按下方清单在最亮位置检查对比度。

## 手动验收（由使用者在真实 Chrome 执行）

1. 加载 `dist/attendance-v1.1.0` 或解压 review ZIP，在全新 Chrome 配置中安装。确认自动打开设置页、应用没有先闪现、门禁输入自动获得焦点、图标显示 `!`。
2. 分别使用 1280×720、1920×1080、800×600。卡片宽度最多 540px，小窗口可滚动，底部复制/客服可达；不得出现横向溢出。检查最亮柔光处文字对比度：正文 4.5:1，大字 3:1。
3. Tab/Shift+Tab 只在门禁循环；Esc 不关闭；Enter 提交。粘贴大小写、空白、不同连字符及 UUID，确认没有静默截断。错误格式不得发起激活请求。
4. 在隔离测试授权服务中使用无效、过期、停用或设备超限密钥，确认未激活用户只见统一错误。限流使用服务端秒数倒计时；验证中输入和提交禁用。
5. 成功后输入立即清空，约一秒后解锁。授权页没有密钥输入框；复制的只有完整设备 ID。成功后再次改变授权状态，当前设置页应恢复门禁。
6. 断网提交可重试；已有授权的用户断网、5xx、超时、坏 JSON 时只显示顶部轻提示，正在进行的任务不中断。明确吊销/退款不得启动新任务；明确到期超过 72 小时后才锁定。
7. 在设置与门禁切换“降低透明效果”，重载确认保留。打开系统减少动效和强制颜色，确认不透明卡片、可见边框、焦点环与键盘操作正常。
8. 删除遮罩 DOM，通过后台消息尝试新手动打卡、单项检查、课型检查、测试运行及自动预检，未激活仍不能启动。确认既有本机资料与记录未删除。
9. 运行 `node scripts/scan-release.mjs <最终ZIP绝对路径> <报告绝对路径>`，报告须 `passed:true`、`findings:[]`。合成污染包测试必须失败。
10. 投产前配置真实 `links.buy/renew/recover/support/download` 并确认授权状态响应能提供明确过期/吊销原因。**当前服务端缺少这些字段，相关情景不能假称已做生产端到端验收。**

详细取舍见 [DECISIONS.md](../DECISIONS.md)。未执行全量测试、正式发行、支付或数据库端到端测试；没有提交、推送或部署。

## 候选包与扫描结果

- 候选包：`dist/attendance-v1.1.0-activation-gate-review.zip`，27 个文件，9,204,904 字节。
- 最终 ZIP 解压扫描：`outputs/activation-gate-release-scan.json`；`passed:true`，`findings:[]`。
- SHA-256：`outputs/activation-gate-review-sha256.txt`。
- 默认态截图：`outputs/activation-gate-default-1280.png`、`outputs/activation-gate-default-1920.png`、`outputs/activation-gate-default-800.png`。
- 新样式文件原先不在根目录时，发布脚本现在也能建立快照；替换失败时会正确回滚新增文件。本次没有执行替换流程。
