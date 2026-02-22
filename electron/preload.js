const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dcAPI', {
  checkGallery: (gallId, gallType) =>
    ipcRenderer.invoke('check-gallery', gallId, gallType),

  startCrawl: (params) =>
    ipcRenderer.invoke('start-crawl', params),

  stopCrawl: () =>
    ipcRenderer.invoke('stop-crawl'),

  saveResult: (content, defaultName, filters) =>
    ipcRenderer.invoke('save-result', content, defaultName, filters),

  onProgress: (callback) => {
    ipcRenderer.on('crawl-progress', (_e, data) => callback(data))
  },

  onDone: (callback) => {
    ipcRenderer.on('crawl-done', (_e, data) => callback(data))
  },

  onError: (callback) => {
    ipcRenderer.on('crawl-error', (_e, msg) => callback(msg))
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('crawl-progress')
    ipcRenderer.removeAllListeners('crawl-done')
    ipcRenderer.removeAllListeners('crawl-error')
  },
})
