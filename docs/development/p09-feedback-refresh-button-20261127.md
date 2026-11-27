# P09 顶部获取最新反馈按钮

日期：2026-11-27。分支：codex/p09-risk-feedback。

## 行为

- 获取最新TB旁新增“获取最新反馈”，沿用管理员／所有者权限；查看者隐藏。两个按钮作为一组在响应式换行时保持相邻。
- 读取顶部所选版本；全部活跃版本逐版本执行。每个版本读取其所有已启用、已确认来源，不使用任意固定来源、不自动创建配置。
- 复用现有GET /api/feedback/versions/:id获取来源、POST /api/feedback/read读取并重新核对TB事实、事务入库、资格校验与审计。GET overview沿用既有重校验行为，本批未新增后端读取接口。
- 获取期间两个按钮互相禁用；完成后清除版本、管理事实和任务缓存，重新渲染页面。来源记录数包含已存在提交，不声明新增条数。
- 未配置来源、读取失败、部分成功和权限失效均保留明确提示；不自动重试未知结果，不绕过风险说明人工复核。
- 本批不启用自动读取反馈，不发送通知、不写TB或外部表格，不需要数据库迁移。

## 文件

- app/public/index.html：按钮与同组容器。
- app/public/shell.js：权限显示、版本范围、读取流程、互斥与缓存刷新。
- app/public/shell.css：仅为新增按钮调整工具栏换行与同组排布；风险模块视觉样式未改。
- scripts/p09-shell-browser-check.cjs：隔离浏览器夹具覆盖权限、CSRF、单／全部版本、停用来源、未配置、部分失败和三视口。
- docs/development/p09-action-risk-v2-review-20261127.md：待确认的视觉差异清单，确认后另行最小修改。

## 验证结果

- node --check app/public/shell.js：通过。
- node --test tests/p09-shell.test.mjs tests/p09-risk.test.mjs：23通过，0失败，0跳过。
- VIKINGPM_TEST_CONFIG指向既有隔离测试库，运行tests/p06-feedback.test.mjs及tests/feedback-review-ui.test.mjs：通过。
- scripts/p09-shell-browser-check.cjs：通过。新增夹具检查单／全部版本、停用来源、缺少来源、部分503失败、按钮互斥和权限；375/768/1440下按钮同排相邻，无页面水平溢出。现有V2计算样式、实际字体加载、控制台、配置、实际时间和下钻验证继续通过。
- 截图：F:/VikingPM/logs/p09-feedback-button-browser-20261127。
- 本地4310入口返回200且已提供新按钮HTML；静态文件改动刷新即可加载，无需重启或迁移。
- 未使用真实会话提交反馈读取；本次浏览器写请求全部为隔离夹具，不宣称三条真实提交已入库。
