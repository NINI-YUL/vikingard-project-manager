# 钉钉 AI 表格 API 调研

日期：2026-08-28

## 关键结论

- 任务主数据与反馈数据分层：Teambition 是工单 ID、任务标题等任务事实的权威来源；AI 表格只保存表单提交及反馈历史。生成表单链接时只需工单 ID，系统应读取 Teambition 当前标题后再写入预填参数；提交校验时再次读取 Teambition，不能以 AI 表格中的标题替代。

- 后台同步优先用**企业内部应用 access token**，通过 `x-acs-dingtalk-access-token` 调用 AI 表格。官方称企业应用 token 用于服务端 API 获取应用资源；第一方 SDK `notable_2_0` 的接口均声明该请求头。[应用 token][org-token] [SDK 类型][sdk-types] [SDK 实现][sdk-client]
- 用户 OAuth token 不是后台同步的默认必需项，只在用户授权或识别当前用户时使用。`notable_2_0` 不要求旧版 `operatorId`，定时同步不应依赖人工 OAuth。[用户 token][user-token] [SDK 实现][sdk-client]
- 最小权限为 `Notable.Base.Read.All` 和 `Notable.Base.Write.All`。钉钉官方公开权限目录当前只登记了这两个 AI 表格权限，并把“获取所有数据表”等读取接口映射到 `Notable.Base.Read.All`；没有登记可单独申请的 `Notable.Base.Read`。因此控制台只显示 `.Read.All` 是当前平台目录的正常结果，不是搜索方式错误。[官方权限目录][official-scope-list] [官方 API 目录][official-api-list]
- 官方只明确 `baseId` 是必填路径参数/多维表 ID，未找到分享链接固定片段必然等于 baseId 的第一方说明。PoC 应取得候选值后调用获取所有表接口校验。[获取所有表][get-sheets]
- 人员字段格式为 `[{"uid":"..."}]`，不能写姓名或手机号。官方未明确这里的 `uid` 等同 `userId` 还是 `unionId`，必须实测，并维护两者映射。[SDK 类型][sdk-types] [unionId 转 userId][union-to-user]

## 鉴权流程

```text
Client ID + Client Secret
  -> 企业内部应用 access token
  -> x-acs-dingtalk-access-token: <token>
  -> /v2.0/notable/...
```

官方明确企业内部应用调用 token 接口获得 `access_token`，服务端 API 用它鉴权。[应用 token][org-token] 第一方 SDK 把 `xAcsDingtalkAccessToken` 转为 HTTP 头 `x-acs-dingtalk-access-token`。[SDK 类型][sdk-types] [SDK 实现][sdk-client]

SDK 元数据的 `authType: "AK"` 不表示本项目需购买阿里云 AccessKey；公开方法实际仍传钉钉 access-token 请求头。[SDK 实现][sdk-client]

用户 OAuth 是独立流程。[用户 token][user-token] Notable 2.0 不含 `operatorId`，后台同步先用企业应用 token。实际 PoC 已成功取得应用 token，但首次 `GET .../sheets` 返回 403。该结果只能证明请求到达资源鉴权阶段，不能单独区分“baseId 错误”“Base 未授权给应用”或“必须用户 OAuth”。尚未找到官方给出的 Base 侧企业应用授权 UI 路径；下一步应先核验 baseId，并在协作者面板搜索测试应用/机器人，搜索不到时不要盲目操作，再验证用户 OAuth。

## Base、表和字段标识

`baseId` 是所有 Notable API 的首个路径参数，旧版官方目录描述为“多维表 id”。[获取所有表][get-sheets] 当前没有第一方依据支持从任意分享链接按固定位置解析。应从页面或浏览器请求取得候选值，调用 `GET /v2.0/notable/bases/{baseId}/sheets`，确认返回两张 PoC 表；成功后将 baseId 作为显式配置保存。

SDK 支持 `sheetIdOrName`，字段接口支持 `fieldIdOrName`。[SDK 实现][sdk-client] 名称适合 PoC，生产建议保存接口返回 ID，减少重命名影响；ID 跨重命名是否稳定仍须实测。

## Notable 2.0 API

主机为 `https://api.dingtalk.com`，请求携带 `x-acs-dingtalk-access-token`。[SDK 实现][sdk-client]

| 目的 | 方法与路径 | 请求/响应 | 权限 |
|---|---|---|---|
| 列出表 | `GET /v2.0/notable/bases/{baseId}/sheets` | 返回 `value[]`，含 `id/name` | `Notable.Base.Read.All` |
| 获取表 | `GET /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}` | 返回 `id/name` | `Notable.Base.Read.All` |
| 列出字段 | `GET /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}/fields` | 返回 `value[]`，含 `id/name/type/property` | `Notable.Base.Read.All` |
| 列出记录 | `GET /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}/records` | 查询 `maxResults/nextToken`；返回 `records/hasMore/nextToken` | `Notable.Base.Read.All` |
| 获取记录 | `GET /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}/records/{recordId}` | 返回 `id/fields` | `Notable.Base.Read.All` |
| 新增记录 | `POST /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}/records` | `{"records":[{"fields":{...}}]}` | `Notable.Base.Write.All` |
| 更新记录 | `PUT /v2.0/notable/bases/{baseId}/sheets/{sheetIdOrName}/records` | `{"records":[{"id":"...","fields":{...}}]}` | `Notable.Base.Write.All` |

路径和模型来自第一方 SDK；开放平台页面确认权限点和含义。[SDK 类型][sdk-types] [SDK 实现][sdk-client] [获取字段][get-fields] [列出记录][list-records] [新增记录][insert-records] [更新记录][update-records]

新增示例：

```json
{"records":[{"fields":{"任务标题":"PoC 任务","Teambition工单ID":"TB-TEST-001","进度百分比":20}}]}
```

更新示例：

```json
{"records":[{"id":"接口返回的recordId","fields":{"进度百分比":50}}]}
```

SDK 将 `fields` 定义为开放字典，没有每种字段的完整 JSON Schema；单选、日期、人员必须逐项 PoC。[SDK 类型][sdk-types]

## 人员字段和身份映射

官方示例为 `[{"uid":"1234567"},{"uid":"2345678"}]`。同一示例确认文本写字符串、数字写数值、单选可写选项 ID 或名称、日期可写毫秒时间戳或日期时间字符串。[SDK 类型][sdk-types]

建议保存 Teambition 身份、钉钉 `userId`、`unionId` 和 AI 表格实际接受的 `uid`；钉钉提供按 `userId` 查询详情及 `unionId -> userId` 接口。[用户详情][user-detail] [unionId 转 userId][union-to-user] PoC 应分别尝试候选标识并回读；未映射时记录异常并通知管理员，不猜测。

## 权限、限制和费用

- 应用获批不等于能读取任意表格；仍要限制表格协作范围，并以 API 返回验证。
- `Contact.User.Read`、`open_app_api_base` 不是 AI 表格基本读写权限，只在身份/OAuth 确实需要时启用。
- 1.0 官方目录多数 Notable 接口标 `maxQps=100`，列出记录为 `200`；2.0 SDK 没公布同等数字，不能假设继承。生产要限速、重试并记录 429。[列出记录][list-records] [获取所有表][get-sheets]
- 列表使用 `nextToken` 分页，必须循环到 `hasMore=false`。[SDK 类型][sdk-types]
- 官方公开资料未确认最大页大小、Base 行数、人员字段人数上限，也没有可靠的免费额度或单独定价说明，因此**不能承诺免费或无限**。出现升级、购买或额度不足提示时必须停止并确认费用。
- 权限审批不等于收费；正式应用仍需重新申请和发布，测试应用权限不会自动迁移。

## PoC 验收清单

### 2026-08-28 实测记录

本轮对测试企业内部应用和测试 AI 表格完成了以下验证：

- 企业内部应用 token 可以成功取得；
- 使用该 token 调用 Notable `GET` 接口时返回 `Forbidden.AccessDenied.AccessTokenPermissionDenied`；
- 开放平台权限页面和已发布版本均确认包含 `Notable.Base.Read.All`；
- 先后取得基础 OAuth 用户 token，以及显式请求 `scope=openid Notable.Base.Read.All` 的用户 token，两种 token 调用同一 Notable 接口仍返回相同 403；
- AI 表格协作者面板中搜索不到测试应用或机器人，当前没有可验证的“把应用加入 Base 协作者”入口；
- Base 页面 URL 形式为 `alidocs` 的 `/i/nodes/<32位ID>`，但没有第一方依据证明该 32 位节点 ID 就是 Notable API 所需的 `baseId`。
- 用户已确认测试应用与测试 AI 表格属于同一企业；本机凭证中的 `DINGTALK_CORP_ID` 已设置且非空（本报告不记录实际值），因此可以排除应用与 Base 分属不同企业导致的访问失败。

因此，本轮可以排除：Client ID/Secret 无法换取 token、用户没有完成 OAuth 同意、AI 表格读权限未加入已发布版本。仍不能仅凭当前错误区分“应用类型不被 Notable 接口支持”“平台侧权限尚未真正开通”或“使用了错误的 baseId”。下一步应核对应用类型及钉钉平台侧权限开通状态，并从官方页面或支持渠道确认真实 baseId；在获得第一方依据前不继续猜测 URL、资源授权入口或 token 类型。

#### 主机、请求头与权限名对照

为排除 token 取得方式、API 主机和请求头差异，又完成了以下对照：

- 旧版 `gettoken` 使用 `appkey` / `appsecret` 可以成功取得 token，进一步排除了应用凭证本身无效；
- 请求 `api.dingtalk.com/v2.0/notable/...` 但仅使用 `Authorization: Bearer ...` 时，返回 `AuthenticationFailed.MissingParameter`，错误明确指出缺少 `x-acs-dingtalk-access-token`；这与钉钉第一方 SDK 的实现一致；
- 请求 `oapi.dingtalk.com/v2.0/notable/...` 并使用 Bearer 时，HTTP 状态虽然为 200，但业务响应为 `errcode=404`、`errmsg=请求的URI地址不存在`，说明该主机没有当前 Notable 2.0 路由；
- 因此，外部建议的“`oapi.dingtalk.com` + Bearer”不适用于当前 Notable 2.0。当前有第一方依据的组合仍是 `api.dingtalk.com` + `x-acs-dingtalk-access-token`。[SDK 实现][sdk-client]

使用正确主机和请求头后，网关错误继续要求权限 `Notable.Base.Read`，但开放平台权限页能够申请且已开通的权限只有 `Notable.Base.Read.All`；错误中的直达补权链接也只会跳回 `.All` 权限。当前资料无法解释网关要求的权限名与控制台可申请权限名不一致。这一现象已超出本地配置可验证范围，应提交钉钉官方技术工单，请其确认 Notable 2.0 的权限映射或网关配置；在官方回复前不应反复改 token、切换主机或申请无关权限。

#### `Notable.Base.Read` 与 `.Read.All` 不一致的官方证据和处理路径（2026-09-10）

进一步核对钉钉第一方公开元数据后，可以确认这不是用户漏配权限：

- 钉钉官方公开权限目录 `/api/official/scope/list` 只返回 `Notable.Base.Read.All`（“AI 表格应用读权限”）和 `Notable.Base.Write.All`，没有返回 `Notable.Base.Read`；其中读取权限明确关联“获取所有数据表、获取数据表、获取所有字段、获取记录、列出多行记录”。[官方权限目录][official-scope-list]
- 钉钉官方 OpenAPI 目录把“获取所有数据表”标识为 `notable_1.0#GetAllSheets`，所需 scope 是 `Notable.Base.Read.All`，企业内部应用（`ORG`）状态为 `FULLY_OPEN`；同一条元数据把 `operatorId` 标为必填查询参数。[官方 API 目录][official-api-list]
- 钉钉第一方 Node.js SDK `@alicloud/dingtalk@2.2.46` 的 Notable 1.0 实现调用 `GET /v1.0/notable/bases/{baseId}/sheets`，传 `operatorId`，并使用 `x-acs-dingtalk-access-token`；Notable 2.0 实现调用 `GET /v2.0/notable/bases/{baseId}/sheets`，不传 `operatorId`，但 SDK 源码不声明 scope。[1.0 SDK 实现][sdk-client-v1] [2.0 SDK 实现][sdk-client]

由此可见，公开权限目录和可申请权限与 **Notable 1.0** 是一致的，而实测 **Notable 2.0** 网关要求一个官方权限目录中不存在的 `Notable.Base.Read`。现有第一方资料不足以证明 `.Read.All` 应自动包含 `.Read`，也没有合法入口可以单独申请 `.Read`；不能继续靠猜测权限、重建应用或申请无关权限解决。

当前可执行路径：

1. 保留已开通并已随版本发布的 `Notable.Base.Read.All`，不要删除或替换。
2. 先做一次只读兼容验证：用同一企业内部应用 token 和 `x-acs-dingtalk-access-token` 调用 `GET /v1.0/notable/bases/{baseId}/sheets?operatorId={当前操作者unionId}`。`operatorId` 必须使用能够访问该 AI 表格的钉钉用户身份；不要在日志或文档中记录 token。
3. 若 1.0 成功，PoC 先使用官方目录明确支持的 Notable 1.0 读取链路；同时把升级到 2.0 作为平台权限映射问题保留，不阻塞当前只读验证。
4. 若 1.0 仍返回权限拒绝，记录响应中的错误码和 `requestId`，连同以下证据提交钉钉官方工单：应用类型为企业内部应用、`.Read.All` 已开通并发布、官方权限目录映射为 `.Read.All`、1.0 与 2.0 的完整请求路径（脱敏）、两个响应的错误码与 `requestId`。请求官方确认该企业/应用是否开通 Notable 能力，以及 2.0 网关为何要求未公开的 `.Read`。
5. 按错误类型分流：`operatorId`/身份错误先核对 unionId 和该用户对 Base 的访问权；资源不存在再核对 `baseId`；只有权限拒绝才归入权限映射问题，避免把不同故障混在一起。

2026-09-10 已完成真实环境只读验证：使用能够访问测试 AI 表格的用户 `unionId` 作为 `operatorId`，同一企业内部应用 token 调用 Notable 1.0 获取所有数据表返回 HTTP 200，并识别到测试 Base 中 4 张数据表。验证过程未记录 token、用户标识或表格内容。由此确认 `.Read.All` 在 1.0 链路生效，当前 32 位候选值可作为该测试 Base 的 `baseId`。PoC 采用 1.0 读取链路；2.0 权限映射异常作为平台兼容问题保留，不再阻塞只读实现。

阶段 5（OAuth 授权及表、字段、记录和人员字段验证）当前记为**部分完成**：应用 token、用户 OAuth、企业归属、权限发布、请求格式、测试 Base 标识及 Notable 1.0 数据表读取已完成验证；记录字段结构、写入及人员字段仍待后续受控验证。Notable 2.0 权限映射异常不再阻塞当前只读 PoC。

1. 用企业应用 token 调用 `GET .../sheets`；失败时记录错误码，不先引入 OAuth。
2. 确认两张测试表及 sheet ID，列出字段并核对 ID、名称、类型。
3. 新增一条文本/数字记录并回读；按 recordId 更新，确认不重复新增。
4. 验证单选、日期、人员字段，确认人员 `uid` 的真实标识类型。
5. 用 `nextToken` 验证分页并记录实际限流。
6. 未出现付费提示只表示本次 PoC 未触发费用，不推导正式环境永久免费。

## 官方来源

[org-token]: https://open.dingtalk.com/document/orgapp/obtain-orgapp-token
[user-token]: https://open.dingtalk.com/document/orgapp/obtain-user-token
[sdk-types]: https://unpkg.com/@alicloud/dingtalk@2.2.46/dist/notable_2_0/client.d.ts
[sdk-client]: https://unpkg.com/@alicloud/dingtalk@2.2.46/src/notable_2_0/client.ts
[sdk-client-v1]: https://unpkg.com/@alicloud/dingtalk@2.2.46/src/notable_1_0/client.ts
[official-scope-list]: https://open.dingtalk.com/api/official/scope/list
[official-api-list]: https://open.dingtalk.com/api/backstage/getOpenApiList?pageNo=1&pageSize=20&keywords=%E8%8E%B7%E5%8F%96%E6%89%80%E6%9C%89%E6%95%B0%E6%8D%AE%E8%A1%A8
[get-sheets]: https://open.dingtalk.com/document/orgapp/api-notable-getallsheets
[get-fields]: https://open.dingtalk.com/document/orgapp/api-noatable-getallfields
[list-records]: https://open.dingtalk.com/document/orgapp/api-notable-listrecords
[insert-records]: https://open.dingtalk.com/document/orgapp/api-notable-insertrecords
[update-records]: https://open.dingtalk.com/document/orgapp/api-noatable-updaterecords
[user-detail]: https://open.dingtalk.com/document/orgapp/query-user-details
[union-to-user]: https://open.dingtalk.com/document/orgapp/query-a-user-by-the-union-id
