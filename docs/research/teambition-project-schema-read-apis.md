# Teambition 项目 Schema 只读接口核对

> 核对日期：2026-08-27
> 来源边界：仅使用 Teambition 官方开放平台文档站公开元数据与 Teambition 官方 GitHub SDK 中的 OpenAPI 定义。未读取或使用本机凭证、企业 ID、项目 ID、任务 ID 及任何任务数据；未调用任何项目。

## 结论

- 公有云 Open API 基础地址是 `https://open.teambition.com/api`。
- 权限名中的 `list` 是权限动作名，不是 URL 尾段。工作流、状态与迭代接口均以 `/search` 结尾。
- `/api/v3/project/taskflow/list` 不是官方 OpenAPI 路由：它缺少 `/{projectId}`，并把官方 `/search` 错写为 `/list`。其 `421 MisdirectedRequest` 不应解释为权限不足，后续验证应排除此路径。
- 工作流、工作流状态、迭代、项目自定义字段、项目成员和项目任务类型/场景字段配置均有 `GET` 只读接口。

基础地址来源：[Teambition 官方 Go SDK OpenAPI 定义](https://github.com/teambition/openapi-sdk-golang/blob/master/api/openapi.yaml)。

## 通用参数位置

六个接口均要求：

| 参数 | 位置 | 要求 |
| --- | --- | --- |
| `Authorization` | Header | 必填，`Bearer <appAccessToken>` |
| `X-Tenant-Id` | Header | 必填，企业租户 ID |
| `X-Tenant-Type` | Header | 必填，当前为 `organization` |
| `projectId` | Path | 必填，嵌入 `/{projectId}/` |

`x-operator-id` 是工作流、工作流状态和项目成员接口的可选 Header。本文只记录参数位置，不记录任何真实值。

## 可直接用于只读验证的接口

以下路径均拼接在 `https://open.teambition.com/api` 后：

| 读取内容 | 所需权限 | 方法与路径 | 可选 Query / Header | 官方来源 |
| --- | --- | --- | --- | --- |
| 项目工作流 | `tb-core:project.taskflow:list` | `GET /v3/project/{projectId}/taskflow/search` | Query：`q`、`pageSize`、`pageToken`、`tfIds`；Header：`x-operator-id` | [搜索项目工作流](https://open.teambition.com/docs/apis/6321c6d1912d20d3b5a49fc3) |
| 项目工作流状态 | `tb-core:project.taskflowstatus:list` | `GET /v3/project/{projectId}/taskflowstatus/search` | Query：`q`、`pageSize`、`pageToken`、`tfIds`、`tfsIds`；Header：`x-operator-id` | [搜索项目工作流状态](https://open.teambition.com/docs/apis/6321c6d1912d20d3b5a4a142) |
| 项目迭代 | `tb-core:project.sprint:list` | `GET /v3/project/{projectId}/sprint/search` | Query：`q`、`pageSize`、`pageToken`、`sprintIds` | [迭代搜索](https://open.teambition.com/docs/apis/6397f1dc912d20d3b572dc9d) |
| 项目自定义字段 | `tb-core:project.customfield:list` | `GET /v3/project/{projectId}/customfield/search` | Query：`scope`、`q`、`pageSize`、`pageToken`、`sfcId`、`cfIds`、`instanceIds`、`originalIds`、`subtype` | [搜索项目自定义字段](https://open.teambition.com/docs/apis/6321c6d0912d20d3b5a497f6) |
| 项目成员 | `tb-core:project.member:list` | `GET /v3/project/{projectId}/member` | Query：`userIds`、`projectRoleId`、`pageSize`、`pageToken`；Header：`x-operator-id`。旧参数 `limit`、`skip` 已弃用 | [获取项目成员列表](https://open.teambition.com/docs/apis/6321c6d0912d20d3b5a49906) |
| 任务类型及场景字段配置 | `tb-core:project.sfc:list` | `GET /v3/project/{projectId}/scenariofieldconfig/search` | Query：`sfcIds`、`q`、`pageToken`、`pageSize`、`objectTypes`、`sources` | [获取项目任务类型](https://open.teambition.com/docs/apis/6321c6d1912d20d3b5a49cc4) |

## 分页规则与响应字段

除项目工作流外，另外五个接口的官方响应 Schema 均在顶层声明 `nextPageToken`。请求第一页时不传 `pageToken`；响应的 `nextPageToken` 非空时，把它原样作为下一次请求的 Query `pageToken`；为空或缺失时停止。项目自定义字段响应还含顶层 `total`。

项目工作流接口虽然接受 Query `pageSize` 和 `pageToken`，但当前官方响应 Schema 只声明 `result`、`code`、`errorMessage`、`requestId`，未声明 `nextPageToken`。实现不得臆造游标；若真实响应也没有游标，应设置足够的 `pageSize` 并记录这一官方元数据缺口，必要时向 Teambition 确认。

各接口 `result[]` 的官方字段如下：

- 工作流：`id`、`name`、`boundToObjectId`、`boundToObjectType`、`proTemplateConfigType`、`creatorId`、`isDeleted`、`created`、`updated`、`setting`。
- 工作流状态：`id`、`name`、`pos`、`taskflowId`、`rejectStatusIds`、`kind`、`creatorId`、`originalId`、`isDeleted`、`isTaskflowstatusruleexector`、`created`、`updated`。
- 迭代：`id`、`name`、`executorId`、`description`、`status`、`projectId`、`creatorId`、`startDate`、`dueDate`、`accomplished`、`created`、`updated`、`payload`、`labels`。
- 自定义字段：`id`、`name`、`type`、`subtype`、`boundToObjectId`、`boundToObjectType`、`originalId`、`creatorId`、`choices`、`created`、`payload`、`advancedCustomfield`。
- 成员：`id`、`userId`、`role`、`roleIds`。
- 任务类型/场景字段配置：`id`、`name`、`icon`、`type`、`scenariofields`、`creatorId`、`source`、`created`、`boundToObjectId`、`boundToObjectType`、`taskflowId`、`originalId`、`isArchived`。

来源：上表六个官方接口页及其同源公开元数据 `/docs/api/doc/apiInfo/{文档条目 ID}`。

## 字段与任务类型的读取语义

项目自定义字段接口的 `scope` 支持 `taskTableHeader`、`searcherAdd`、`taskExportHeader`、`sfcAdd`、`kanbanCardAdd` 和 `all`；`all` 为默认值。Schema 核对建议显式传 `scope=all`。

任务类型接口的官方摘要为“获取项目任务类型”。响应条目包含任务类型信息、`taskflowId` 和 `scenariofields`，因此同时提供任务类型列表及其场景字段配置。`objectTypes` 默认是 `task`，也支持 `testcase`、`event`；完整核对不应先使用 `sources` 过滤。

来源：[搜索项目自定义字段](https://open.teambition.com/docs/apis/6321c6d0912d20d3b5a497f6)、[获取项目任务类型](https://open.teambition.com/docs/apis/6321c6d1912d20d3b5a49cc4)。

## `list` 权限与 `/search` 路径

| 权限动作名 | `operationId` | 官方路径 |
| --- | --- | --- |
| `tb-core:project.taskflow:list` | `SearchTaskflowsV3` | `/v3/project/{projectId}/taskflow/search` |
| `tb-core:project.taskflowstatus:list` | `SearchTaskflowStatusesV3` | `/v3/project/{projectId}/taskflowstatus/search` |
| `tb-core:project.sprint:list` | `SearchSprintsV3` | `/v3/project/{projectId}/sprint/search` |

权限页面的 `list` 只表示允许列出资源，不能机械拼成 URL。应以官方接口的 `basePath + path` 或 OpenAPI `paths` 为准。

## 建议验证顺序

本文没有授权或执行任何生产项目调用。后续只读核对可依次：

1. `scenariofieldconfig/search?objectTypes=task`：任务类型、绑定工作流、场景字段；
2. `taskflow/search`：工作流；
3. `taskflowstatus/search`：按 `tfIds` 核对状态；
4. `customfield/search?scope=all`：字段定义、类型和选项；
5. `member`：人员身份映射基线，使用新分页参数；
6. `sprint/search`：迭代基线。

真正验证时只允许 `GET`；401/403 优先检查 Token、租户头、安装版本及对应权限，404/421 优先检查基础地址、`/{projectId}` 和 `/search`，不能直接扩大授权范围。
