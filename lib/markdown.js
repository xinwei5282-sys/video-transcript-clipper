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

function buildTranscriptMarkdown(transcript) {
  const title = transcript.title || `${platformLabel(transcript.platform)}视频转写`;
  const content = String(transcript.content || '').trim();
  return [
    `# ${title}`,
    '',
    `- 平台：${platformLabel(transcript.platform)}`,
    transcript.sourceUrl ? `- 来源：${transcript.sourceUrl}` : '',
    transcript.videoUrl ? `- 视频地址：${transcript.videoUrl}` : '',
    `- 采集时间：${formatDateTime(transcript.updatedAt || Date.now())}`,
    '',
    '## 文案',
    '',
    content,
  ].filter(line => line !== '').join('\n');
}
