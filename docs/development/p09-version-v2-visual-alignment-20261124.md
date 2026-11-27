# P09：版本页 V2 视觉对齐

日期：2026-11-24。用户已确认先前差异清单及保留项。本轮仅调整已实现版本页视觉，P09 整批仍未完成，未合并 main。

## 视觉来源与范围

实际基准为本机 4210 服务加载的主工作区 `docs/prototypes/total-prototype-v2/`。该目录与 P09 工作区中的旧副本不同，不能混用。已核对实际加载的 Token、sample.css、refined.css、light.css、versions.css 和后续覆盖样式，并用浏览器计算样式确认最终值。

原型 index.html SHA-256：`F36714CC013F952389737C556F2EDC245DC469FB2ACA8C6E3D8228265226CF9C`。正式原型保持不变，未使用技能默认值覆盖 V2。

## 修改

- `app/public/shell.css`：版本侧栏 164px、桌面主辅区 65:35、间距 18px；对齐 V2 字体、文字层级、颜色、卡片、表格、标签、时间线、图标描边和响应式样式。共享外壳改动由版本页作用域限制，离开版本页恢复原样式。
- `app/public/shell.js`：仅根据既有路由增加或移除 `version-page` 样式类；接口、数据计算、权限与导航逻辑不变。
- `app/public/assets/jakarta-{400,500,600,700}.ttf`：复用 V2 四个本地字体文件。中文保持系统字体回退，禁止字体合成。
- `app/server.mjs`：静态白名单加入四个明确字体路径及 font/ttf；CSP 仅增加 `font-src 'self'`，不允许外部字体来源。
- `tests/p09-shell.test.mjs`：验证字体无需登录、无需读取数据库即可加载，响应 MIME、字节及 CSP 正确。
- `scripts/p09-shell-browser-check.cjs`：复用真实应用静态服务与 CSP，业务 API 仍使用隔离夹具。覆盖三个视口、字体实际渲染、V2 计算样式对比及现有交互。

## 保留的差异

- 保留版本选择与“获取最新TB”、功能验收入口及原有文案，不换成原型演示操作。
- 保留两行模块关系：核心需求 / 管理信号、任务详情 / 最近变化；中屏保持正式页既有模块顺序。
- 任务详情初次默认收起，搜索、分页、下钻及稳定深链接不变。完整 Viking 编号保留；阶段职能说明允许换行，表格在自身容器滚动。
- 手机继续展示横向版本列表，不改成原型的折叠隐藏行为。
- 正式应用顶栏保留现有粘性定位，版本侧栏保留与该顶栏匹配的偏移，防止滚动遮挡。
- V2 没有同款折叠任务模块或内嵌任务面板。仅沿用其卡片、表格、控件及字体规则，不宣称这两处已逐像素匹配。

## 验证

- 设置 `VIKINGPM_TEST_CONFIG=F:\VikingPM\security\integration-test.json` 后运行 `node --test --test-reporter=spec tests/*.test.mjs scripts/*.test.mjs`：115 项通过，0 失败，0 跳过，使用隔离测试库。
- 设置 `PLAYWRIGHT_MODULE`、`VIKINGPM_V2_ORIGIN=http://127.0.0.1:4210/`、`VIKINGPM_BROWSER_OUTPUT` 后运行 `node scripts/p09-shell-browser-check.cjs`：375px、768px、1440px 的 69 组组件计算样式与 V2 一致，覆盖任务列表展开状态；页面无水平溢出，宽表在容器内部滚动。
- 浏览器验证字体请求成功、标题实际使用 Jakarta 自定义字体、路由离开后取消视觉作用域；版本切换、侧栏折叠、任务收起/展开、搜索、分页、深链接、需求入口、同步权限及配置预览等现有检查通过。
- 正常流程无意外控制台错误或未处理 JavaScript 异常。失败与会话过期场景主动模拟的 503/401 单独核对，未将其误报为普通页面错误。
- `node --check app/public/shell.js`、`node --check app/server.mjs`、`node --check scripts/p09-shell-browser-check.cjs`、`git diff --check` 通过。
- 本机应用已重启。4310 healthz、入口、功能验收及四个字体路径均返回 200；本地字体 CSP 已生效。

## 验收边界

真实用户登录后的业务数据点击验收仍需用户确认。隔离截图和自动检查不替代真实业务验收，也不表示风险需求聚合等“待接入”功能已完成。

P09 实际时间修正、日历外补录、完整异常闭环等剩余工作，以及 P08/P12 长期观察和真实来源时效验收继续保留。未修改正式 TB，未写外部 AI 表格，未发送通知，未开放公网，未移动或归档工作区。合并 main 需另行授权。