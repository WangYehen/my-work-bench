# 钉钉日报与身份同步（本地优先）

本文描述工作台当前的本地优先实现。钉钉登录、账号隔离、日程与日报的读取均由 Vite 本地服务处理；独立的 `8787` 团队服务与 MySQL 已删除，团队日报、组织关系、审计等数据全部存本地 SQLite，不再依赖独立团队服务作为页面数据来源。

## 数据边界

### 身份与账号档案

- 每个账号以钉钉企业 `userid` 建立稳定本地身份：`dingtalk:<userid>`。
- OAuth `unionId/openId` 只用于钉钉用户态 API，**不**作为本地业务数据的所有者。
- 凭据加密后按账号独立保存；账号切换、退出或未登录时不读取其他账号的个人缓存。
- `work_items`、`goals`、`daily_reports` 均必须带 `owner_identity_id`。没有该字段的历史待办和目标会在迁移时清除，且不会自动归属给下一个登录者。

因此，同一台电脑上 Charles 和 Hollis 的待办、目标、日程缓存和个人日报是相互隔离的。

### 个人页面与团队页面

| 页面 | 数据范围 |
| --- | --- |
| 今日工作、本周目标、日报、周报、邮箱、会议日程 | 仅当前登录身份自己的数据 |
| 团队日报、风险、团队周报 | 仅当前身份在钉钉汇报链中的递归下级 |

主管身份不扩大个人页面的查询范围。是否显示团队入口由本地 `org_members.manager_identity_id` 的下级关系推导：存在至少一名下级时，身份状态返回 `role: "manager"` 与 `canViewTeamReports: true`。

## 登录和组织同步

登录与组织扫描必须分离：前者保证可用性，后者补全团队权限。

1. OAuth 回调交换用户 token。
2. 调用 `/v1.0/contact/users/me`，并用企业 token 将 `unionId` 解析为企业 `userid`、直属主管和部门信息。
3. 立即保存当前账号并返回登录成功；此阶段**不扫描整棵部门树**，避免大组织导致登录超时。
4. 需要团队权限时调用 `POST /api/dingtalk/organization/sync`。该调用会扫描当前可见部门树、成员和直属主管关系，写入 `identities`、`departments`、`org_members`。

组织同步失败时，个人功能仍可使用；团队接口返回明确的组织同步/授权错误，绝不回退到旧账号缓存或演示数据。

## 钉钉标识使用规则

钉钉存在两类不能混用的用户标识：

| 用途 | 标识 |
| --- | --- |
| 本地身份键、组织成员关系、日报作者归属、`/topapi/report/list` 的 `userid` | 企业 `userid` |
| 日程、待办 v1 路径 `/v1.0/calendar/users/:userId/...` 与 `/v1.0/todo/users/:userId/...` | OAuth `unionId`（无时使用 `openId`） |

曾出现日程同步报错：`The value <数字> of parameter userId can not be parsed correctly.` 根因是把企业数字 `userid` 传给日程 v1 路径。现在 `resolveUserId()` 优先返回 `unionId/openId`，而本地 `profile.id` 仍保持企业 `userid`，两者互不替代。

## 日历同步

- 入口：`POST /api/dingtalk/sync`，资源为 `events`。
- 本地状态文件：`.local/dingtalk/accounts/<账号散列>.enc.json`（加密）。日程缓存与同步游标按当前账号分离。
- 自动频率：默认每小时；可由服务配置调整。
- 页面状态条展示最近同步时间、失败原因（仅失败时）和自动同步频率。
- 日程接口成功后仅更新当前账号的日程缓存；失败会记录 `DINGTALK_CALENDAR_REQUEST_FAILED`，不会影响其他账号。

## 日报同步

日报页面统一调用本地兼容入口，不能再调用旧团队服务：

```text
POST /api/local-daily-reports/sync
GET  /api/local-daily-reports?from=YYYY-MM-DD&to=YYYY-MM-DD
GET  /api/local-daily-reports/:date
GET  /api/local-team/dashboard
GET  /api/local-team/reports
```

日报数据写入本地 SQLite `daily_reports`，作者使用实际钉钉日报 `creator_id` 映射为 `owner_identity_id = dingtalk:<creator_id>`。个人查询必须追加当前身份；团队查询由服务端从当前身份的递归下级推导可见范围，客户端不得提交用户 ID 列表绕过授权。

钉钉日志列表请求的统一结构如下：

```json
{
  "start_time": "Asia/Shanghai 起始毫秒",
  "end_time": "Asia/Shanghai 结束毫秒",
  "template_name": "IT部门日报",
  "cursor": 0,
  "size": 10,
  "userid": "仅个人同步时使用的企业 userid"
}
```

个人日报、今日工作和个人周报只读取当前账号的日报；主管查看团队日报时，只能读取其递归下级的日报，不能读取无汇报关系的同部门成员。

## 失败处理与排障

| 现象/代码 | 处理 |
| --- | --- |
| `DINGTALK_NOT_CONNECTED` / `PRIVACY_LOCKED` | 当前没有钉钉身份；先在系统状态页登录。 |
| `DINGTALK_CALENDAR_REQUEST_FAILED` 且提示 `parameter userId` | 检查是否误用企业 `userid`；日程 v1 必须使用 OAuth `unionId/openId`。 |
| `DINGTALK_ORG_NOT_SYNCED` | 组织关系尚未完成，重新执行组织同步；个人数据不受影响。 |
| `TEAM_REPORT_FORBIDDEN` | 当前账号没有已同步的下级关系。 |
| 钉钉返回 IP 白名单错误 | 将当前服务器公网出口 IP 加到钉钉应用的服务器出口 IP 白名单。 |
| `DINGTALK_TOKEN_EXPIRED` | 重新授权当前账号；不要复用其他账号令牌。 |

企业 access token 使用 `appKey/appSecret` 换取；用户 OAuth token 使用 `clientId/clientSecret` 换取，两个接口的字段不可混用。

## 验证清单

1. Charles 登录后，创建待办和本周目标、同步日程；仅 Charles 能看到这些数据。
2. 切换 Hollis 后，今日工作和本周目标不出现 Charles 数据；个人日报与个人周报同样只显示 Hollis 数据。
3. Hollis 完成组织同步且存在 Charles 直属/间接下级时，团队入口出现，并且团队日报仅包含该汇报链数据。
4. 退出账号后刷新页面保持未登录隐私锁定，不展示头像、账号档案或任何个人数据。
