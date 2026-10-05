# Forms 自动提交可靠性设计

## 目标

提高 Microsoft Forms 自动提交链路的可观察性和安全性：成功页文字必须明确匹配才判定成功；提交前永久记录幂等键并由后台串行授予提交权；无法确认时进入“已提交，待确认”，不失败、不重试。

## 边界

- 只修改本地 Forms 自动提交、任务状态、记录展示和测试。
- 不修改授权、激活、订阅或门禁代码。
- 不 push，不还原工作区既有未提交改动。
- 不把真实本地成功页文字、表单答案、表单链接或个人资料写入仓库或日志。

## 成功判定

`src/forms.js` 提供可配置的大小写不敏感多语言文字规则，覆盖英文、简体中文和马来文常见“提交/感谢”措辞，并明确覆盖 `Your answers have been submitted successfully.` 与 `Your response was submitted`。

提交后的结构变化只作为辅助信号。真实样本 `tests/local-only/forms-success-real.html` 当前没有可用结构属性，因此结构规则保持禁用占位；若未来样本出现稳定结构属性，只记录标签名、role 和 data-automation-id，不记录文字节点。

只有文字信号才产生 `success`。仅结构变化时进入 `submitted_pending_confirmation`；没有任何信号时也进入该状态。两种情况均不自动重试。

## 幂等与状态

幂等键沿用 occurrence key，语义为课程、日期、时段。内容脚本点击前发送 `RESERVE_SUBMISSION`。后台的 `serialized` 队列是唯一写入者：每个请求在队列内重新读取 `attendanceRecords`，只有不存在永久 `submissionAttemptedAt` 的键才能写入尝试记录并返回 granted；后续请求一律 denied。Chrome storage 的非原子性由单一 service-worker 写入队列和队列内重新读取保证，跨 service-worker 重启则依靠已持久化标记拒绝再次授权。

尝试标记永不自动删除。只有用户点击“允许重新提交”并确认明确的重复打卡风险后，后台才清除该标记；本需求不实现自动重试。

## 阶段与错误

记录 `phase`、`phaseStartedAt`、`phaseDeadline`、阶段耗时和无敏感信息的成功信号名称。阶段为 opening、reading、checking、filling、submitting、confirming。各阶段有独立 watchdog 文案。登录主机或权限 URL 由后台快速识别并通知“需要登录学校账号”。定时器漂移超过允许窗口时记录 `missed_sleep`，区别于普通 failed。

后台在 reading 阶段无内容脚本响应时，仅对目标 Forms 标签执行一次 `chrome.scripting.executeScript` 回退注入；内容脚本带页面级加载标记，避免重复执行。

## 表单变化

比较前对题目和选项做空白折叠、大小写统一和全角半角统一，并输出新增、删除、改名、选项变化的结构化差异。顺序变化不构成差异。确有差异仍停止提交；更新绑定必须经现有用户确认流程，不能静默覆盖。

## UI 与历史记录

新增状态显示和两个操作：手动“标记为已提交”、以及“我要手动检查”。已有 unknown 记录不自动迁移。运行中的 `submitted_pending_confirmation` 不算成功或失败，但同一时段不会再次提交。

## 测试

使用现有 Playwright 能力和 Node 测试覆盖多语言成功文字、结构辅助信号、无信号、登录页、题目差异、Reserve 串行竞态、超时/重启/重复定时路径，以及历史 unknown 的手动操作。测试输出只断言状态、阶段和信号名，不输出样本文字内容、链接或个人信息。
