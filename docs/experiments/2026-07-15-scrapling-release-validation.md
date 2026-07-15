# Scrapling 备用组件发布验证

## 验证对象

- 公开组件通道：`scrapling-engine-v1`
- 组件版本：`0.1.2`
- Windows x64 ZIP：102,814,817 字节
- SHA-256：`15e1e7fa88ba82565cc04fbf5b051bc95c5618cf43d5eaa6713065e1f0ea76d0`
- 博主名片：`https://v.douyin.com/jI79SWk4jwA/`

## 结果

从 GitHub Release 重新下载组件后，文件大小和 SHA-256 与清单一致。组件解压后无需系统 Python 即可启动。

干净目录端到端采集得到：

- 博主：林克AI实战录
- 作品：16 条
- 首条点赞：393
- 首条评论：25
- 首条分享：60
- 首条收藏：329
- 首条媒体地址：存在

随后使用桌面应用的 TypeScript 组件管理器完成“校验、解压、健康检查、原子激活、进程协议调用”，并再次采集成功。Electron `net.fetch` 也已在当前 Windows 网络环境中成功读取公开组件清单；生产接线使用该系统网络栈，不使用无法继承系统代理的 Node 全局 `fetch`。

## 验证中发现并修复的问题

1. 首版 GitHub 构建遗漏 Scrapling 浏览器可选依赖。
2. 单独补入 `curl_cffi` 后仍遗漏 `msgspec`，最终改为官方完整依赖组 `scrapling[fetchers]`。
3. 覆盖同名 Release 资产可能命中 CDN 旧缓存；清单请求加入时间戳，组件地址加入版本查询参数。
4. Node 全局 `fetch` 在当前网络环境连接 GitHub 超时；生产下载改为 Electron `net.fetch`。

