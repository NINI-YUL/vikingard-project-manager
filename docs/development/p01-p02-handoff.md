# P01–P02 交付与 P03 新会话启动文本

更新：2026-11-13。本文件记录代码交付及已验证事实，历史阶段见 p01-p02-20261112.md。切换批次时主动提醒开新会话并提供实际提交；不把本机登录成功等同跨设备内网验收通过。

## 交付状态与限制

- 分支：codex/p01-p02-foundation-auth，起点 85b9ea4db5ceb4eaeff452b83e507d271724ed0b。本文件随本批交付提交保存；实际交付提交号使用当前分支 `git rev-parse HEAD` 核实。用户仅授权提交及推送开发分支，明确暂不合并 main。
- 已实现：独立 PostgreSQL 业务库与前向迁移、一个 Node.js 应用、钉钉 OAuth、服务端四档权限、按明确名单一次性初始化、会话摘要和即时撤权、Origin/CSRF、防止最后所有者被并发撤权或停用。总原型 v2 未改动，验收入口不是完整业务页面。
- 已完成本机人工检查：余莉所有者登录；吴潇靖查看者登录及写入返回 403；用户以陈雨萱测试得到 `?login=403`，页面拒绝且人员表仍为两人。该页面将未授权和企业身份验证失败合并提示，尚无独立拒绝原因审计，不能仅凭该提示断定企业验证具体在哪一步拒绝或确认该账号身份。
- 未完成：跨设备内网 HTTPS；独立管理员真实账号测试；所有者撤权后查看者旧会话失效、最后所有者保护的人工验收。上述服务端权限路径已由真实 PostgreSQL 集成测试覆盖，不能据此宣称整批所有人工验收通过。
- 后续新增人员的“待绑定邀请、本人登录、所有者确认”只是讨论方案，尚未实现，也不在本批发布中声称具备。当前管理页仍需登记已核实的 Union ID，不得按同名自动绑定。历史 TB→钉钉映射 API 返回 insufficient_scope，三人 TB 手机号均为空，未向钉钉发送手机号；余莉及吴潇靖通过本人扫码核验后才初始化。

## 环境及备份

- 工作区：`C:\Users\Administrator\.codex\worktrees\p01-p02-foundation-auth\project-manager`。原 `C:\Users\Administrator\Documents\ChatGPT\project-manager` 的历史修改保留，不重置、清理或复制混入本批。
- Node.js：`C:\Program Files\nodejs\node.exe`，v24.16.0。PostgreSQL 17.11 位于 F:\VikingPM，监听 127.0.0.1:55432。
- 业务库 vikingpm；集成测试库 vikingpm_p01p02_test；原环境检查库不改。数据库账号分别为 vikingpm_admin、vikingpm_migrator、vikingpm_app。
- 配置及核验证据仅存受限 F:\VikingPM\security；钉钉配置仍在 %LOCALAPPDATA%\VikingPM\dingtalk.env。先读凭证安全文档，读取函数只接收路径，不输出配置、身份标识、授权码、令牌或完整异常。
- 仅本机入口 http://127.0.0.1:4310/，登录已启用，余莉 owner、吴潇靖 viewer；陈雨萱未授予权限。临时核验端口43117已停止，不应当作后台入口。服务状态需要每次重新核对。
- 备份目标：\\fs.dianchu.cc\DC\产品中心\产品四部\维京\11.pm备份。Windows任务 VikingPM-Daily-Backup 每天北京时间21:00，已通过任务试跑及独立库恢复、内容摘要和共享副本哈希校验；首次21:00自然触发尚待观察。需电脑开机、当前Windows账号保持登录（锁屏可以）、PostgreSQL运行且共享盘可达。错过时条件满足后补跑，不主动唤醒，不发送通知。
- 任务依赖本工作区 scripts/Run-ScheduledBackup.ps1 及 backup-to-share.mjs；迁移或归档本工作区前，必须更新任务路径并试跑。每次仅清理本次新建且验证成功的恢复库，不自动删除历史备份或旧恢复库。保留期限及容量上限待明确。
- 备份排除有效会话和OAuth临时状态，不含角色密码、外部配置、证书私钥或应用源码。状态 F:\VikingPM\logs\backup-status.json 尚未接入后台页面；NAS ACL、异机全套恢复和真实业务负载未验，不代替P08/P12。

## 可复制的新会话启动文本

> 开始仓库 NINI-YUL/vikingard-project-manager 第一版 P03：版本纳入与来源绑定。先核对 codex/p01-p02-foundation-auth 分支的实际交付提交及远端状态；本批仅提交推送开发分支，未合并main，不要从尚不含本批代码的main直接开始。复用现有工作区 C:\Users\Administrator\.codex\worktrees\p01-p02-foundation-auth\project-manager，保留原旧工作区修改。
>
> 先读 AGENTS.md、docs/security/credential-handling.md、docs/development/p01-p02-handoff.md、docs/development/p01-p02-20261112.md、docs/development/shared-backup-20261113.md、docs/product/first-release-data-access-and-development-plan-20261112.md 和 docs/product/first-release-development-startup.md。以上交付状态区分已实现、技术检查、本机人工验收及内网未验，不重复询问已确认名单，不改总原型v2。
>
> P03 的受控测试版本尚未由用户指定。正式项目ID为5ef85324c8287a00238ada6b，但不要据此自动选择正式版本。先请用户提供测试版本名称、链接或ID；其余不依赖该输入的文档及代码阅读可继续。完成标准：版本纳入、来源绑定、同步起点、类型/分类/职能/父子关系识别、未知状态和结构缺失可定位，来源读取失败保留已有数据，不修改TB工作事实。
>
> 免费优先，不购买服务、不开放公网、不改正式TB或AI表格、不发送通知。复用F盘环境，P08首评、P12复测不提前宣称通过。每批先完成技术检查，再给具体人工验收入口、步骤及正确结果；进入新批次时主动提醒换会话，附实际提交、环境和遗留问题。
