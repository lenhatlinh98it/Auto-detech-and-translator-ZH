const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  run: (command, cfg) => ipcRenderer.invoke("py:run", command, cfg),
  cancel: () => ipcRenderer.invoke("py:cancel"),
  onEvent: (callback) => ipcRenderer.on("py:event", (_e, evt) => callback(evt)),
  openVideo: () => ipcRenderer.invoke("dialog:openVideo"),
  pickFont: () => ipcRenderer.invoke("dialog:pickFont"),
  saveVideo: (defaultPath) => ipcRenderer.invoke("dialog:saveVideo", defaultPath),
  loadProject: (file) => ipcRenderer.invoke("project:load", file),
  saveProject: (file, data) => ipcRenderer.invoke("project:save", file, data),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (data) => ipcRenderer.invoke("settings:save", data),
  previewPath: () => ipcRenderer.invoke("app:previewPath"),
  proxyPath: () => ipcRenderer.invoke("app:proxyPath"),
  reveal: (file) => ipcRenderer.invoke("shell:reveal", file),
  open: (file) => ipcRenderer.invoke("shell:open", file),
  pathOfFile: (file) => webUtils.getPathForFile(file),
});
