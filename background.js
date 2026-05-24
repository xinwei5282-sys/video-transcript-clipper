// Service Worker — 处理飞书 bot 派下来的 clip 任务
// 流程: content script polling 拿到任务 → sendMessage → 这里开后台 tab 抓 + 转写 + POST 结果 + 关 tab

const SERVER_BASE = 'http://127.0.0.1:8765';
const TAB_LOAD_TIMEOUT_MS = 20000;     // tab 加载 20 秒超时
const POST_LOAD_WAIT_MS = 8000;        // 加载完成后再等 8 秒让 hook 拦 API
const DNR_RULE_ID_BASE = 800000;       // declarativeNetRequest 临时规则 id

importScripts('lib/markdown.js');

async function postResult(taskId, status, data) {
  try {
    await fetch(`${SERVER_BASE}/clip/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, status, ...data }),
    });
  } catch (e) {
    console.error('[clip] postResult failed', e);
  }
}

function waitForTabLoaded(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, tab) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      if (err) reject(err); else resolve(tab);
    };
    const listener = (id, info, tab) => {
      if (id !== tabId) return;
      if (info.status === 'complete') finish(null, tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => finish(new Error('tab load timeout')), timeoutMs);
  });
}

async function installRefererRule(tabId, mediaHost, referer) {
  const ruleId = DNR_RULE_ID_BASE + (tabId % 100000);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'referer', operation: 'set', value: referer },
          { header: 'origin', operation: 'set', value: new URL(referer).origin },
        ],
      },
      condition: {
        urlFilter: `||${mediaHost}/`,
        resourceTypes: ['xmlhttprequest', 'media', 'other'],
      },
    }],
  });
  return ruleId;
}

async function removeRule(ruleId) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  } catch (e) {}
}

async function downloadMedia(url, sourceUrl, tabId) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { throw new Error('invalid media url'); }
  const ruleId = await installRefererRule(tabId, host, sourceUrl);
  try {
    const resp = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store' });
    if (!resp.ok) throw new Error(`media download ${resp.status}`);
    const blob = await resp.blob();
    if (blob.size < 1024) throw new Error('downloaded too small');
    if (blob.size > 100 * 1024 * 1024) throw new Error(`too large: ${Math.ceil(blob.size/1024/1024)}MB`);
    return blob;
  } finally {
    await removeRule(ruleId);
  }
}

async function transcribeViaLocal(blob) {
  const resp = await fetch(`${SERVER_BASE}/transcribe?lang=zh`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`transcribe ${resp.status}: ${data.error || ''}`);
  return data.text || '';
}

function pickBestCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  // 抖音优先 media-audio,过滤 media-video
  const filtered = candidates.filter(c => !/media-video/i.test(c.url || ''));
  const sorted = (filtered.length ? filtered : candidates).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  return sorted[0];
}

async function processClipTask(taskId, url) {
  console.log('[clip] start', taskId, url);
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoaded(tab.id, TAB_LOAD_TIMEOUT_MS);
    await new Promise(r => setTimeout(r, POST_LOAD_WAIT_MS));

    // 抓 candidates + meta
    const candCache = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_CANDIDATES', pageUrl: tab.url || url });
    const metaResp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_META', pageUrl: tab.url || url });
    const meta = metaResp?.meta || null;

    const best = pickBestCandidate(candCache?.candidates || []);
    if (!best?.url) throw new Error(`未抓到视频地址,candidates=${candCache?.candidates?.length || 0}`);

    const sourceUrl = tab.url || url;
    const blob = await downloadMedia(best.url, sourceUrl, tab.id);
    const text = await transcribeViaLocal(blob);

    const transcript = {
      title: meta?.title || '抖音视频转写',
      content: text,
      sourceUrl,
      videoUrl: best.url,
      platform: 'douyin',
      meta,
      updatedAt: Date.now(),
    };
    const markdown = buildTranscriptMarkdown(transcript);
    await postResult(taskId, 'done', { markdown });
    console.log('[clip] done', taskId);
  } catch (e) {
    console.error('[clip] error', taskId, e);
    await postResult(taskId, 'error', { error: e.message || String(e) });
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CLIP_TASK_PICKED') {
    sendResponse({ ok: true });
    // 异步处理,不阻塞 sendResponse
    processClipTask(message.taskId, message.url).catch(e => console.error('[clip] unhandled', e));
    return true;
  }
  return false;
});
