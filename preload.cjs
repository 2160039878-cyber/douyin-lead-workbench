const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state','settings','createTask','startTask','control','generate','editDraft','approve','execute','resolve','lead','note','export','backup','openVideo','openDouyin','installScript','copyPairing','dataFolder','guide','mcpEnabled','copyMcpToken','rotateMcpToken']);
contextBridge.exposeInMainWorld('workbench', { invoke: (action, value) => {
  if (!actions.has(action)) return Promise.reject(new Error('未知操作'));
  return ipcRenderer.invoke('workbench', action, value);
} });
