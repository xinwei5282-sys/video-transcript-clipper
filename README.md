# 抖音/小红书视频文案 + 数据采集器(完全离线版)

> Fork 自 [Yinmu/video-transcript-clipper](https://github.com/Yinmu/video-transcript-clipper),感谢原作者。
>
> 本 fork 在原版基础上增强:
> - ✅ **抓取抖音视频数据**(点赞 / 评论 / 收藏 / 分享 / 作者 / 真实标题)
> - ✅ **集成本地 Whisper 服务**(完全离线,零成本,不依赖任何云 API)
> - ✅ **一键复制总结请求**(配合飞书 bot / 任意 LLM 做选题拆解)
>
> 原作者 README 保留在 [README.upstream.md](./README.upstream.md)。

## 它能做什么

打开抖音或小红书视频页 → 点扩展 → 自动:
1. 抓视频元数据(标题、作者、点赞、评论、收藏、分享、时长)
2. 浏览器内下载音频(绕过抖音防盗链)
3. 调本地 Whisper 转写口播文字(中文准确率 ~95%+)
4. 拼成 Markdown,一键导入 Obsidian

可选:点「复制总结请求」→ 粘贴到任意 LLM/Bot → 自动出选题拆解(钩子/结构/情绪/可借鉴/为什么爆)。

## 安装(macOS,5 步,15 分钟)

### 第 1 步:装依赖

```bash
brew install whisper-cpp ffmpeg
```

### 第 2 步:下载 Whisper 模型(~3GB)

```bash
mkdir -p ~/whisper-models
curl -L -o ~/whisper-models/ggml-large-v3.bin \
  https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin
```

> 国内用 `hf-mirror.com`(8-10 分钟)。国外用官方:
> `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin`
>
> 如果硬盘紧张,可以下小的 turbo 版(1.6GB,稍快但准确率低 5%):
> `ggml-large-v3-turbo.bin`(同样路径下)

### 第 3 步:克隆本仓库

```bash
cd ~/projects   # 或任意你喜欢的位置
git clone https://github.com/YOUR_USERNAME/video-transcript-clipper.git
cd video-transcript-clipper
```

### 第 4 步:启动本地 Whisper 服务

```bash
python3 whisper-server/server.py
```

看到 `✓ 监听: http://127.0.0.1:8765` 就 OK。保留这个终端窗口不要关。

> 想让它后台自动启动,可以配 `launchctl`(可选,见底部「进阶」)。

### 第 5 步:装 Chrome 扩展

1. Chrome 打开 `chrome://extensions/`
2. 右上角开启「**开发者模式**」
3. 点「**加载已解压的扩展程序**」
4. 选这个仓库的根目录(`video-transcript-clipper/`,不要选 `whisper-server/`)
5. 看到「视频文案采集器」图标就成功

### 第 6 步:配置扩展

1. 点扩展图标 → 「**设置 API**」
2. **接口类型** 选「**本地 Whisper(离线·零成本·推荐)**」
3. API 地址自动填 `http://127.0.0.1:8765/transcribe`
4. 模型字段填 `zh`(中文)
5. 点「**测试连接**」→ 出现 ✓ 提示就保存

## 使用

1. 打开抖音视频页(`https://www.douyin.com/video/...` 或小红书视频页)
2. **等 5-10 秒** 让页面加载完(扩展需要拦截抖音 API 响应)
3. 点扩展图标 → 「**采集并转写**」
4. 等 30-60 秒(取决于视频长度)
5. 看 Markdown 输出:
   ```markdown
   # 视频真实标题

   - 平台:抖音
   - 来源:...
   - 视频地址:...
   - 采集时间:...

   ## 数据
   - 作者:xxx
   - 发布时间:2026-XX-XX
   - 时长:XX 秒
   - 播放:-  点赞:1.2w  评论:300  收藏:5.6w  分享:200

   ## 文案
   (whisper 转出来的完整口播文字)
   ```

6. 一键操作:
   - **下载 Markdown** → 存本地
   - **复制 Markdown** → 粘贴到任意地方
   - **导入 Obsidian** → 自动建笔记(需要本地装了 Obsidian)
   - **复制总结请求(给飞书 bot)** → 粘贴到任意 LLM,自动出选题拆解

## 限制

- **播放数(view_count)**:抖音网页版 API 不返回这个字段,只在 App 端有 — 拿不到,显示为 `-`
- **长视频(>10 分钟)**:转写慢(5-10 分钟),且 Whisper 偶尔会"重复幻觉"。短视频(<3 分钟)完美
- **抖音前端改版**:抓 statistics 的逻辑基于当前抖音 API 字段(`aweme_detail.statistics`),如果抖音改字段就要适配 `content/page-hook.js` 的 `extractDouyinMeta` 函数
- **只在 macOS 测试过**:Linux 应该也能跑(把 brew 换成 apt),Windows 没测

## 故障排查

| 症状 | 处理 |
|---|---|
| 「请先在设置页确认本地 Whisper 服务地址」 | server 没启动,跑 `python3 whisper-server/server.py` |
| 「ffmpeg failed (没有音频流)」 | 抖音偶尔返回纯视频候选,清空 cache 重试:popup 右键检查 → console 跑 `chrome.storage.local.clear()` |
| 「Could not establish connection」 | 扩展刚加载,抖音页面没刷新。Cmd+R 刷新页面 |
| 「数据段缺失」 | 抖音页面没加载完就采集了,等 10 秒再试 |
| 「文案不完整 / 标点错乱」 | 调 `whisper-server/server.py` 里的 whisper 参数,看头部注释 |

## 进阶

### 后台运行 Whisper 服务(launchd)

```bash
cat > ~/Library/LaunchAgents/local.whisper.server.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.whisper.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$HOME/projects/video-transcript-clipper/whisper-server/server.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.whisper-server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.whisper-server.err</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/local.whisper.server.plist
```

### 切换模型

`server.py` 自动按优先级选:`large-v3` → `q5_0` → `turbo`。删掉对应文件就 fallback 到下一个。

### 调整转写参数

编辑 `whisper-server/server.py` 里 `cmd = [...]` 那段。常用调整:
- `-tp 0` → `-tp 0.2`:增加创造性(可能减少标点缺失,但增加错别字)
- `-mc 64` → `-mc -1`:允许更长上下文(可能更好的标点,但错误更易传染)
- `--prompt "..."`:换 prompt 提示(放视频领域关键词能减少错别字)

## 致谢

- 原作者 [Yinmu](https://github.com/Yinmu) — 完成了扩展架构、API 拦截、ASR provider 框架等核心工作
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — 本地推理
- OpenAI Whisper — 模型

## License

MIT(继承自原仓库)
