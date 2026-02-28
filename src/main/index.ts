import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { DCAnalyzer } from './dc-analyzer'
import { FileManager } from './file-manager'
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/ipc-types'
import type { AnalyzeOptions, SaveResultOptions } from '../shared/ipc-types'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    resizable: false,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'DC 댓글·글 랭킹',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.NODE_ENV === 'development' && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers(): void {
  const fm = new FileManager()

  // ── 앱 버전 ───────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())

  // ── 갤러리 검증 ────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_VERIFY,
    async (_event, galleryId: string, galleryType: number) => {
      const analyzer = new DCAnalyzer()
      return analyzer.verifyGallery(galleryId, galleryType as 0 | 1 | 2)
    }
  )

  // ── 분석기 인스턴스 전역 관리 (제어용) ─────────────────────
  let activeAnalyzer: DCAnalyzer | null = null

  ipcMain.handle(IPC_CHANNELS.GALLERY_PAUSE_ANALYSIS, () => {
    if (activeAnalyzer) activeAnalyzer.pause()
  })
  ipcMain.handle(IPC_CHANNELS.GALLERY_RESUME_ANALYSIS, () => {
    if (activeAnalyzer) activeAnalyzer.resume()
  })
  ipcMain.handle(IPC_CHANNELS.GALLERY_STOP_ANALYSIS, () => {
    if (activeAnalyzer) activeAnalyzer.stop()
  })

  // ── 댓글 랭킹 분석 ────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_ANALYZE_COMMENTS,
    async (event, options: AnalyzeOptions) => {
      activeAnalyzer = new DCAnalyzer()
      const analyzer = activeAnalyzer
      const onLog = (msg: string) => event.sender.send(IPC_EVENTS.LOG_MESSAGE, msg)
      const onProgress = (p: { total: number; current: number }) =>
        event.sender.send(IPC_EVENTS.PROGRESS_UPDATE, p)

      try {
        const ranking = await analyzer.analyzeComments(options, onLog, onProgress)
        const tempFilename = await fm.saveTempData(
          options.galleryId,
          options.galleryName,
          'comment',
          options.startDate,
          options.endDate,
          ranking
        )
        const result = {
          galleryId: options.galleryId,
          galleryName: options.galleryName,
          startDate: options.startDate,
          endDate: options.endDate,
          analysisType: 'comment' as const,
          ranking,
          tempFilename
        }
        event.sender.send(IPC_EVENTS.ANALYSIS_COMPLETE, result)
        activeAnalyzer = null
        return result
      } catch (e) {
        const msg = (e as Error).message
        event.sender.send(IPC_EVENTS.ANALYSIS_ERROR, msg)
        activeAnalyzer = null
        throw e
      }
    }
  )

  // ── 글 랭킹 분석 ──────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_ANALYZE_POSTS,
    async (event, options: AnalyzeOptions) => {
      activeAnalyzer = new DCAnalyzer()
      const analyzer = activeAnalyzer
      const onLog = (msg: string) => event.sender.send(IPC_EVENTS.LOG_MESSAGE, msg)
      const onProgress = (p: { total: number; current: number }) =>
        event.sender.send(IPC_EVENTS.PROGRESS_UPDATE, p)

      try {
        const ranking = await analyzer.analyzePosts(options, onLog, onProgress)
        const tempFilename = await fm.saveTempData(
          options.galleryId,
          options.galleryName,
          'post',
          options.startDate,
          options.endDate,
          ranking
        )
        const result = {
          galleryId: options.galleryId,
          galleryName: options.galleryName,
          startDate: options.startDate,
          endDate: options.endDate,
          analysisType: 'post' as const,
          ranking,
          tempFilename
        }
        event.sender.send(IPC_EVENTS.ANALYSIS_COMPLETE, result)
        activeAnalyzer = null
        return result
      } catch (e) {
        const msg = (e as Error).message
        event.sender.send(IPC_EVENTS.ANALYSIS_ERROR, msg)
        activeAnalyzer = null
        throw e
      }
    }
  )

  // ── 글 + 댓글 통합 랭킹 분석 ──────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.GALLERY_ANALYZE_BOTH,
    async (event, options: AnalyzeOptions) => {
      activeAnalyzer = new DCAnalyzer()
      const analyzer = activeAnalyzer
      const onLog = (msg: string) => event.sender.send(IPC_EVENTS.LOG_MESSAGE, msg)
      const onProgress = (p: { total: number; current: number }) =>
        event.sender.send(IPC_EVENTS.PROGRESS_UPDATE, p)

      try {
        const ranking = await analyzer.analyzeBoth(options, onLog, onProgress)
        const tempFilename = await fm.saveTempData(
          options.galleryId,
          options.galleryName,
          'both',
          options.startDate,
          options.endDate,
          ranking
        )
        const result = {
          galleryId: options.galleryId,
          galleryName: options.galleryName,
          startDate: options.startDate,
          endDate: options.endDate,
          analysisType: 'both' as const,
          ranking,
          tempFilename
        }
        event.sender.send(IPC_EVENTS.ANALYSIS_COMPLETE, result)
        activeAnalyzer = null
        return result
      } catch (e) {
        const msg = (e as Error).message
        event.sender.send(IPC_EVENTS.ANALYSIS_ERROR, msg)
        activeAnalyzer = null
        throw e
      }
    }
  )

  // ── 임시 파일 목록 ────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FILE_LIST_TEMP, () => fm.listTempFiles())

  // ── 임시 파일 로드 ────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FILE_LOAD_TEMP, (_event, filename: string) =>
    fm.loadTempFile(filename)
  )

  // ── 결과 저장 ─────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FILE_SAVE_RESULT, (_event, options: SaveResultOptions) =>
    fm.saveResult(options)
  )
}
