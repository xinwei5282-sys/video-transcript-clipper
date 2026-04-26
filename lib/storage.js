const CONFIG_KEYS = ['provider', 'apiUrl', 'apiKey', 'model', 'obsidianPrefix', 'autoOpenObsidian'];

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
    model: String(config.model || 'paraformer-v2').trim(),
    obsidianPrefix: String(config.obsidianPrefix || '').trim(),
    autoOpenObsidian: Boolean(config.autoOpenObsidian),
  };
}

async function saveConfig(config) {
  await setStorage({
    provider: String(config.provider || 'dashscope').trim(),
    apiUrl: String(config.apiUrl || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    model: String(config.model || 'paraformer-v2').trim(),
    obsidianPrefix: String(config.obsidianPrefix || '').trim(),
    autoOpenObsidian: Boolean(config.autoOpenObsidian),
  });
}
