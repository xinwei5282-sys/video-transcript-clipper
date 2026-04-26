# 视频文案采集器

一个轻量 Chrome 扩展，用于在抖音和小红书视频页面采集视频地址，调用用户自己的转写 API，将结果导出为 Markdown 或导入 Obsidian。

## 功能

- 支持抖音视频文案转写
- 支持小红书视频文案转写
- 支持阿里百炼 DashScope Paraformer
- 支持自定义转写 API
- 支持下载 Markdown
- 支持复制 Markdown
- 支持通过 Obsidian URI 导入 Obsidian
- 本地保留最近一次运行日志，便于排查问题

## 工作方式

### 抖音

抖音视频地址通常带防盗链，不能直接交给转写服务访问。本扩展会：

1. 在当前页面提取可播放媒体地址。
2. 使用浏览器环境下载媒体 Blob。
3. 上传到用户自己的 DashScope 文件存储。
4. 使用上传后的文件 URL 调用 Paraformer 转写。

### 小红书

小红书目前使用直接链路：

1. 在当前页面提取真实视频地址。
2. 直接将视频 URL 提交给 Paraformer 转写。

## 安装开发版

1. 打开 Chrome 扩展管理页：`chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`video-transcript-clipper`
5. 打开扩展设置页，配置 API

## API 配置

### 阿里百炼 DashScope

推荐模型：

```text
paraformer-v2
```

需要填写：

- 接口类型：阿里百炼 Paraformer
- API Key：用户自己的 DashScope API Key
- 模型：默认 `paraformer-v2`

API Key 只保存在用户本机浏览器的 `chrome.storage.local` 中。

### 自定义 API

自定义 API 需要支持：

```http
POST your-api-url
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

请求体：

```json
{
  "videoUrl": "https://example.com/video.mp4",
  "sourceUrl": "https://example.com/page",
  "platform": "xhs",
  "durationSeconds": 120
}
```

返回字段支持任意一个：

```json
{
  "content": "转写结果"
}
```

也支持 `text`、`transcript`、`result`。

## 隐私说明

请阅读 `PRIVACY.md`。

## 注意事项

- 本项目不内置任何 API Key。
- 用户需要自行配置自己的 API Key。
- 抖音转写会将当前视频媒体文件上传到用户自己的 DashScope 文件存储。
- 页面媒体地址可能随平台策略变化而失效。
- 本项目仅用于处理你有权访问和使用的内容。

## 开发

本项目是原生 Manifest V3 Chrome 扩展，没有构建步骤。

常用检查：

```bash
python3 -m json.tool manifest.json >/dev/null
node --check popup.js
node --check options.js
node --check content/page-hook.js
node --check content/cache-listener.js
node --check lib/extractors.js
node --check lib/markdown.js
node --check lib/storage.js
```

## 关于作者

- 🔥 获客操盘手，累计操盘成交 2 亿
- 🤖 AI 学习者，探索新时代的获客姿势
- 💡 公众号「BookNote」
- 🐦 X: https://x.com/Dunduncoming

## License

MIT
