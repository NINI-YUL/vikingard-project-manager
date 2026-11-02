# 总原型 v2

保存日期：2026-11-01。

入口：`index.html`。启动：在项目根目录运行 `node docs/prototypes/total-prototype-v2/serve.cjs`。

- 首页：`http://127.0.0.1:4210/?variant=A`。
- 数据待处理：`http://127.0.0.1:4210/?variant=A&actionTab=data`。
- 样式、脚本和字体均在本目录内，复制或备份时保留整个目录。

产品基准与后续流程见 `../../product/total-prototype-v2-baseline.md`。

本目录保存已经用户确认的整合版本。后续调优从本目录复制到独立的 `docs/previews/` 目录；不得直接在本目录试改。用户确认具体效果后，才能同步对应改动并验证。

原型使用内存中的演示数据，没有持久化、真实鉴权或 Teambition / 钉钉连接。

2026-11-02：已同步确认的版本页 D 版样式，桌面需求区与管理信号区域按 65:35 展示；移除底部 ABC 切换条。默认仍为行动中心，通过左侧版本入口进入版本页。

2026-11-02：已同步确认的需求页 D 版样式，包括总览、按日时间线、其他直属工作单及对应浮层。默认仍为行动中心，通过左侧需求入口或版本页需求名称进入。复核命令：`node docs/prototypes/total-prototype-v2/verify-requirements.cjs`，需要 Playwright 与 Chrome；可通过 `CHROME_PATH` 指定浏览器。

2026-11-02：已同步确认的人员页 D 版，以及行动中心标题、风险明细默认展开、移除逾期区间示意、逾期天数紫底白字和风险工单执行人名称。查看完整历史保留现有演示边界。验证：`node docs/prototypes/total-prototype-v2/verify-personnel-action.cjs`。
