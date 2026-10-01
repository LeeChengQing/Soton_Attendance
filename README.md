# Soton Auto-Check 自动打卡扩展 v1.0.0

本次是手机提醒付费授权功能的正式首发版本（v1.0.0）；Chrome 扩展内部更新版本为 2.4.0。

本项目从现有 v1.0.3 Microsoft Forms 自动填写流程升级而来。学生在自己的 Chrome 用户中导入课表、绑定各课程二维码或链接，一键创建每周任务，扩展按马来西亚时间自动尝试打卡，并将提醒与打卡日志同步到 Supabase。

## 安装（Windows 和 macOS 共用一个 ZIP）

接收安装包的学生无需运行 `npm install`，也无需安装 Node.js。两种系统使用同一个 `Soton-Auto-Check-v1.0.0-Windows-macOS.zip`。

1. **Windows**：右键 ZIP，选“全部解压缩”。**macOS**：在 Finder 中双击 ZIP 解压。把解压后的文件夹放在一个不会随手删除或移动的位置。
2. 在 **Google Chrome** 地址栏输入 `chrome://extensions`，打开“开发者模式”，点击“加载已解压的扩展程序”（Load unpacked）。选择刚才解压出的、直接包含 `manifest.json` 的文件夹；不要选 ZIP 文件本身。
3. 如已安装旧版本，先停用旧扩展，避免两个版本同时触发提交。若用同一扩展目录覆盖旧版并在 `chrome://extensions` 点击“重新加载”，当前 Chrome 用户保存的资料和课程绑定会继续保留。旧版的一次性日期任务也会转成每周循环任务；请检查“已创建的每周任务”，删除不再上课的课程。
4. 点击 Chrome 工具栏中的 Attendance 图标，打开设置页。用该 Chrome 用户登录学校 Microsoft 账号，并允许 Chrome 显示系统通知。**Windows** 可在“设置 → 系统 → 通知”检查 Chrome；**macOS** 可在“系统设置 → 通知 → Google Chrome”检查。

扩展在 Chrome 中运行，安装包没有 Windows 或 macOS 原生程序。Chrome 关闭或电脑休眠时无法按时打卡。

## 使用

1. 保存学号、姓名和学生身份。
2. 上传 JPG/JPEG、PNG 或 PDF 课表。本机提取文字和表格；扫描文件使用打包在扩展内的英文 OCR。识别不完整时可手动添加或修改课程。
3. 在按星期分组的课程卡片中核对课程、星期、起止时间；点开卡片即可修改。带具体日期的 aSc Timetables 课表也会提取星期并每周重复。课表若同时列出 Group 1 和 Group 2，必须删除不属于自己组别的课程。停课日期可在课程卡片中按需填写。
4. 每个课程代码只需上传一次二维码图片，或粘贴一个 Microsoft Forms 链接。例如 `COMP1311-LEC`、`COMP1311-LAB`、`COMP1311-TUT` 共用 `COMP1311` 的绑定。扩展自动打开对应表单；检查标题及每道题的资料映射后，勾选确认并保存。每题只显示对应类别的资料选项；Module Delivery 根据 `-LEC`、`-TUT`、`-LAB` 自动选 Lecture、Tutorial、Lab/Laboratory，也可手动指定。Local / International 题可跟随学生资料或固定选择。共用链接的“仅填写测试”必须先明确选择具体课型；通过提示会显示所选课程和 Module Delivery，且答案改变后自动撤销通过状态。测试不会点击提交。旧版分别保存的课型链接需要在课程代码卡片中重新核对并保存一次；不同旧链接不会被自动合并。
5. 点击“一键创建每周自动打卡”。从创建后下一次匹配的课程结束前 5 分钟起自动执行，无需设置学期开始或结束日期，也无需每天确认。若停课、放假或课程结束，请在设置页删除相关任务。

### ntfy 手机提醒

设置页“学生资料”下方会显示专属 ntfy 主题。手机安装 ntfy 后，订阅这个 `https://ntfy.sh/...` 地址即可接收“明日是否打卡”和“打卡结果”提醒；不再需要手机配对码。主题本身不包含推送授权：需购买首学期套餐或续期商品，并在设置页输入收到的密钥激活当前设备。首学期套餐为 ¥12，手机提醒续期为 ¥5/学期；新商品详情页创建前，购买按钮会先打开 368FK 店铺页。现有 ¥10 插件商品保持不变。

密钥只能兑换一次并绑定到当前设备。有效期按密钥批次指定的学期截止日计算，截止日当天按马来西亚时间结束；续期密钥将授权延长至对应学期截止日，如果当前授权已覆盖该日期，同学期密钥不会增加时长。授权只控制手机通知，本机自动打卡不受影响。

扩展只同步课程代码、星期、时间、已核对的 Forms 链接和打卡结果，不上传课表原文件、学号、姓名或学校登录会话。

Supabase 项目已经配置好：`device-api` 负责设备注册、同步和日志；`send-reminders` 每天 UTC 11:30（马来西亚 19:30）把明日课程提醒写入通知队列；`notification-worker` 每分钟通过 ntfy HTTP 推送到手机。随机主题相当于频道凭证，请不要公开分享。

手机端使用的 API 基址：`https://qckpwckfukyurkobrsig.supabase.co/functions/v1/device-api`。扩展内已固定该地址；不要把 Supabase service-role key 放进扩展或手机端。

第 2、3、4 区各有“清空本区”：分别清空待核对课表、已保存的课程表单绑定、已创建的每周任务。按钮会先确认清空范围；学生资料和打卡记录保留。清空第 3 区后，现有任务要重新绑定表单才能自动提交。

## 安全与执行边界

- 只接收 `forms.office.com` 和 `forms.cloud.microsoft` 的填写链接；短链接需打开并核对最终答题页。
- 提交前比较任务日期、马来西亚当天日期及电脑本地日期；若表单有日期题，先读取当前值，只有不是今日时才打开日历选今天，并再次核对实际值。任一不一致即停止。
- 表单标题、题目或选项变化时停止。只在表单明确显示成功反馈后记录“成功”；结果不明不自动重试。
- Chrome 关闭、电脑休眠、学校登录过期、表单未开放、验证码或额外验证都可能阻止自动提交。扩展不会唤醒电脑，也不会绕过验证。错过时间后不会自动补打，只提醒手动处理。
- 学生资料保存在本机 `chrome.storage.local`；不保存密码，也不上传课表文件。课程任务、已核对的 Forms 链接和打卡状态会通过 HTTPS 同步到 Supabase，便于手机查看。二维码与 OCR 所需代码和英文数据均随扩展打包。
- 本版本识别英文日名、`HH:mm–HH:mm` 时间，以及 `YYYY-MM-DD` 或 `DD/MM/YYYY` 日期。其他课表格式请在预览中手动修正。Forms 仅支持与现有表单相近的单行文字、日期和单选题。

## 开发验证

- `npm test`：课程识别、每周循环、旧任务转换、重复导入、日期核对、二维码解码、表单映射和状态逻辑。
- `deno test supabase/functions/_shared/activation.deno.ts supabase/functions/_shared/entitlement.deno.ts`：密钥规范化、哈希和手机提醒授权边界。
- `supabase test db`：数据库密钥兑换与权限测试；需要本地 Supabase 数据库运行。
- `npm run keys:generate -- --count 100 --plan bundle --term-end 2027-01-31`：生成店铺明文库存与 Supabase 哈希导入 CSV。文件写入被 Git 忽略的 `activation-key-batches/`；不要提交或公开明文库存。
- 开发者首次构建前运行 `npm install`；`npm run build` 生成可安装的 `extension`。学生安装 ZIP 时不需要这些命令。
- `npm run smoke`：用本地模拟页面验证二维码、文字 PDF、JPG/PNG OCR、扫描 PDF OCR、同课程代码共用链接、逐题选项、Lab/Tutorial 单选题、日期选择及表单提交成功反馈；不会访问或提交学校表单。

第三方库许可证在构建产物的 `extension/licenses` 中。
