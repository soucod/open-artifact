// The chat window's bridge: a few named calls, nothing of Node or Electron itself. Artifact pages get no preload.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

contextBridge.exposeInMainWorld('chat', {
  send: (text) => ipcRenderer.invoke('chat:send', String(text)),
  open: (url) => ipcRenderer.invoke('chat:open', String(url)),
  onLine: listen('chat:line'),
  onNotice: listen('chat:notice'),
  onCards: listen('chat:cards'),
  onCommands: listen('chat:commands'),
  onDraft: listen('chat:draft'),
});
