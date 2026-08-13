# Microsoft 365 一键连接设置

这个工作台不会收集 Outlook 密码或浏览器 Cookie。用户点击“连接 Outlook”后，会跳转到 Microsoft 登录页，完成登录和授权后回到本地工作台。

## 一次性准备

在 [Microsoft Entra 管理中心](https://entra.microsoft.com/) 注册一个应用。选择“任何组织目录中的帐户（多租户）”；工作邮箱所属组织如果限制用户同意权限，仍需要管理员批准。

在 **Authentication** 中添加“Mobile and desktop applications”平台，并配置这个回调地址：

`http://127.0.0.1:5174/api/outlook/oauth/callback`

在 **API permissions** 中添加 Microsoft Graph 的委托权限：`Mail.Read` 和 `offline_access`。不需要 Client Secret。

复制应用 Overview 中的 **Application (client) ID**，填入本地 `Workbench/.env` 的 `OUTLOOK_ENTRA_CLIENT_ID`。不要填写邮箱密码。

## 本地配置

保留 `OUTLOOK_ENTRA_TENANT_ID` 为空，即可使用多租户 `common` 登录入口。还需填写 `OUTLOOK_TOKEN_ENCRYPTION_KEY` 与 `DEEPSEEK_API_KEY`，然后重启本地开发服务。

首次连接时，用户会在 Microsoft 页面完成 MFA 和权限同意；若出现“需要管理员批准”，将该页面交给公司的 Microsoft 365 管理员处理。
