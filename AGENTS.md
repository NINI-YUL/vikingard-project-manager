## 上下文压缩

压缩或交接上下文时，保留以下信息：

1. 当前任务目标和完成标准；
2. 已确认的架构、设计决策及取舍；
3. 已修改文件和关键变化；
4. 当前进度和验证状态；
5. 未完成事项、已知风险和已排除的错误路径。

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default mattpocock/skills triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context domain documentation layout. See `docs/agents/domain.md`.

## 凭证安全

读取凭证、执行鉴权、处理授权回调或排查相关异常前，必须阅读 `docs/security/credential-handling.md`。先确认函数参数约定；不得输出凭证内容、完整异常或未筛选的鉴权响应。
