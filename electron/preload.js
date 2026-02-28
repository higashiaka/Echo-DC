// Electron의 렌더러 프로세스와 메인 프로세스를 안전하게 연결하기 위한 모듈들을 불러옵니다.
const { contextBridge, ipcRenderer } = require('electron')

// 브라우저 측(React)에서 전역적으로 접근 가능한 'dcAPI' 객체를 정의합니다.
contextBridge.exposeInMainWorld('dcAPI', {
  // 갤러리 ID 유효성 검사를 메인 프로세스에 요청합니다.
  checkGallery: (gallId, gallType) =>
    ipcRenderer.invoke('check-gallery', gallId, gallType),

  // 크롤링 시작을 메인 프로세스에 요청합니다.
  startCrawl: (params) =>
    ipcRenderer.invoke('start-crawl', params),

  // 크롤링 중지를 메인 프로세스에 요청합니다.
  stopCrawl: () =>
    ipcRenderer.invoke('stop-crawl'),

  // 크롤링 일시정지를 메인 프로세스에 요청합니다.
  pauseCrawl: () =>
    ipcRenderer.invoke('pause-crawl'),

  // 크롤링 재개를 메인 프로세스에 요청합니다.
  resumeCrawl: () =>
    ipcRenderer.invoke('resume-crawl'),

  // 결과를 파일로 저장하는 대화상자를 띄우도록 메인 프로세스에 요청합니다.
  saveResult: (content, defaultName, filters) =>
    ipcRenderer.invoke('save-result', content, defaultName, filters),

  // 메인 프로세스로부터 오는 실시간 진행도 이벤트를 수신합니다.
  onProgress: (callback) => {
    ipcRenderer.on('crawl-progress', (_e, data) => callback(data))
  },

  // 크롤링이 최종 완료되었을 때의 결과 데이터를 수신합니다.
  onDone: (callback) => {
    ipcRenderer.on('crawl-done', (_e, data) => callback(data))
  },

  // 작업 중 발생한 오류 메시지를 수신합니다.
  onError: (callback) => {
    ipcRenderer.on('crawl-error', (_e, msg) => callback(msg))
  },

  // 컴포넌트 종료 시 등록된 모든 이벤트 리스너를 해제합니다.
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('crawl-progress')
    ipcRenderer.removeAllListeners('crawl-done')
    ipcRenderer.removeAllListeners('crawl-error')
  },
})

