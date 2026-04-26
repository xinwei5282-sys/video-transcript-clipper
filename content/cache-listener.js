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
  if (/media-audio/i.test(url) && /douyin/i.test(url)) score -= 90;
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

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'VIDEO_TRANSCRIPT_CLIPPER_CANDIDATE') return;
  saveCandidate(event.data.payload).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'GET_VIDEO_CANDIDATES') return false;

  chrome.storage.local.get(['videoCandidateCache']).then(({ videoCandidateCache = {} }) => {
    const pageUrl = normalizePageUrl(message.pageUrl || location.href);
    sendResponse(videoCandidateCache[pageUrl] || {
      pageUrl,
      platform: detectCachePlatform(pageUrl),
      candidates: [],
    });
  });

  return true;
});
