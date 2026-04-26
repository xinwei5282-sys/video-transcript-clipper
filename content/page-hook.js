(function initVideoTranscriptClipperHook() {
  if (window.__videoTranscriptClipperHooked) return;
  window.__videoTranscriptClipperHooked = true;

  function platform() {
    if (/xiaohongshu|xhslink/i.test(location.href)) return 'xhs';
    if (/douyin/i.test(location.href)) return 'douyin';
    return '';
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
    return (normalized.match(/https?:\/\/[^"'\s<>）)]+/g) || []).flatMap((url) => {
      const values = [normalizeUrlText(url)];
      try {
        values.push(normalizeUrlText(decodeURIComponent(url)));
      } catch (error) {}
      return values;
    });
  }

  function looksLikeVideoUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (/blob:|\.(js|css|json|png|jpe?g|webp|gif|svg|ico)(\?|$)|avatar|cover|poster|image|font|favicon|sprite|unread_count|byteimg|bytednsdoc|douyinpic|manifest\.json|mssdk|notice\/detail/i.test(url)) return false;
    return /\.mp4(\?|$)/i.test(url) ||
      /\.m3u8(\?|$)/i.test(url) ||
      /\/stream\//i.test(url) ||
      /douyinvod|byte-vod|bytecdn|ixigua|zjcdn|v3-dy|media-audio|media-video|v3-web|v26-web|v9-web|tos-cn|sns-video|xhscdn/i.test(url);
  }

  function publish(url, source) {
    const clean = normalizeUrlText(url);
    if (!looksLikeVideoUrl(clean)) return;
    window.postMessage({
      type: 'VIDEO_TRANSCRIPT_CLIPPER_CANDIDATE',
      payload: {
        url: clean,
        source,
        platform: platform(),
        pageUrl: location.href,
        capturedAt: Date.now(),
      },
    }, '*');
  }

  function publishDouyinApiCandidate(url, source, meta = {}) {
    const clean = normalizeUrlText(url);
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (/\.(png|jpe?g|webp|gif|svg|ico|json|js|css)(\?|$)|byteimg|bytednsdoc|douyinpic|manifest\.json/i.test(clean)) return;
    if (!/douyinvod|bytecdn|ixigua|zjcdn|v3-dy|v26-web|v9-web|tos-cn/i.test(clean)) return;
    window.postMessage({
      type: 'VIDEO_TRANSCRIPT_CLIPPER_CANDIDATE',
      payload: {
        url: clean,
        source,
        platform: 'douyin',
        pageUrl: location.href,
        capturedAt: Date.now(),
        meta,
      },
    }, '*');
  }

  function extractDouyinApiUrls(data, source) {
    const urls = [];

    function addUrl(url, meta = {}) {
      const clean = normalizeUrlText(url);
      if (!clean || !/^https?:\/\//i.test(clean)) return;
      urls.push({ url: clean, meta });
    }

    function addAddress(address, meta = {}) {
      if (!address || typeof address !== 'object') return;
      const urlList = address.url_list || address.urlList || [];
      if (Array.isArray(urlList)) {
        urlList.forEach((url) => addUrl(url, meta));
      }
      addUrl(address.url_key, meta);
    }

    function collectVideo(video, path) {
      if (!video || typeof video !== 'object') return;
      const bitRates = Array.isArray(video.bit_rate) ? video.bit_rate : [];
      bitRates
        .slice()
        .sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0))
        .forEach((item, index) => {
          addAddress(item.play_addr || item.playAddr, {
            path: `${path}.bit_rate[${index}].play_addr`,
            bitRate: item.bit_rate || 0,
            qualityType: item.quality_type || '',
            sourceKind: 'douyin-api-bitrate',
          });
        });

      addAddress(video.play_addr || video.playAddr, {
        path: `${path}.play_addr`,
        sourceKind: 'douyin-api-play',
      });
      addAddress(video.download_addr || video.downloadAddr, {
        path: `${path}.download_addr`,
        sourceKind: 'douyin-api-download',
      });
    }

    function walk(value, path, depth) {
      if (!value || depth > 8) return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;

      if (value.video && typeof value.video === 'object') {
        collectVideo(value.video, `${path}.video`);
      }
      if (value.aweme_detail && typeof value.aweme_detail === 'object') {
        walk(value.aweme_detail, `${path}.aweme_detail`, depth + 1);
      }
      if (Array.isArray(value.aweme_list)) {
        walk(value.aweme_list, `${path}.aweme_list`, depth + 1);
      }

      Object.entries(value).forEach(([key, child]) => {
        if (!/aweme|detail|video|play|download|bit_rate|data/i.test(key)) return;
        walk(child, `${path}.${key}`, depth + 1);
      });
    }

    walk(data, '$', 0);

    Array.from(new Map(urls.map(item => [item.url, item])).values())
      .forEach(item => publishDouyinApiCandidate(item.url, source, item.meta));
  }

  function tryParseDouyinApiText(text, source) {
    if (!text || !/aweme_detail|aweme_list|play_addr|download_addr|bit_rate|url_list/i.test(text)) return;
    try {
      extractDouyinApiUrls(JSON.parse(text), source);
    } catch (error) {}
  }

  function scanText(text, source) {
    collectUrlsFromText(text).forEach(url => publish(url, source));
    if (/douyin/i.test(location.href)) {
      tryParseDouyinApiText(text, source);
    }
  }

  function scanPerformance() {
    try {
      performance.getEntriesByType('resource').forEach(entry => publish(entry.name, 'performance'));
    } catch (error) {}
  }

  function scanVideoElements() {
    try {
      document.querySelectorAll('video').forEach((video) => {
        [
          video.currentSrc,
          video.src,
          video.getAttribute('src'),
          ...Array.from(video.querySelectorAll('source')).map(source => source.src || source.getAttribute('src')),
        ].forEach(url => publish(url, 'video-element'));
      });
    } catch (error) {}
  }

  function scanDocument() {
    scanPerformance();
    scanVideoElements();
    try {
      scanText(document.documentElement.innerHTML, 'document-html');
    } catch (error) {}
  }

  function patchFetch() {
    if (!window.fetch || window.fetch.__videoTranscriptClipperPatched) return;
    const originalFetch = window.fetch;
    const patchedFetch = function patchedFetch(input, init) {
      try {
        const url = typeof input === 'string' ? input : input?.url;
        publish(url, 'fetch-request');
      } catch (error) {}

      return originalFetch.apply(this, arguments).then((response) => {
        try {
          publish(response.url, 'fetch-response');
          const contentType = response.headers?.get?.('content-type') || '';
          if (/json|text|javascript/i.test(contentType)) {
            response.clone().text().then(text => scanText(text, `fetch-body:${response.url || ''}`)).catch(() => {});
          }
        } catch (error) {}
        return response;
      });
    };
    patchedFetch.__videoTranscriptClipperPatched = true;
    window.fetch = patchedFetch;
  }

  function patchXhr() {
    if (!window.XMLHttpRequest || window.XMLHttpRequest.__videoTranscriptClipperPatched) return;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function open(method, url) {
      this.__videoTranscriptClipperUrl = url;
      publish(url, 'xhr-open');
      return originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function send() {
      this.addEventListener('load', function onLoad() {
        try {
          publish(this.responseURL || this.__videoTranscriptClipperUrl, 'xhr-response');
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          if (text) scanText(text.slice(0, 800000), `xhr-body:${this.responseURL || this.__videoTranscriptClipperUrl || ''}`);
        } catch (error) {}
      });
      return originalSend.apply(this, arguments);
    };

    window.XMLHttpRequest.__videoTranscriptClipperPatched = true;
  }

  function patchCreateObjectUrl() {
    if (!URL.createObjectURL || URL.createObjectURL.__videoTranscriptClipperPatched) return;
    const originalCreateObjectURL = URL.createObjectURL;
    const patchedCreateObjectURL = function createObjectURL(object) {
      const blobUrl = originalCreateObjectURL.apply(this, arguments);
      try {
        window.postMessage({
          type: 'VIDEO_TRANSCRIPT_CLIPPER_CANDIDATE',
          payload: {
            url: blobUrl,
            source: `blob:${object?.type || 'unknown'}`,
            platform: platform(),
            pageUrl: location.href,
            capturedAt: Date.now(),
          },
        }, '*');
      } catch (error) {}
      return blobUrl;
    };
    patchedCreateObjectURL.__videoTranscriptClipperPatched = true;
    URL.createObjectURL = patchedCreateObjectURL;
  }

  patchFetch();
  patchXhr();
  patchCreateObjectUrl();
  scanDocument();

  const observer = new MutationObserver(() => {
    scanVideoElements();
    scanPerformance();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
  }

  setInterval(scanPerformance, 1500);
  setInterval(scanVideoElements, 1200);
  setTimeout(scanDocument, 1000);
  setTimeout(scanDocument, 3000);
})();
