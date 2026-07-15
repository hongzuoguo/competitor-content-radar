# Scrapling × 抖音端到端验证报告

## 结论

Scrapling 能帮助本产品获取指定抖音博主的作品和完整视频文案，真实链路已跑通。它本身不生成语音稿；它负责稳定取得作品数据和媒体地址，随后由现有 FFmpeg + SenseVoice 完成转写。

## 环境与目标

- Scrapling 0.4.11（隔离 Python 3.12 虚拟环境）
- DynamicFetcher + 本机真实 Google Chrome，无登录 Cookie、无代理
- 用户提供的博主名片短链：`https://v.douyin.com/jI79SWk4jwA/`
- 本项目现有 FFmpeg、SenseVoice Small INT8 与 sherpa-onnx

## 分层验证结果

| 层级 | 结果 | 证据 |
|---|---|---|
| 短链解析 | 通过 | 302 跳转到目标 `sec_uid` 博主主页 |
| 博主主页 | 通过 | 页面标题识别为“林克AI实战录的抖音” |
| 作品列表 | 通过 | 捕获 `/aweme/v1/web/aweme/post/`，`status_code=0`，返回 16 条作品 |
| 作品指标 | 通过 | 首条作品：点赞 393、评论 25、分享 60、收藏 329 |
| 媒体地址 | 通过 | `video.play_addr.url_list` 返回可读 MP4 地址 |
| 单作品详情 | 通过 | `/aweme/v1/web/aweme/detail/` 返回作品、指标与评论接口 |
| 平台字幕 | 不可用 | 该作品 `video.subtitle_infos=null` |
| 在线音频提取 | 通过 | FFmpeg 直接读取播放地址，生成 16kHz 单声道 WAV |
| 本地转写 | 通过 | 166.9 秒视频在约 11 秒内转出 971 字完整中文口播稿 |

## 关键观察

普通 Scrapling HTTP Fetcher 只能完成短链跳转，返回页面没有作品 DOM。真正有效的是 `DynamicFetcher(real_chrome=True)` 执行抖音前端并捕获浏览器已经签名的 XHR，因此无需自行维护 `a_bogus`、`verifyFp` 等易变签名算法。

抖音的作品 `desc` 是发布文案，不是口播文字稿；详情接口也不保证字幕。因此完整文案仍应走“媒体流 → FFmpeg 音频 → SenseVoice”链路，但视频文件不必长期落盘，只需要临时音频并按现有清理规则删除。

## 集成建议

1. 优先在现有 Electron/Node 采集层复刻已验证机制：调用本机真实 Chrome、监听 `/aweme/post` 与 `/aweme/detail` 响应、解析作品和指标。
2. 继续复用现有 FFmpeg 与 SenseVoice，不新增转写模型。
3. 若 Node 真实 Chrome 复测仍触发抖音风控，再把 Scrapling 作为本地 sidecar；不要一开始就在安装包中嵌入 Python 和完整浏览器运行时。
4. 每日采集使用持久、隔离的 Chrome 用户目录，并做限速和失败重试；不读取用户日常浏览器 Cookie。

## 验收边界

本次是当前机器、当前网络、目标公开博主的真实匿名端到端成功，不代表抖音永远不会改变接口或触发风控。正式集成必须保留得到大脑 OpenAPI 作为第二采集源和可操作的失败提示。
