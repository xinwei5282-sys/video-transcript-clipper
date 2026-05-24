const providerInput = document.getElementById('provider');
const apiUrlInput = document.getElementById('api-url');
const apiUrlRow = document.getElementById('api-url-row');
const appIdInput = document.getElementById('app-id');
const appIdRow = document.getElementById('app-id-row');
const apiKeyInput = document.getElementById('api-key');
const apiKeyLabel = document.getElementById('api-key-label');
const apiSecretInput = document.getElementById('api-secret');
const apiSecretRow = document.getElementById('api-secret-row');
const apiSecretLabel = document.getElementById('api-secret-label');
const modelInput = document.getElementById('model');
const modelHelp = document.getElementById('model-help');
const customTemplate = document.getElementById('custom-template');
const customAuthTypeInput = document.getElementById('custom-auth-type');
const customAuthHeaderInput = document.getElementById('custom-auth-header');
const customAuthHeaderRow = document.getElementById('custom-auth-header-row');
const customInputModeInput = document.getElementById('custom-input-mode');
const customFileFieldInput = document.getElementById('custom-file-field');
const customFileFieldRow = document.getElementById('custom-file-field-row');
const customUrlFieldInput = document.getElementById('custom-url-field');
const customUrlFieldRow = document.getElementById('custom-url-field-row');
const customBase64FieldInput = document.getElementById('custom-base64-field');
const customBase64FieldRow = document.getElementById('custom-base64-field-row');
const customModelFieldInput = document.getElementById('custom-model-field');
const customResponsePathInput = document.getElementById('custom-response-path');
const obsidianPrefixInput = document.getElementById('obsidian-prefix');
const autoOpenObsidianInput = document.getElementById('auto-open-obsidian');
const saveButton = document.getElementById('save-btn');
const testButton = document.getElementById('test-btn');
const statusEl = document.getElementById('status');
let lastProvider = '';

function setStatus(text) {
  statusEl.textContent = text;
}

function syncProviderView() {
  const provider = providerInput.value;
  const isCustom = provider === 'custom';
  const isLocalWhisper = provider === 'local-whisper';
  const needsAppId = provider === 'volcengine';
  const needsSecret = provider === 'tencent';
  apiUrlRow.style.display = (isCustom || isLocalWhisper) ? 'block' : 'none';
  customTemplate.style.display = isCustom ? 'block' : 'none';
  appIdRow.style.display = needsAppId ? 'block' : 'none';
  apiSecretRow.style.display = needsSecret ? 'block' : 'none';
  document.getElementById('api-key-row').style.display = isLocalWhisper ? 'none' : 'block';
  apiKeyLabel.textContent = provider === 'tencent' ? 'SecretId' : provider === 'volcengine' ? 'API Key / Access Key' : 'API Key';
  apiSecretLabel.textContent = provider === 'tencent' ? 'SecretKey' : 'API Secret';

  if (isLocalWhisper) {
    const apiUrlLabel = apiUrlRow.querySelector('label, span') || apiUrlRow.childNodes[0];
    if (apiUrlInput.placeholder !== 'http://127.0.0.1:8765/transcribe') {
      apiUrlInput.placeholder = 'http://127.0.0.1:8765/transcribe';
    }
    if (!apiUrlInput.value.trim()) {
      apiUrlInput.value = 'http://127.0.0.1:8765/transcribe';
    }
  } else if (isCustom) {
    apiUrlInput.placeholder = 'https://example.com/transcribe';
  }

  const modelDefaults = {
    'local-whisper': ['zh', '语言代码：zh(中文)/en(英文)/auto(自动)'],
    dashscope: ['paraformer-v2', '阿里百炼 Paraformer 模型名'],
    volcengine: ['volc.bigasr.auc_turbo', '火山极速版资源 ID，推荐 volc.bigasr.auc_turbo'],
    tencent: ['16k_zh', '腾讯 EngineModelType，例如 16k_zh'],
    openai: ['gpt-4o-mini-transcribe', 'OpenAI 转写模型'],
    deepgram: ['nova-3', 'Deepgram 预录音模型'],
    assemblyai: ['', 'AssemblyAI 可留空'],
    custom: ['', '自定义厂商模型名，可留空'],
  };
  const [placeholder, help] = modelDefaults[provider] || modelDefaults.custom;
  const knownDefaults = Object.values(modelDefaults).map(([value]) => value).filter(Boolean);
  const currentModel = modelInput.value.trim();
  modelInput.placeholder = placeholder || '可留空';
  modelHelp.textContent = help;
  if (placeholder && (!currentModel || (lastProvider && lastProvider !== provider && knownDefaults.includes(currentModel)))) {
    modelInput.value = placeholder;
  } else if (!placeholder && lastProvider && lastProvider !== provider && knownDefaults.includes(currentModel)) {
    modelInput.value = '';
  }
  lastProvider = provider;
  syncCustomView();
}

function syncCustomView() {
  const isCustom = providerInput.value === 'custom';
  const mode = customInputModeInput.value;
  const authType = customAuthTypeInput.value;
  customAuthHeaderRow.style.display = isCustom && authType === 'header' ? 'block' : 'none';
  customUrlFieldRow.style.display = isCustom && mode === 'url' ? 'block' : 'none';
  customBase64FieldRow.style.display = isCustom && mode === 'base64' ? 'block' : 'none';
  customFileFieldRow.style.display = isCustom && mode === 'multipart' ? 'block' : 'none';
}

async function load() {
  const config = await getConfig();
  providerInput.value = config.provider;
  apiUrlInput.value = config.apiUrl;
  apiKeyInput.value = config.apiKey;
  apiSecretInput.value = config.apiSecret;
  appIdInput.value = config.appId;
  modelInput.value = config.model;
  customAuthTypeInput.value = config.customAuthType;
  customAuthHeaderInput.value = config.customAuthHeader;
  customInputModeInput.value = config.customInputMode;
  customFileFieldInput.value = config.customFileField;
  customUrlFieldInput.value = config.customUrlField;
  customBase64FieldInput.value = config.customBase64Field;
  customModelFieldInput.value = config.customModelField;
  customResponsePathInput.value = config.customResponsePath;
  obsidianPrefixInput.value = config.obsidianPrefix;
  autoOpenObsidianInput.checked = config.autoOpenObsidian;
  syncProviderView();
}

saveButton.addEventListener('click', async () => {
  if (providerInput.value === 'custom' && apiUrlInput.value.trim()) {
    const granted = await requestCustomHostPermission(apiUrlInput.value.trim());
    if (!granted) return;
  }
  await saveConfig({
    provider: providerInput.value,
    apiUrl: apiUrlInput.value,
    apiKey: apiKeyInput.value,
    apiSecret: apiSecretInput.value,
    appId: appIdInput.value,
    model: modelInput.value,
    customAuthType: customAuthTypeInput.value,
    customAuthHeader: customAuthHeaderInput.value,
    customInputMode: customInputModeInput.value,
    customFileField: customFileFieldInput.value,
    customUrlField: customUrlFieldInput.value,
    customBase64Field: customBase64FieldInput.value,
    customModelField: customModelFieldInput.value,
    customResponsePath: customResponsePathInput.value,
    obsidianPrefix: obsidianPrefixInput.value,
    autoOpenObsidian: autoOpenObsidianInput.checked,
  });
  setStatus('设置已保存');
});

function customApiOriginPattern(apiUrl) {
  try {
    const parsed = new URL(apiUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return `${parsed.origin}/*`;
  } catch (error) {
    return '';
  }
}

async function requestCustomHostPermission(apiUrl) {
  const origin = customApiOriginPattern(apiUrl);
  if (!origin || !chrome.permissions?.request) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    setStatus('未授权自定义厂商域名，设置未保存');
  }
  return granted;
}

testButton.addEventListener('click', async () => {
  const config = {
    provider: providerInput.value,
    apiUrl: apiUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    apiSecret: apiSecretInput.value.trim(),
    appId: appIdInput.value.trim(),
    model: modelInput.value.trim(),
    customAuthType: customAuthTypeInput.value,
    customAuthHeader: customAuthHeaderInput.value.trim(),
    customInputMode: customInputModeInput.value,
    customFileField: customFileFieldInput.value.trim(),
    customUrlField: customUrlFieldInput.value.trim(),
    customBase64Field: customBase64FieldInput.value.trim(),
    customModelField: customModelFieldInput.value.trim(),
    customResponsePath: customResponsePathInput.value.trim(),
  };
  if (config.provider === 'local-whisper') {
    const healthUrl = (config.apiUrl || 'http://127.0.0.1:8765/transcribe').replace(/\/transcribe.*$/, '/health');
    setStatus('正在测试本地 Whisper 服务...');
    try {
      const resp = await fetch(healthUrl);
      const data = await resp.json();
      if (data.ok && data.model_exists) {
        setStatus('✓ 本地 Whisper 服务已启动,模型已加载');
      } else if (data.ok) {
        setStatus('⚠️ 服务启动但模型文件不存在: ' + data.model);
      } else {
        setStatus('服务响应异常: ' + JSON.stringify(data));
      }
    } catch (error) {
      setStatus('✗ 本地服务未启动 - 先跑 python3 ~/projects/whisper-local-server/server.py');
    }
    return;
  }

  const needsApiKey = config.provider !== 'custom' || config.customAuthType !== 'none';
  if ((needsApiKey && !config.apiKey) || (config.provider === 'custom' && !config.apiUrl)) {
    setStatus(config.provider === 'custom' ? '请先填写 API 地址和鉴权信息' : '请先填写 API Key/Access Key');
    return;
  }
  if (config.provider === 'tencent' && !config.apiSecret) {
    setStatus('腾讯云请填写 SecretKey');
    return;
  }

  if (!['dashscope', 'custom'].includes(config.provider)) {
    setStatus('凭据格式已填写；请在视频页面试转写验证额度和权限');
    return;
  }

  if (config.provider === 'custom' && config.customInputMode !== 'legacy') {
    setStatus('自定义模板无法在设置页测试，请保存后到视频页面试转写验证');
    return;
  }

  setStatus('正在测试连接...');
  try {
    const url = config.provider === 'dashscope'
      ? 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription'
      : config.apiUrl;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (config.provider === 'dashscope') headers['X-DashScope-Async'] = 'enable';
    if (config.provider === 'custom') {
      if (config.customAuthType === 'bearer') headers.Authorization = `Bearer ${config.apiKey}`;
      if (config.customAuthType === 'header') headers[config.customAuthHeader || 'x-api-key'] = config.apiKey;
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
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
customAuthTypeInput.addEventListener('change', syncCustomView);
customInputModeInput.addEventListener('change', syncCustomView);
load();
