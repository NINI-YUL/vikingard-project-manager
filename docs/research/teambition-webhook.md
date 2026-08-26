# Teambition 企业内部应用 Webhook 官方能力核对

> 核对日期：2026-08-26  
> 来源边界：仅使用 Teambition 官方开放平台文档与官方 GitHub SDK。本文不包含任何应用凭证、企业 ID、项目 ID 或任务 ID。

## 结论摘要

- 配置入口：开放平台应用后台的 **Webhook** 页面添加接收地址，再到 **应用事件** 页面选择事件；修改后必须发布，已安装企业还需安装最新版本。
- 订阅是企业级范围。任务类订阅会推送该企业内所有任务的相关变动，当前不能按项目缩小，消费端必须自行过滤。
- 官方验签文档明确给出：使用应用 Secret 对消息体计算 HMAC-SHA256，转十六进制后与 `X-Signature` 比较。Base64 模式下的验签/解码先后顺序没有公开说明，仍需实测。
- 接收端需在 5 秒内返回 HTTP 200。可选“不重试”或“持续重试”；关键同步应选持续重试，并保留周期对账。
- 官方只给出 HTTPS 示例，没有明确声明控制台强制 HTTPS，也没有明确写“必须公网域名”。地址在运行上必须能被 Teambition 服务端访问；生产采用公网可达 HTTPS 是工程结论。
- 回调长期不可用后会静默/停推。服务恢复可调用监听上报 API 重启，实际恢复可能延迟最多 30 分钟。

## 1. 配置入口与生效方式

官方流程：

1. 准备接收地址和报文解析能力，文档示例为 `https://www.consumer.com/helloworld`。
2. 进入开放平台开发者后台的对应应用，在 **Webhook** 页面添加接收地址。
3. 在 **应用事件** 页面选择要订阅的事件。
4. 发布应用。新安装企业使用已发布范围；已安装企业需安装最新版本才采用新范围。

来源：[企业自建应用 Webhook 信息推送的建立](https://open.teambition.com/docs/documents/5f59d997a41fa4001689158d)

### 订阅范围

官方明确说明，事件会被安装企业全企业范围内对应类别的所有对象变动触发。例如订阅任务事件后，企业内所有项目的相关任务变动都会推送。当前尚不支持逐资源订阅，必须在消费端按项目等条件过滤。

来源：[企业自建应用 Webhook 信息推送的建立](https://open.teambition.com/docs/documents/5f59d997a41fa4001689158d)

### 本项目相关的非弃用任务事件

- 生命周期：`v3.task.create`、`v3.task.archive`、`v3.task.unarchive`、`v3.task.remove`
- 内容与结构：`v3.task.content.update`、`v3.task.note.update`、`v3.task.parent.update`、`v3.task.project.update`
- 人员与时间：`v3.task.executor.update`、`v3.task.involveMembers.update`、`v3.task.startDate.update`、`v3.task.dueDate.update`
- 分类与流程：`v3.task.customfield.update`、`v3.task.scenariofieldconfig.update`、`v3.task.taskflowstatus.update`、`v3.task.sprint.update`、`v3.task.stage.update`

旧事件 `task.create`、`task.update`、`task.remove` 已在官方目录标为弃用。

来源：

- [Teambition 官方 Webhook 目录](https://open.teambition.com/docs/webhooks)
- [旧 task.update 的迁移页](https://open.teambition.com/docs/webhooks/63628b2a912d20d3b5667117)

## 2. 请求头、事件体与签名

官方列出的关键请求头：

- `X-Request-Id`：本次投递请求 ID
- `X-Request-Origin-Appid`：触发源应用 ID
- `X-Signature`：消息体签名
- `X-Tenant-Id`、`X-Tenant-Type`：事件所属租户
- `X-Trigger-From-Me`：是否由当前订阅应用触发

消息体含 `event`、`eventId`、`timestamp`、`hookId`、`orgId`、`data` 等。官方定义 `eventId` 为业务事件唯一 ID，适合作为幂等键；`X-Request-Id` 应作为投递追踪 ID 保留。

官方验签页给出：

```text
expected = hex(HMAC-SHA256(key = appSecret, message = body))
expected == X-Signature
```

接收器应保留收到的原始消息体用于验签，避免解析再序列化造成字节变化；比较值时应使用恒定时间比较。若开启 Base64 报文，请求会带 `Content-Transfer-Encoding: base64`，但官方未说明签名覆盖编码前还是编码后的消息体，因此顺序需用真实回调验证。

来源：

- [企业自建应用 Webhook 信息推送的建立](https://open.teambition.com/docs/documents/5f59d997a41fa4001689158d)
- [Webhook 请求合法性验证](https://open.teambition.com/docs/documents/5f0426cac1183f001a6f10c7)
- [Webhook 识别事件来源](https://open.teambition.com/docs/documents/64c9c90da96085002bf3881c)

## 3. 5 秒响应、重试与丢事件

成功条件是 5 秒内返回 HTTP 200。

### 不重试

超过 5 秒或返回非 200 后不再重试，失败事件直接丢失。

### 持续重试

- 按 2、4、8、16、32、64 秒等指数间隔重试，最大间隔不超过 30 分钟。
- 主 Webhook 建立文档写“最多持续 6 天”；单事件页面另有“超过 7 天会中断”的表述，官方资料存在 6/7 天冲突。实现不应依赖最后一天的精确边界，当前以专门重试策略的 6 天为基准。
- 旧事件重试期间如有新事件到达，会额外立即尝试一次旧事件，但不改变原重试计划。
- 重试期间新消息正常入队保留；回调被判定不可用后，该不可用期间的新消息会被丢弃。

接收器应执行：读取原始体 → 验签 → 以 `eventId` 去重并持久化/入队 → 立即返回 200 → 异步查询任务最新详情并更新 AI 表格。持续重试仍需周期对账补齐不可用窗口。

来源：

- [企业自建应用 Webhook 信息推送的建立](https://open.teambition.com/docs/documents/5f59d997a41fa4001689158d)
- [v3.task.create 事件页](https://open.teambition.com/docs/webhooks/6397e225912d20d3b53c29b5)

## 4. 心跳、静默与重启

官方说明：回调地址长时间不可用后会进入静默状态。监听服务恢复时，可调用监听上报 API 请求重启；从重启到实际恢复可能延迟最多 30 分钟。

官方 Go SDK 暴露：

```text
POST /api/webhook/v1/apps/{appId}/listen
Header: X-Tenant-Id（SDK 中为可选参数）
```

SDK 方法名是 `RestartWebhookListen`。官方没有给出固定心跳周期，也没有证明需要周期调用，因此现阶段应把它视为故障恢复动作，周期调用需求待实测。

来源：

- [消费者服务启动并开始监听上报 API](https://open.teambition.com/docs/apis/65a0ba1865a529002b97eefa)
- [Teambition 官方 Go SDK：api_webhook.go](https://github.com/teambition/openapi-sdk-golang/blob/master/api_webhook.go)
- [如何查询 Webhook 推送日志](https://open.teambition.com/docs/documents/664ff601eb316936dd850b1a)

## 5. 是否必须公网 HTTPS

### 官方已确认

- Teambition 通过 HTTP POST 主动请求配置的回调地址。
- 官方示例使用 HTTPS。
- 官方提供 `GET /api/webhook/ips` 查询 Webhook 出口 IP/IP 网段，并建议每日更新，不要长期依赖旧白名单。

来源：

- [企业自建应用 Webhook 信息推送的建立](https://open.teambition.com/docs/documents/5f59d997a41fa4001689158d)
- [获取 Webhook 出口 IP 列表 API](https://open.teambition.com/docs/apis/63ec5732ccca5b002ad4052a)
- [Teambition 官方 Go SDK：api_webhook.go](https://github.com/teambition/openapi-sdk-golang/blob/master/api_webhook.go)

### 工程推论与未验证项

Teambition 服务端必须能访问回调入口，因此 `localhost` 或仅局域网地址通常不可用；测试可用安全隧道把公网入口转到本地服务。生产建议使用公网可达 HTTPS。

但官方公开文档没有明确写：

- 必须是公网域名；
- 控制台只接受 HTTPS、拒绝 HTTP；
- 允许的证书类型或端口。

这些约束需在控制台保存回调 URL 时实测。

## 6. Issue #16 的最小测试建议

1. 选择“持续重试”。
2. 首批只订阅上述必需的非弃用 `v3.task.*` 事件。
3. 先按项目 ID 过滤企业级事件，避免触碰生产项目。
4. 记录 `eventId`、`X-Request-Id`、事件类型、接收时间、验签结果和处理状态，不记录 Secret 或 Token。
5. 人为制造一次非 200/超时，验证重试、幂等和恢复。
6. 用归档、恢复、删除、状态、父子关系、自定义字段和隐私任务变更复测。
7. 保留周期 API 对账，覆盖停推期间可能丢消息的窗口。

## 7. 仍需实测

- 控制台是否强制 HTTPS，以及证书/端口限制。
- Base64 模式下的验签与解码顺序。
- 相同 `eventId` 重试时 `X-Request-Id` 是否变化。
- 不同事件是否严格有序；在未验证前按“可能乱序”设计，以拉取最新详情收敛。
- 重启接口的权限名、实际恢复耗时和是否需要周期调用。

