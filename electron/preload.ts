import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ghostWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  close: () => ipcRenderer.invoke("window:close")
});

contextBridge.exposeInMainWorld("ghostSpoof", {
  setIOSLocation: (target: { lng: number; lat: number; name?: string }) =>
    ipcRenderer.invoke("spoof:ios:set-location", target),
  resetIOSLocation: () => ipcRenderer.invoke("spoof:ios:reset-location"),
  playIOSRoute: (route: { points: Array<{ lng: number; lat: number; name?: string }>; speedKmh: number }) =>
    ipcRenderer.invoke("spoof:ios:play-route", route)
});

contextBridge.exposeInMainWorld("ghostBluetooth", {
  requestDevice: () => ipcRenderer.invoke("bluetooth:request-device"),
  checkHealth: () => ipcRenderer.invoke("bluetooth:check-health")
});
