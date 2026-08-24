# HitMuse

把公开抖音作品整理成能检索、复盘和继续创作的本地资料库。

HitMuse 是一款面向内容创作者的 Windows 桌面应用。它可以跟踪你关注的博主，采集近期公开作品和互动数据，在本地生成文字稿，再用云端模型或本地 Codex 做内容拆解和文案改写。数据默认保存在自己的电脑上，也可以按需同步到自己的飞书多维表格。

[下载最新版](https://github.com/hongzuoguo/competitor-content-radar/releases/latest) · [参与开发](CONTRIBUTING.md) · [查看第三方声明](THIRD_PARTY_NOTICES.md)

## 能做什么

- 管理对标账号或自己的账号，获取近期公开作品及点赞、评论、收藏和分享数据。
- 从绝对热度和相对历史表现两个角度筛选值得关注的作品，查看近 30 天 Top 10 和选题变化。
- 使用随安装包提供的 SenseVoice 在本地转写视频语音，这一步不消耗大模型 Token。
- 拆解作品的选题、钩子、结构、爆点和差异化方向，并结合自己的创作目标改写文案。
- 导入本地视频，或粘贴单条抖音作品的分享内容进行分析。
- 将博主、作品、指标快照、增长榜、创作方向和热门内容词同步到自己的飞书 Base。
- 通过本地 Agent API 和 MCP，让 Codex、Claude Code 或 Cursor 读取已有作品、文字稿和分析结果。

HitMuse 当前不会在电脑关机或应用退出后自动采集。新增博主时会执行首次采集；以后需要刷新全部启用博主的数据时，点击顶部的“立即运行”。

## 快速开始

1. 安装并启动 HitMuse。
2. 在“设置 → 账号配置”打开专用浏览器登录抖音，按平台提示完成扫码或安全验证。
3. 选择云端 AI 服务或本地 Codex。使用云端服务时，填写服务商提供的 API Key。
4. 在“博主管理”中粘贴完整的公开博主主页链接，等待首次采集完成。
5. 从“总览”查看近期热点，再到“作品分析”阅读文字稿、内容拆解和数据趋势。

飞书同步是可选功能。不连接飞书不会影响本地采集、转写、分析和改写。

## 下载与安装

一键安装包只发布在同一公开 GitHub 仓库的 Releases：[打开下载页面](https://github.com/hongzuoguo/competitor-content-radar/releases)。安装包已经包含桌面应用、Scrapling 采集引擎、SenseVoice 模型和 FFmpeg，普通用户不需要另外安装 Node.js 或 Python。

系统要求：Windows 10 或 Windows 11，64 位；建议预留至少 2 GB 可用磁盘空间。登录抖音时，请使用最新稳定版 Chrome 或 Edge 完成平台页面要求的验证。

当前安装包没有商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。请确认安装包来自本仓库，并将 Release 页面列出的 SHA-256 与本地文件核对：

```powershell
Get-FileHash .\HitMuse-<version>-<commit>-setup.exe -Algorithm SHA256
```

下载地址、版本或 SHA-256 任何一项不一致时，请停止安装。

### 从旧版首次升级

如果已安装版本的更新器仍然指向旧仓库，第一次升级到当前公开版本需要手动从本仓库 Releases 下载安装包。不要等待旧更新器推送这一次升级。

安装程序继续使用 `appId` `com.hitmuse.desktop` 和原有的 `userData` 目录，数据库、设置与历史分析会保留。完成这次手动升级后，后续版本将从当前源码仓库检查和安装更新。

## 数据与安全

数据库、设置、任务记录和分析结果默认保存在当前 Windows 用户的本地目录：

```text
C:\Users\<你的用户名>\AppData\Roaming\competitor-content-radar
```

API Key、飞书 App Secret、Token、Cookie 和登录会话不属于源码。应用内保存的凭证由 Electron `safeStorage` 保护；请勿把凭证、数据库或包含个人信息的日志和截图提交到 GitHub。

登录抖音、读取公开作品、调用云端 AI、飞书同步和自动更新需要联网。本地转写使用安装包内置模型。HitMuse 只用于处理使用者有权访问的公开内容，请遵守相关平台规则、隐私要求、版权规定和所在地法律。

卸载应用默认保留本地用户数据。备份前请从系统托盘完全退出 HitMuse，再复制整个数据目录。

## 开源与开发

本仓库提供 HitMuse 的完整公开源码，可以审阅、修改和自行构建。本项目不提供计费或付费墙；你选择的第三方 AI 服务商可能按其自身规则收费。

安装包由同一仓库的 Tag 发布工作流构建，并在公开检查通过后上传到 GitHub Releases。开发环境、构建命令、测试方法和发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [运维文档](docs/operations/README.md)。

## 许可证与第三方声明

HitMuse 自有源代码 Copyright (c) 2026 hongzuoguo，按 [MIT License](LICENSE) 开源。

HitMuse 使用独立开源项目 [Scrapling](https://github.com/D4Vinci/Scrapling) `0.4.11` 生成随安装包分发的采集引擎。Scrapling Copyright (c) 2024 Karim shoair，按 [BSD 3-Clause License](https://github.com/D4Vinci/Scrapling/blob/v0.4.11/LICENSE) 授权。HitMuse 的 MIT 许可证不会替代或改变 Scrapling 及其他第三方组件的许可证，本项目与 Scrapling 上游也不存在隶属或背书关系。

完整的第三方版权、许可证和资源来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [docs/resources-and-licenses.md](docs/resources-and-licenses.md)。
