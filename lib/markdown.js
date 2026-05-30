function formatDateTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function platformLabel(platform) {
  if (platform === 'xhs') return '小红书';
  if (platform === 'douyin') return '抖音';
  return platform || '视频';
}

function safeFilename(text) {
  return String(text || '视频文案')
    .replace(/[\\/:*?"<>|#\[\]\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || '视频文案';
}

function formatCount(value) {
  if (value == null || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return String(n);
}

function formatPublishTime(ts) {
  if (!ts) return '';
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const date = new Date(n > 1e12 ? n : n * 1000);
  const pad = v => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildStatsBlock(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const stats = meta.stats || {};
  const hasStats = ['play', 'digg', 'comment', 'collect', 'share']
    .some(k => stats[k] != null);
  if (!hasStats && !meta.author && !meta.createTime) return '';
  const lines = ['## 数据', ''];
  if (meta.author) lines.push(`- 作者：${meta.author}`);
  const publishTime = formatPublishTime(meta.createTime);
  if (publishTime) lines.push(`- 发布时间：${publishTime}`);
  if (meta.duration) lines.push(`- 时长：${Math.round(meta.duration / 1000)} 秒`);
  if (hasStats) {
    lines.push(
      `- 播放：${formatCount(stats.play)}  点赞：${formatCount(stats.digg)}  评论：${formatCount(stats.comment)}  收藏：${formatCount(stats.collect)}  分享：${formatCount(stats.share)}`
    );
  }
  return lines.join('\n');
}

function buildTranscriptMarkdown(transcript) {
  const title = transcript.title || `${platformLabel(transcript.platform)}视频转写`;
  const content = String(transcript.content || '').trim();
  const statsBlock = buildStatsBlock(transcript.meta);
  return [
    `# ${title}`,
    '',
    `- 平台：${platformLabel(transcript.platform)}`,
    transcript.sourceUrl ? `- 来源：${transcript.sourceUrl}` : null,
    transcript.videoUrl ? `- 视频地址：${transcript.videoUrl}` : null,
    `- 采集时间：${formatDateTime(transcript.updatedAt || Date.now())}`,
    '',
    statsBlock || null,
    statsBlock ? '' : null,
    '## 文案',
    '',
    content,
  ].filter(line => line !== null).join('\n');  // 只删空缺的可选行(null),保留 '' 作分隔空行
}
