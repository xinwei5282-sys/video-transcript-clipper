const DOUYIN_PAGE_PATTERN = /^https?:\/\/([^/]+\.)?douyin\.com\//;
const XHS_PAGE_PATTERN = /^https?:\/\/([^/]+\.)?(xiaohongshu|xhslink)\.com\//;

function detectPlatform(url) {
  if (XHS_PAGE_PATTERN.test(url || '')) return 'xhs';
  if (DOUYIN_PAGE_PATTERN.test(url || '')) return 'douyin';
  return '';
}

function isTranscribableVideoUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/blob:|\/explore\/|\/user\/|\/search|api\/sns/i.test(url)) return false;
  if (/\.(png|jpe?g|webp|gif|svg|ico|json|js|css)(\?|$)/i.test(url)) return false;
  if (/byteimg|bytednsdoc|douyinpic|static|manifest\.json|mssdk|notice\/detail/i.test(url)) return false;
  return /\.mp4(\?|$)/i.test(url) ||
    /\.m3u8(\?|$)/i.test(url) ||
    /\/stream\//i.test(url) ||
    /douyinvod|byte-vod|bytecdn|ixigua|zjcdn|v3-dy|media-audio|media-video|v3-web|v26-web|v9-web|tos-cn/i.test(url);
}

function extractVideoUrlFromPage(options) {
  function getVideoDuration() {
    const video = Array.from(document.querySelectorAll('video')).find(item => Number.isFinite(item.duration) && item.duration > 0);
    return video ? Math.ceil(video.duration) : 0;
  }

  function absolutize(url) {
    try {
      return new URL(url, location.href).href;
    } catch (error) {
      return '';
    }
  }

  function decodeMaybe(text) {
    const values = [text];
    try {
      values.push(decodeURIComponent(text));
    } catch (error) {}
    return values;
  }

  function unescapeHtml(text) {
    return String(text || '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#x2F;/g, '/')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  function addCandidate(url, source) {
    if (!url || typeof url !== 'string') return;
    decodeMaybe(url).forEach((value) => {
      const clean = unescapeHtml(value)
        .replace(/\\u0026/g, '&')
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/')
        .trim();
      const absolute = absolutize(clean);
      if (!absolute || !/^https?:\/\//.test(absolute)) return;
      candidates.push({ url: absolute, source });
    });
  }

  function collectUrlsFromText(text, source) {
    if (!text || typeof text !== 'string') return;
    const normalized = unescapeHtml(text)
      .replace(/\\u0026/g, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/');
    const matches = normalized.match(/https?:\/\/[^"'\s<>）)]+/g) || [];
    matches.forEach((match) => addCandidate(match.replace(/\\\//g, '/'), source));
  }

  function walkJson(value, source, depth) {
    if (!value || depth > 8) return;
    if (typeof value === 'string') {
      collectUrlsFromText(value, source);
      addCandidate(value, source);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => walkJson(item, source, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => {
        const nextSource = options.positiveKeys.test(key) ? `${source}:${key}` : source;
        walkJson(child, nextSource, depth + 1);
      });
    }
  }

  function scoreUrl(url, source) {
    let score = 0;
    const lower = url.toLowerCase();
    const sourceLower = source.toLowerCase();
    if (/\.mp4(\?|$)/.test(lower)) score += 80;
    if (/\.m3u8(\?|$)/.test(lower)) score += 60;
    if (/video|play|media|mime_type=video|mime=video|stream/.test(lower)) score += 45;
    if (options.positiveHost.test(lower)) score += 35;
    if (options.positiveKeys.test(sourceLower)) score += 45;
    if (/masterurl|backupurl|mainurl|originurl|videourl|video_url/.test(sourceLower)) score += 70;
    if (/watermark|avatar|cover|poster|image|jpeg|jpg|png|webp|css|font|favicon|sprite/.test(lower)) score -= 100;
    if (/blob:/.test(lower)) score -= 1000;
    return score;
  }

  const candidates = [];

  performance.getEntriesByType('resource').forEach(entry => addCandidate(entry.name, 'performance'));
  collectUrlsFromText(document.documentElement.innerHTML, 'document-html');

  document.querySelectorAll('script').forEach((script, index) => {
    const text = script.textContent || '';
    collectUrlsFromText(text, `script-${index}`);
    if (!options.positiveKeys.test(text) && !options.positiveHost.test(text)) return;

    const jsonLikeMatches = text.match(/\{[\s\S]{20,}\}/g) || [];
    jsonLikeMatches.slice(0, 3).forEach((chunk) => {
      try {
        walkJson(JSON.parse(chunk), `script-json-${index}`, 0);
      } catch (error) {}
    });
  });

  ['__INITIAL_STATE__', '__INITIAL_SSR_STATE__', '__APOLLO_STATE__', '__NEXT_DATA__'].forEach((key) => {
    try {
      if (window[key]) walkJson(window[key], `window:${key}`, 0);
    } catch (error) {}
  });

  Object.keys(window).filter(key => /state|store|note|video|xhs|red|douyin|aweme/i.test(key)).slice(0, 80).forEach((key) => {
    try {
      const value = window[key];
      if (value && typeof value === 'object') walkJson(value, `window:${key}`, 0);
    } catch (error) {}
  });

  document.querySelectorAll('*').forEach((element) => {
    ['src', 'data-src', 'href', 'poster', 'data-url', 'data-video-src', 'data-player-url', 'data-videosrc'].forEach((attr) => {
      addCandidate(element.getAttribute(attr), `dom:${attr}`);
    });
  });

  document.querySelectorAll('video').forEach((video) => {
    [
      video.currentSrc,
      video.src,
      video.getAttribute('src'),
      ...Array.from(video.querySelectorAll('source')).map(source => source.src || source.getAttribute('src')),
    ].forEach(src => addCandidate(src, 'video-element'));
  });

  const unique = Array.from(new Map(candidates.map(item => [item.url, item])).values())
    .map(item => ({ ...item, score: scoreUrl(item.url, item.source) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = unique[0];
  const sample = unique.slice(0, 6).map((item) => {
    try {
      return `${new URL(item.url).hostname}(${item.score}/${item.source})`;
    } catch (error) {
      return `${item.url.slice(0, 40)}(${item.score}/${item.source})`;
    }
  });
  const suspicious = candidates
    .map(item => item.url)
    .filter(url => /video|mp4|m3u8|xhscdn|sns|media|stream|play|douyinvod|bytecdn|zjcdn|v3-dy|v3-web|v26-web|v9-web|tos-cn/i.test(url))
    .slice(0, 6);

  return {
    pageUrl: location.href,
    platform: options.platform,
    videoUrl: best ? best.url : '',
    durationSeconds: getVideoDuration(),
    foundCount: candidates.length,
    candidateCount: unique.length,
    diagnostics: sample.join('，') || `未命中候选；原始资源数：${candidates.length}${suspicious.length ? `；疑似资源：${suspicious.join(' | ').slice(0, 500)}` : ''}`,
  };
}

function extractXhsVideoUrl() {
  function getVideoDuration() {
    const video = Array.from(document.querySelectorAll('video')).find(item => Number.isFinite(item.duration) && item.duration > 0);
    return video ? Math.ceil(video.duration) : 0;
  }

  function normalizeUrlText(text) {
    return String(text || '')
      .replace(/&amp;/g, '&')
      .replace(/\\u0026/g, '&')
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .trim();
  }

  function collectUrlsFromText(text) {
    const normalized = normalizeUrlText(text);
    const matches = normalized.match(/https?:\/\/[^"'\s<>）)]+/g) || [];
    const decoded = [];
    matches.forEach((url) => {
      decoded.push(url);
      try {
        decoded.push(decodeURIComponent(url));
      } catch (error) {}
    });
    return decoded.map(normalizeUrlText);
  }

  function isDirectXhsVideoResource(url) {
    return /^https?:\/\//.test(url) &&
      /xiaohongshu|xhscdn|sns-video|redcdn|xhs/i.test(url) &&
      (/\.mp4(\?|$)/i.test(url) || /\.m3u8(\?|$)/i.test(url) || /\/stream\//i.test(url)) &&
      !/\.ico(\?|$)|avatar|cover|poster|image|jpeg|jpg|png|webp|css|font|favicon|sprite|api\/sns|unread_count/i.test(url);
  }

  function pickXhsVideoResources(urls) {
    const xhsResources = urls.filter(isDirectXhsVideoResource);
    return Array.from(new Set(xhsResources)).sort((a, b) => {
      const score = (url) => {
        let value = 0;
        if (/\.mp4(\?|$)/i.test(url)) value += 100;
        if (/sns-video|xhscdn/i.test(url)) value += 50;
        if (/\/stream\//i.test(url)) value += 30;
        if (/\.m3u8(\?|$)/i.test(url)) value += 10;
        return value;
      };
      return score(b) - score(a);
    });
  }

  const resources = performance.getEntriesByType('resource').map(entry => entry.name);
  const htmlUrls = collectUrlsFromText(document.documentElement.innerHTML);
  const scriptUrls = Array.from(document.querySelectorAll('script'))
    .flatMap(script => collectUrlsFromText(script.textContent || ''));
  const allUrls = [
    ...resources,
    ...htmlUrls,
    ...scriptUrls,
  ];
  const resourceMatches = pickXhsVideoResources(allUrls);
  const suspiciousResources = allUrls.filter(url =>
    /video|mp4|m3u8|xhscdn|sns|media|stream|play/i.test(url) &&
    !/\.js(\?|$)|\.css(\?|$)|\.ico(\?|$)|unread_count/i.test(url)
  ).slice(0, 8);

  if (resourceMatches.length > 0) {
    return {
      pageUrl: location.href,
      platform: 'xhs',
      videoUrl: resourceMatches[0],
      durationSeconds: getVideoDuration(),
      foundCount: allUrls.length,
      candidateCount: resourceMatches.length,
      diagnostics: resourceMatches.slice(0, 6).map((url) => {
        try {
          return new URL(url).hostname;
        } catch (error) {
          return url.slice(0, 60);
        }
      }).join('，'),
    };
  }

  const fallback = extractVideoUrlFromPage({
    platform: 'xhs',
    positiveHost: /xiaohongshu|xhscdn|sns-video|redcdn|xhs/i,
    positiveKeys: /video|stream|play|media|url|master|backup|origin/i,
  });

  if (fallback.videoUrl) return fallback;

  return {
    ...fallback,
    foundCount: Math.max(fallback.foundCount || 0, allUrls.length),
    candidateCount: 0,
    diagnostics: suspiciousResources.length > 0
      ? `未找到可转写 mp4/m3u8/stream 地址；疑似资源：${suspiciousResources.join(' | ').slice(0, 500)}`
      : fallback.diagnostics || `未找到可转写 mp4/m3u8/stream 地址；资源数：${allUrls.length}`,
  };
}

function extractDouyinVideoUrl() {
  function getVideoDuration() {
    const video = Array.from(document.querySelectorAll('video')).find(item => Number.isFinite(item.duration) && item.duration > 0);
    return video ? Math.ceil(video.duration) : 0;
  }

  function tryRenderData() {
    const el = document.getElementById('RENDER_DATA');
    if (!el) return null;
    try {
      const decoded = decodeURIComponent(el.textContent || '');
      const data = JSON.parse(decoded);
      const urls = [];

      function walk(value, depth) {
        if (!value || depth > 12) return;
        if (typeof value === 'string') {
          if (/douyinvod|bytecdn|ixigua|zjcdn|v3-dy|v3-web|v26-web|v9-web|tos-cn/i.test(value) && /^https?:\/\//.test(value) &&
              !/media-video-hvc1|media-video-avc1|media-audio|byteimg|bytednsdoc|douyinpic|\.(png|jpe?g|webp|gif|svg|ico|json)(\?|$)/i.test(value)) {
            urls.push(value);
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(item => walk(item, depth + 1));
          return;
        }
        if (typeof value === 'object') {
          const keys = Object.keys(value);
          const priorityKeys = keys.filter(key => /play_addr|download_addr|playAddr|downloadAddr/i.test(key));
          const otherKeys = keys.filter(key => !/play_addr|download_addr|playAddr|downloadAddr/i.test(key));
          priorityKeys.concat(otherKeys).forEach(key => walk(value[key], depth + 1));
        }
      }

      walk(data, 0);

      if (urls.length > 0) {
        const best = urls.find(url => !/watermark/i.test(url)) || urls[0];
        return {
          pageUrl: location.href,
          platform: 'douyin',
          videoUrl: best,
          durationSeconds: getVideoDuration(),
          foundCount: urls.length,
          candidateCount: urls.length,
          source: 'RENDER_DATA',
          diagnostics: urls.slice(0, 4).map((url) => {
            try {
              return new URL(url).hostname;
            } catch (error) {
              return url.slice(0, 60);
            }
          }).join(', '),
        };
      }
    } catch (error) {}
    return null;
  }

  function tryVodResources() {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const vodUrls = resources.filter(url =>
      /douyinvod|bytecdn|byte-vod|ixigua|zjcdn|v3-dy|v3-web|v26-web|v9-web|tos-cn/i.test(url) &&
      !/\.(js|css|json|png|jpe?g|webp|gif|svg|ico)(\?|$)|byteimg|bytednsdoc|douyinpic/i.test(url)
    );
    const audioOnly = vodUrls.filter(url => /media-audio/i.test(url));
    const combined = vodUrls.filter(url => !/media-video-hvc1|media-video-avc1|media-audio/i.test(url));
    const videoOnly = vodUrls.filter(url => /media-video/i.test(url));
    const best = audioOnly[0] || combined[0] || videoOnly[0] || vodUrls[0];
    if (best) {
      return {
        pageUrl: location.href,
        platform: 'douyin',
        videoUrl: best,
        durationSeconds: getVideoDuration(),
        foundCount: vodUrls.length,
        candidateCount: vodUrls.length,
        source: 'vodResources',
        diagnostics: `audio:${audioOnly.length} combined:${combined.length} videoOnly:${videoOnly.length} total:${vodUrls.length}`,
      };
    }
    return null;
  }

  return tryRenderData()
    || tryVodResources()
    || extractVideoUrlFromPage({
      platform: 'douyin',
      positiveHost: /douyin|bytecdn|douyinvod|ixigua|zjcdn|v3-dy|v3-web|v26-web|v9-web|tos-cn/i,
      positiveKeys: /play|download|video|url|addr|bit_rate/i,
    });
}
