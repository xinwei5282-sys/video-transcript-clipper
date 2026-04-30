const CONFIG_KEYS = [
  'provider',
  'apiUrl',
  'apiKey',
  'apiSecret',
  'appId',
  'model',
  'customAuthType',
  'customAuthHeader',
  'customInputMode',
  'customFileField',
  'customUrlField',
  'customBase64Field',
  'customModelField',
  'customResponsePath',
  'obsidianPrefix',
  'autoOpenObsidian',
];

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

async function getConfig() {
  const config = await getStorage(CONFIG_KEYS);
  return {
    provider: String(config.provider || 'dashscope').trim(),
    apiUrl: String(config.apiUrl || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    apiSecret: String(config.apiSecret || '').trim(),
    appId: String(config.appId || '').trim(),
    model: String(config.model || '').trim(),
    customAuthType: String(config.customAuthType || 'bearer').trim(),
    customAuthHeader: String(config.customAuthHeader || 'Authorization').trim(),
    customInputMode: String(config.customInputMode || 'url').trim(),
    customFileField: String(config.customFileField || 'file').trim(),
    customUrlField: String(config.customUrlField || 'audio_url').trim(),
    customBase64Field: String(config.customBase64Field || 'audio_data').trim(),
    customModelField: String(config.customModelField || 'model').trim(),
    customResponsePath: String(config.customResponsePath || 'content,text,transcript,result,data.text').trim(),
    obsidianPrefix: String(config.obsidianPrefix || '').trim(),
    autoOpenObsidian: Boolean(config.autoOpenObsidian),
  };
}

async function saveConfig(config) {
  await setStorage({
    provider: String(config.provider || 'dashscope').trim(),
    apiUrl: String(config.apiUrl || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    apiSecret: String(config.apiSecret || '').trim(),
    appId: String(config.appId || '').trim(),
    model: String(config.model || '').trim(),
    customAuthType: String(config.customAuthType || 'bearer').trim(),
    customAuthHeader: String(config.customAuthHeader || 'Authorization').trim(),
    customInputMode: String(config.customInputMode || 'url').trim(),
    customFileField: String(config.customFileField || 'file').trim(),
    customUrlField: String(config.customUrlField || 'audio_url').trim(),
    customBase64Field: String(config.customBase64Field || 'audio_data').trim(),
    customModelField: String(config.customModelField || 'model').trim(),
    customResponsePath: String(config.customResponsePath || 'content,text,transcript,result,data.text').trim(),
    obsidianPrefix: String(config.obsidianPrefix || '').trim(),
    autoOpenObsidian: Boolean(config.autoOpenObsidian),
  });
}
