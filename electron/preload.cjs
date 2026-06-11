const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ghostWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  close: () => ipcRenderer.invoke("window:close")
});

contextBridge.exposeInMainWorld("ghostSpoof", {
  setIOSLocation: (target) => ipcRenderer.invoke("spoof:ios:set-location", target),
  resetIOSLocation: () => ipcRenderer.invoke("spoof:ios:reset-location"),
  playIOSRoute: (route) => ipcRenderer.invoke("spoof:ios:play-route", route)
});

contextBridge.exposeInMainWorld("ghostBluetooth", {
  requestDevice: () => ipcRenderer.invoke("bluetooth:request-device"),
  checkHealth: () => ipcRenderer.invoke("bluetooth:check-health")
});
