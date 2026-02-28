import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS } from '../shared/ipc-types'
import type {
  GalleryType,
  AnalyzeOptions,
  ProgressInfo,
  GalleryInfo,
  AnalysisResult,
  TempFileInfo,
  SaveResultOptions
} from '../shared/ipc-types'

const electronAPI = {
  // ── invoke ──────────────────────────────────────────────────
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  verifyGallery: (galleryId: string, galleryType: GalleryType): Promise<GalleryInfo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.GALLERY_VERIFY, galleryId, galleryType),

  analyzeComments: (options: AnalyzeOptions): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GALLERY_ANALYZE_COMMENTS, options),

  analyzePosts: (options: AnalyzeOptions): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GALLERY_ANALYZE_POSTS, options),

  analyzeBoth: (options: AnalyzeOptions): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.GALLERY_ANALYZE_BOTH, options),

  listTempFiles: (): Promise<TempFileInfo[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST_TEMP),

  loadTempFile: (filename: string): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_LOAD_TEMP, filename),

  saveResult: (options: SaveResultOptions): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_RESULT, options),

  // ── event listeners ─────────────────────────────────────────
  onLogMessage: (callback: (message: string) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, msg: string) => callback(msg)
    ipcRenderer.on(IPC_EVENTS.LOG_MESSAGE, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.LOG_MESSAGE, handler)
  },

  onProgressUpdate: (callback: (p: ProgressInfo) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, p: ProgressInfo) => callback(p)
    ipcRenderer.on(IPC_EVENTS.PROGRESS_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.PROGRESS_UPDATE, handler)
  },

  onAnalysisComplete: (callback: (result: AnalysisResult) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, result: AnalysisResult) => callback(result)
    ipcRenderer.on(IPC_EVENTS.ANALYSIS_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ANALYSIS_COMPLETE, handler)
  },

  onAnalysisError: (callback: (error: string) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, error: string) => callback(error)
    ipcRenderer.on(IPC_EVENTS.ANALYSIS_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ANALYSIS_ERROR, handler)
  },

  onAnalysisStopped: (callback: (result: AnalysisResult | null) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, result: AnalysisResult | null) => callback(result)
    ipcRenderer.on(IPC_EVENTS.ANALYSIS_STOPPED, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.ANALYSIS_STOPPED, handler)
  },

  pauseAnalysis: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.GALLERY_PAUSE_ANALYSIS),
  resumeAnalysis: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.GALLERY_RESUME_ANALYSIS),
  stopAnalysis: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.GALLERY_STOP_ANALYSIS)
}

contextBridge.exposeInMainWorld('electron', electronAPI)
