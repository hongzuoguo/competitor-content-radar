# 对标内容雷达

面向自媒体创作者的 Windows 桌面工具：持续观察抖音对标博主，把公开视频转成文字稿，并用可选择的 AI 模型拆解选题、钩子、结构、爆点、互动引导和可复用内容。

## 主要功能

- 最多监控 10 位抖音博主
- 首次采集最近 30 条公开作品作为表现基线
- 处理最近 120 小时的新作品和互动指标
- 内置 FFmpeg 提取音频
- 本地 SenseVoice 语音转文字
- 支持 DeepSeek、豆包、Kimi、通义千问和自定义 OpenAI 兼容接口
- 绝对高点赞、相对爆款指数和 AI 借鉴价值三种重点判断
- 每日自动运行、错过任务后补跑、系统托盘驻留
- API Key 使用当前 Windows 账户的安全存储加密
- GitHub Releases 后台自动下载更新；业务空闲时自动重启安装

飞书多维表格的数据结构和基础客户端已经包含在项目中，但完整 OAuth 授权界面仍在开发。

## 安装

从 [Releases](https://github.com/hongzuoguo/competitor-content-radar/releases) 下载最新 Windows x64 安装程序。

当前安装包未配置商业代码签名证书，Windows SmartScreen 可能显示未知发布者提醒。请只从本仓库 Releases 下载。

首次进行本地转写时，应用会从 sherpa-onnx 官方模型仓库下载约 239 MB 的 SenseVoice INT8 模型，并校验 SHA-256。模型、数据库和媒体文件保存在本机，不会提交到本仓库。

## 首次配置

1. 在独立窗口完成抖音扫码登录；验证码或风险验证需要手动完成。
2. 选择 AI 提供商和模型，填写自己的 API Key。
3. 添加抖音博主主页地址。
4. 设置每日监控和周报时间。
5. 点击“立即运行”完成第一次真实采集。

AI 接口可能由对应提供商收费，费用与限制以提供商规则为准。

## 本地开发

需要 Windows x64 和 Node.js 24。

```powershell
npm install
npm run dev
```

验证：

```powershell
npm test -- --run
npm run typecheck
npm run build
```

构建 Windows 安装程序：

```powershell
npm run dist
```

原生依赖会针对 Electron ABI 重建。若之后需要在普通 Node.js 下再次运行数据库测试，可以执行 `npm rebuild better-sqlite3`。

## 发布与自动更新

版本号使用语义化版本。向公开仓库推送 `v*` 标签后，GitHub Actions 会运行测试并发布 NSIS 安装程序、blockmap 和 `latest.yml`：

```powershell
npm version patch
git push origin main --follow-tags
```

应用启动后自动检查 Release。发现新版时后台下载；如果没有采集或分析任务，下载完成后自动重启安装；如果任务正在运行，则等待任务结束。

## 数据与安全

以下内容不应进入 Git：

- `.env` 和任何 API Key、Token、Cookie
- 抖音或飞书登录会话
- SQLite 数据库及备份
- 下载的视频、音频和本地模型
- `release/` 安装包构建目录和日志

提交安全问题时请避免在公开 Issue 中粘贴凭证、Cookie、完整日志或个人数据。

## 使用边界

本项目只用于处理使用者有权访问的公开内容。使用者应遵守抖音及相关服务的规则、著作权要求、个人信息保护要求和所在地法律法规。项目不会绕过验证码、风险验证或平台访问控制。

## 许可证

[MIT](LICENSE)
