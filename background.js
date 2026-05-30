// Service Worker — 处理飞书 bot 派下来的 clip 任务
// 流程: content script polling 拿到任务 → sendMessage → 这里开后台 tab 抓 + 转写 + POST 结果 + 关 tab

const SERVER_BASE = 'http://127.0.0.1:8765';
const TAB_LOAD_TIMEOUT_MS = 20000;     // tab 加载 20 秒超时
const POST_LOAD_WAIT_MS = 8000;        // 加载完成后再等 8 秒让 hook 拦 API
const DNR_RULE_ID_BASE = 800000;       // declarativeNetRequest 临时规则 id

importScripts('lib/markdown.js');

const CLIP_DRAIN_ALARM = 'clip-drain';  // alarm 名:定时唤醒 SW 兜底轮询

// ===== Service Worker 保活 =====
// MV3 SW 空闲 ~30s 会被杀。任务处理期间(开 tab/下载/转写共几十秒)用定时调 chrome API
// 重置空闲计时器,防止处理途中 SW 被回收导致任务卡死。引用计数,支持并发任务共享。
let _activeTasks = 0;
let _keepAliveTimer = null;
function acquireKeepAlive() {
  _activeTasks++;
  if (!_keepAliveTimer) {
    _keepAliveTimer = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  }
}
function releaseKeepAlive() {
  _activeTasks = Math.max(0, _activeTasks - 1);
  if (_activeTasks === 0 && _keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

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
  acquireKeepAlive();
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
    releaseKeepAlive();
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

// ===== SW 兜底轮询(保活改造核心)=====
// 不依赖 content script —— 抖音标签页一进后台,它的 setInterval(pollClipTask) 会被
// Chrome 节流甚至停摆。这里让 SW 自己由 chrome.alarms 定时唤醒(即使 SW 被回收也会醒),
// 直接 poll→claim→处理,排空 pending 队列。配合 server 端 claimed 超时退回,卡死也能重试。
let _draining = false;
async function drainClipTasks() {
  if (_draining) return;
  _draining = true;
  try {
    for (let i = 0; i < 20; i++) {  // 单次唤醒最多处理 20 条,防失控
      let task = null;
      try {
        const resp = await fetch(`${SERVER_BASE}/clip/poll`, { cache: 'no-store' });
        if (!resp.ok) break;
        const data = await resp.json();
        task = data && data.task;
      } catch (e) {
        break;  // server 没起来,下次 alarm 再试
      }
      if (!task || !task.task_id) break;
      await processClipTask(task.task_id, task.url);
    }
  } finally {
    _draining = false;
  }
}

chrome.alarms.create(CLIP_DRAIN_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLIP_DRAIN_ALARM) drainClipTasks();
});
// SW 每次启动(被唤醒/重装)立即排空一次,不必等第一个 alarm
drainClipTasks();
