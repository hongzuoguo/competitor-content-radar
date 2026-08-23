# HitMuse

HitMuse 是一款面向内容创作者的 Windows 桌面应用，用于整理公开作品、生成本地转写，并辅助内容分析与创作复盘。

## 开源架构

- 本仓库提供完整公开源码，适合开发、审阅和自行构建。
- 同一公开 GitHub 仓库的 Releases 将提供 Windows x64 一键安装包；安装包内置生成的 Scrapling 引擎、固定版本的模型资源和 FFmpeg。
- 安装包用户不需要安装 Node.js 或 Python。源码使用者请按 [CONTRIBUTING.md](CONTRIBUTING.md) 配置开发环境。
- 本项目不提供计费或付费墙。你选择的 AI 服务商可能按其自身规则收费。

> 尚未发布公开版本时，Releases 页面可能没有可下载资产；请不要把本文当作“已有 Release”的声明。

## 下载、校验与安装

公开安装包只会发布到本仓库的 [GitHub Releases](https://github.com/hongzuoguo/competitor-content-radar/releases)。下载后，请将 Release 页面列出的 SHA-256 与本地文件核对：

```powershell
Get-FileHash .\HitMuse-<version>-<commit>-setup.exe -Algorithm SHA256
```

系统要求：Windows 10 或 Windows 11，64 位；建议预留至少 2 GB 可用磁盘空间。登录公开平台时，请使用最新稳定版 Chrome 或 Edge 完成平台页面要求的验证。

当前安装包未附带商业代码签名证书。Windows SmartScreen 可能显示“未知发布者”：仅在下载地址、版本和 SHA-256 都与同一公开 GitHub 仓库的 Release 一致时，才选择“更多信息”后继续安装；任一项不一致就停止安装。

## 从旧版首次升级

如果已安装版本的更新器仍指向旧仓库，第一次升级到公开版本必须手动从本仓库 Releases 下载并运行安装包。不要等待旧更新器推送这一次升级。

安装程序继续使用 `appId` `com.hitmuse.desktop`，并保持原有 `userData` 目录，因此数据库、设置和历史分析会保留。完成这次手动升级后，后续在同一公开 GitHub 仓库发布的版本可按应用内更新流程检查和安装。

## 快速开始

1. 在“设置 → 账号配置”登录抖音，并刷新登录状态。
2. 在设置中选择 AI 服务并填写服务商提供的 API Key。
3. 在“博主管理”添加公开博主主页链接，首次添加会开始采集。
4. 在“总览”和“作品分析”查看数据、文字稿和分析结果。

## 数据与安全

凭证在 UI 中输入并由 Electron `safeStorage` 保护；App Secret、API Key、Token、Cookie 和登录会话都不属于源码，也不得提交到 Git、Issue、日志或截图。卸载默认保留本地用户数据，重新安装会继续使用该数据。

HitMuse 只用于处理使用者有权访问的公开内容。请遵守平台、AI 服务商、隐私、版权和当地法律要求。

## 开发与发布

源码可直接用于开发；安装包则由仓库的 Tag 发布工作流在公开检查通过后构建。开发、测试、资源来源与本地不发布的正式验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [operations documentation](docs/operations/README.md)。

## 许可证与第三方声明

HitMuse 自有源代码 Copyright (c) 2026 hongzuoguo，按 [MIT License](LICENSE) 开源。

HitMuse 使用独立开源项目 [Scrapling](https://github.com/D4Vinci/Scrapling) `0.4.11`
生成随安装包分发的采集引擎。Scrapling Copyright (c) 2024 Karim shoair，按
[BSD 3-Clause License](https://github.com/D4Vinci/Scrapling/blob/v0.4.11/LICENSE)
授权；HitMuse 的 MIT 许可证不会替代或改变 Scrapling 及其他第三方组件的许可证。
本项目与 Scrapling 上游不存在隶属或背书关系。

完整的第三方版权、许可证和资源来源说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与
[docs/resources-and-licenses.md](docs/resources-and-licenses.md)。
