const VIDEO_CACHE_LIMIT = 30;
const PAGE_CACHE_LIMIT = 20;

function normalizePageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return String(url || '').split('#')[0];
  }
}

function detectCachePlatform(url) {
  if (/xiaohongshu|xhslink/i.test(url || '')) return 'xhs';
  if (/douyin/i.test(url || '')) return 'douyin';
  return '';
}

function isCandidateVideoUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/blob:|\/explore\/|\/user\/|\/search|api\/sns/i.test(url)) return false;
  if (/\.(js|css|json|png|jpe?g|webp|gif|svg|ico)(\?|$)|avatar|cover|poster|image|font|favicon|sprite|byteimg|bytednsdoc|douyinpic|manifest\.json/i.test(url)) return false;
  if (/\/aweme\/v1\/web\/|mssdk|notice\/detail|webcast|comment|favorite|follow/i.test(url)) return false;
  return /\.mp4(\?|$)/i.test(url) ||
    /\.m3u8(\?|$)/i.test(url) ||
    /\/stream\//i.test(url) ||
    /douyinvod|byte-vod|bytecdn|ixigua|zjcdn|v3-dy|media-audio|media-video|v3-web|v26-web|v9-web|tos-cn|sns-video|xhscdn/i.test(url);
}

function scoreCandidate(url, source) {
  let score = 0;
  const sourceText = String(source || '');
  if (/douyin-api/i.test(sourceText)) score += 160;
  if (/download_addr|download/i.test(sourceText)) score += 70;
  if (/play_addr|play/i.test(sourceText)) score += 60;
  if (/bitrate|bit_rate/i.test(sourceText)) score += 50;
  if (/watermark=0/i.test(url)) score += 80;
  if (/media-audio/i.test(url)) score += 120;
  // 抖音视频流和音频流分开封装,纯视频流无音轨,whisper 转不了。
  // 强制偏好 media-audio 而非 media-video。
  if (/media-video/i.test(url) && /douyin/i.test(url)) score -= 300;
  if (/\.mp4(\?|$)/i.test(url)) score += 100;
  if (/\.m3u8(\?|$)/i.test(url)) score += 60;
  if (/\/stream\//i.test(url)) score += 50;
  if (/douyinvod|bytecdn|ixigua|zjcdn|v3-dy|v3-web|v26-web|v9-web|tos-cn|sns-video|xhscdn/i.test(url)) score += 50;
  if (/fetch|xhr|performance|video/i.test(source || '')) score += 20;
  if (/watermark/i.test(url)) score -= 40;
  return score;
}

async function saveCandidate(payload) {
  const url = payload?.url || '';
  if (!isCandidateVideoUrl(url)) return;

  const pageUrl = normalizePageUrl(payload.pageUrl || location.href);
  const platform = payload.platform || detectCachePlatform(pageUrl);
  const entry = {
    url,
    source: payload.source || 'unknown',
    platform,
    pageUrl,
    meta: payload.meta || {},
    score: scoreCandidate(url, payload.source),
    updatedAt: Date.now(),
  };

  const { videoCandidateCache = {} } = await chrome.storage.local.get(['videoCandidateCache']);
  const pageCache = videoCandidateCache[pageUrl] || { candidates: [] };
  const candidates = pageCache.candidates || [];
  const nextCandidates = [
    entry,
    ...candidates.filter(item => item.url !== entry.url),
  ]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, VIDEO_CACHE_LIMIT);

  videoCandidateCache[pageUrl] = {
    pageUrl,
    platform,
    updatedAt: Date.now(),
    candidates: nextCandidates,
  };

  Object.entries(videoCandidateCache)
    .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .slice(PAGE_CACHE_LIMIT)
    .forEach(([key]) => {
      delete videoCandidateCache[key];
    });

  await chrome.storage.local.set({ videoCandidateCache });
}

const META_CACHE_LIMIT = 20;

function mergeMeta(prev = {}, next = {}) {
  const merged = { ...prev, ...next };
  if (prev.stats || next.stats) {
    merged.stats = { ...(prev.stats || {}) };
    Object.entries(next.stats || {}).forEach(([k, v]) => {
      if (v != null) merged.stats[k] = v;
    });
  }
  return merged;
}

async function saveMeta(payload) {
  const meta = payload?.meta;
  if (!meta || typeof meta !== 'object') return;
  const pageUrl = normalizePageUrl(payload.pageUrl || location.href);
  const platform = payload.platform || detectCachePlatform(pageUrl);

  const { videoMetaCache = {} } = await chrome.storage.local.get(['videoMetaCache']);
  const prev = videoMetaCache[pageUrl]?.meta || {};
  videoMetaCache[pageUrl] = {
    pageUrl,
    platform,
    updatedAt: Date.now(),
    meta: mergeMeta(prev, meta),
  };

  Object.entries(videoMetaCache)
    .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
    .slice(META_CACHE_LIMIT)
    .forEach(([key]) => {
      delete videoMetaCache[key];
    });

  await chrome.storage.local.set({ videoMetaCache });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;
  if (type === 'VIDEO_TRANSCRIPT_CLIPPER_CANDIDATE') {
    saveCandidate(event.data.payload).catch(() => {});
  } else if (type === 'VIDEO_TRANSCRIPT_CLIPPER_META') {
    saveMeta(event.data.payload).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_VIDEO_CANDIDATES') {
    chrome.storage.local.get(['videoCandidateCache']).then(({ videoCandidateCache = {} }) => {
      const pageUrl = normalizePageUrl(message.pageUrl || location.href);
      sendResponse(videoCandidateCache[pageUrl] || {
        pageUrl,
        platform: detectCachePlatform(pageUrl),
        candidates: [],
      });
    });
    return true;
  }

  if (message?.type === 'GET_VIDEO_META') {
    chrome.storage.local.get(['videoMetaCache']).then(({ videoMetaCache = {} }) => {
      const pageUrl = normalizePageUrl(message.pageUrl || location.href);
      sendResponse(videoMetaCache[pageUrl] || {
        pageUrl,
        platform: detectCachePlatform(pageUrl),
        meta: null,
      });
    });
    return true;
  }

  return false;
});

// ============================================================
// Clip 任务 polling — 让用户在飞书发链接,这里 polling 拿任务
// ============================================================
const CLIP_SERVER = 'http://127.0.0.1:8765';
const CLIP_POLL_INTERVAL_MS = 5000;

// 只在 douyin.com 顶层路径 polling(视频页/搜索页等子路径也跑,但 server 锁住任务避免重复)
async function pollClipTask() {
  try {
    const resp = await fetch(`${CLIP_SERVER}/clip/poll`, { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data?.task?.task_id) return;
    // 通知 background SW 去开后台 tab 抓取
    chrome.runtime.sendMessage({
      type: 'CLIP_TASK_PICKED',
      taskId: data.task.task_id,
      url: data.task.url,
    });
  } catch (e) {
    // server 没起来或网络问题,静默 retry
  }
}

if (/(^|\.)douyin\.com$/i.test(location.hostname)) {
  setInterval(pollClipTask, CLIP_POLL_INTERVAL_MS);
}
