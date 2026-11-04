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

2026-11-02：已同步确认的配置库功能对齐与 D 版样式，包括规则继承编辑、状态映射与恢复验证、PM 通知规则及实际时间修正等必要联动。配置库采用各页编辑窗口保存，取消旧通用草稿发布。默认首页不变；配置库 `?page=config`，规则 `?page=rules`，工作单 `?page=workitem`。人力参与度和历史查询独立视觉预览未合入。

配置库浏览器验证：`node docs/prototypes/total-prototype-v2/verify-config.cjs`。功能验证：`node --test docs/prototypes/total-prototype-v2/rules-config-prototype.test.mjs docs/prototypes/total-prototype-v2/status-mapping-prototype.test.mjs docs/prototypes/total-prototype-v2/workitem-time-prototype.test.mjs`。本次不提交、不推送。

2026-11-02：已同步人力参与度与历史查询的最终 D 版预览。参与度年度使用最终浅蓝/浅紫/浅灰色带，月度保持第一版；历史查询保留版本—需求三层下钻及全部字段。参与度 `?page=participation`，历史 `?page=history`；复核：`node docs/prototypes/total-prototype-v2/verify-participation-history.cjs`。本次已获提交和推送授权，包含前次确认的配置库补齐。

2026-11-04：已同步确认的三组配置库最终视觉与文案（版本与规则、状态语义、人员与通知），保留全部原业务校验与其他页面。规则 `?page=rules`；恢复 `?page=config&statusTab=impact`；人员 `?page=config&peopleTab=people`；通知 `?page=config&peopleTab=notice`。新增复核：`verify-config-style.cjs`、`verify-rules-editor.cjs`、`verify-rules-feedback.cjs`，均可在本目录直接随 index.html 运行。

2026-11-04：已同步 action-data-audit-20261104 确认预览。数据待处理展示摘要，异常与审计统一事项、处理和记录；按异常编号计数，工单去重。状态映射保存后待验证，模拟恢复成功后两页同步移出，审计保留。保留正式名称、默认风险与到期首页及完整导航，不含预览横幅。直达数据页 `?variant=A&actionTab=data`；复核 `node docs/prototypes/total-prototype-v2/verify-action-data-audit.cjs`。仅本地同步，未提交、未推送。

2026-11-04：已同步 table-headers-d-20261104 最终确认预览。风险关注与异常/审计表头沿用 D 版浅灰蓝背景、字体、行高、内边距、分隔线和 5px 端部圆角。风险表格使用分离边框；桌面宽度不低于 1100px 时适应卡片内容区，避免最小宽度裁掉右侧圆角，窄屏保留横向滚动。全部字段、数量、展开及处理入口保持不变；不包含预览横幅。
