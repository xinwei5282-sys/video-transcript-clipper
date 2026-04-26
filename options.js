const providerInput = document.getElementById('provider');
const apiUrlInput = document.getElementById('api-url');
const apiUrlRow = document.getElementById('api-url-row');
const apiKeyInput = document.getElementById('api-key');
const modelInput = document.getElementById('model');
const obsidianPrefixInput = document.getElementById('obsidian-prefix');
const autoOpenObsidianInput = document.getElementById('auto-open-obsidian');
const saveButton = document.getElementById('save-btn');
const testButton = document.getElementById('test-btn');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

function syncProviderView() {
  const isCustom = providerInput.value === 'custom';
  apiUrlRow.style.display = isCustom ? 'block' : 'none';
  modelInput.placeholder = isCustom ? '可留空' : 'paraformer-v2';
  if (!isCustom && !modelInput.value.trim()) modelInput.value = 'paraformer-v2';
}

async function load() {
  const config = await getConfig();
  providerInput.value = config.provider;
  apiUrlInput.value = config.apiUrl;
  apiKeyInput.value = config.apiKey;
  modelInput.value = config.model;
  obsidianPrefixInput.value = config.obsidianPrefix;
  autoOpenObsidianInput.checked = config.autoOpenObsidian;
  syncProviderView();
}

saveButton.addEventListener('click', async () => {
  await saveConfig({
    provider: providerInput.value,
    apiUrl: apiUrlInput.value,
    apiKey: apiKeyInput.value,
    model: modelInput.value,
    obsidianPrefix: obsidianPrefixInput.value,
    autoOpenObsidian: autoOpenObsidianInput.checked,
  });
  setStatus('设置已保存');
});

testButton.addEventListener('click', async () => {
  const config = {
    provider: providerInput.value,
    apiUrl: apiUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || 'paraformer-v2',
  };
  if (!config.apiKey || (config.provider === 'custom' && !config.apiUrl)) {
    setStatus(config.provider === 'custom' ? '请先填写 API 地址和 API Key' : '请先填写 API Key');
    return;
  }

  setStatus('正在测试连接...');
  try {
    const url = config.provider === 'dashscope'
      ? 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription'
      : config.apiUrl;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
    if (config.provider === 'dashscope') headers['X-DashScope-Async'] = 'enable';
    const body = config.provider === 'dashscope'
      ? {
          model: config.model,
          input: { file_urls: ['https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav'] },
          parameters: { language_hints: ['zh'] },
        }
      : {
          videoUrl: 'https://example.com/test.mp4',
          sourceUrl: 'https://example.com',
          platform: 'test',
          test: true,
        };
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    setStatus(response.ok ? '连接成功' : `接口返回 ${response.status}`);
  } catch (error) {
    setStatus(error.message || '连接失败，可能是 CORS 或网络问题');
  }
});

providerInput.addEventListener('change', syncProviderView);
load();
