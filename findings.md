# 调研结论

- 抖音浏览器链路真实运行受到安全验证限制，不能作为可靠默认采集源。
- 得到大脑官方说明会每日 08:00 同步订阅博主的新作品。
- OpenAPI 提供博主列表、博主作品和作品详情读取接口，权限为 `topic.blogger.read`。
- 鉴权使用 `Authorization` API Key 与 `X-Client-ID`。
- 公开文档未确认点赞、评论等字段；必须以真实响应验证，不能假设存在。
- 当前缺少用户的 Client ID 与 API Key，因此最终真实端到端验收仍可能被凭证阻塞。

## Scrapling 调研

- 官方定位是 Python 自适应 Web Scraping 框架，支持 HTTP、Playwright 动态浏览器、隐身浏览器、会话与代理。
- 基础 `pip install scrapling` 不包含 fetcher；浏览器实验需要 `scrapling[fetchers]` 并安装浏览器依赖。
- 官方声称能处理部分反机器人系统，但没有声明专门支持抖音；是否能绕过抖音安全验证必须用真实目标验证。
- 本次成功标准不是“能打开网页”，而是同一条链路真实得到博主作品 ID、单作品文案及互动指标。
- 本机有 Python 3.12、Google Chrome 与 Edge，满足 Scrapling 动态浏览器实验条件。
- `DynamicFetcher` 可使用真实 Chrome、持久用户目录和 XHR 捕获；这比仅解析最终 HTML 更适合抖音这类 SPA。
- `StealthyFetcher` 提供更强浏览器指纹隐藏，但其宣传重点是通用反机器人/Cloudflare，不能据此推断可通过抖音风控。
- Scrapling 0.4.11 已在隔离虚拟环境安装成功。
- 普通 HTTP Fetcher 能把博主名片短链真实解析到 `iesdouyin.com/share/user/{sec_uid}`，返回 200 和约 72KB HTML；未出现验证码，但初始 HTML 没有 `aweme_id` 或页面标题，尚未取得作品列表。
- 该 HTTP 响应几乎没有可解析 DOM（仅两个空脚本节点、无 body 文本），因此单纯替换 HTML 解析器不能解决作品采集；下一步必须执行浏览器 JavaScript并观察 XHR。
- 真实 Chrome 动态模式成功打开目标博主主页，标题为“林克AI实战录的抖音 - 抖音”，并捕获到 63 条后台请求。
- 精确捕获 `/aweme/v1/web/aweme/post/` 成功：HTTP 200、`status_code=0`、返回真实 `aweme_list`，包含作品 ID、发布文案 `desc`、作者、播放地址等；首条作品 ID 为 `7659607768617307402`。
- 这已证明 Scrapling 能补齐“名片短链 → 博主主页 → 作品列表/播放地址”链路；但 `desc` 只是发布文案，不等于视频语音文字稿，仍需验证字幕或音频转写层。
- 一次真实主页采集返回 16 条作品；首条作品互动数据为点赞 393、评论 25、分享 60、收藏 329，并获得可访问的 MP4 播放地址。
- 单作品页 `/aweme/v1/web/aweme/detail/` 也成功返回同一作品及互动指标；同时能捕获评论列表接口。
- 该作品的 `video.subtitle_infos` 为 `null`，详情接口没有语音文字稿。因此 Scrapling 能提供发布文案和媒体地址，但不能直接替代 ASR；完整视频文案仍需从媒体音轨转写。
- 本机已存在应用下载完成的 SenseVoice Small INT8 模型（约 239MB）及 sherpa-onnx Windows 运行库，可直接完成最后的媒体流转写实验，无需引入新的云端模型。
- Scrapling 捕获的首条播放地址可被 FFmpeg 直接读取；已在线拉流并生成 16kHz 单声道 PCM WAV，时长约 166.9 秒、文件约 5.34MB。媒体获取层真实通过。
- SenseVoice 对上述音频在 11 秒内转出 971 字完整中文口播稿，开头为“AI真的能够帮助普通人省钱吗？我的答案是能……”，内容与作品主题完全一致。端到端链路真实成功。
- 验证链路：博主名片短链 → Scrapling 真实 Chrome → 捕获 `aweme/post` → 作品/互动数据/播放地址 → FFmpeg 在线拉流提取 WAV → SenseVoice 完整文字稿。
- Scrapling 的关键价值不是 DOM 选择器，而是用真实 Chrome 执行抖音前端并直接捕获已签名的 XHR 响应；这避开了自行生成 `a_bogus` 等请求签名。
- 不建议把完整 Python + Scrapling + Playwright 立即打进 Electron 安装包：会引入双运行时和较大的浏览器依赖。优先在现有应用中复刻“真实 Chrome + XHR 捕获”机制；若 Node 方案复测失败，再采用 Scrapling 本地 sidecar。
