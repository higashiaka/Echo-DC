// ============================================================
// 갤러리 타입
// ============================================================
export type GalleryType = 0 | 1 | 2 // 0=메이저, 1=마이너, 2=미니
export type AnalysisType = 'comment' | 'post' | 'both'

export interface GalleryInfo {
  id: string
  name: string
  url: string
  type: GalleryType
}

// ============================================================
// 분석 옵션
// ============================================================
export interface AnalyzeOptions {
  galleryId: string
  galleryName: string
  galleryType: GalleryType
  startPage: number
  endPage: number | null  // null = 날짜 기준 자동 종료
  startDate: string        // YYYY-MM-DD
  endDate: string          // YYYY-MM-DD
  analysisType: AnalysisType
}

// ============================================================
// 유저 랭킹 (댓글·글 통합)
// - analysisType 'comment' → commentCount 집계, postCount = 0
// - analysisType 'post'    → postCount 집계, commentCount = 0
// - analysisType 'both'    → postCount, commentCount 둘 다 집계
// ============================================================
export interface UserRank {
  name: string
  uid: string
  ip: string
  isFluid: boolean
  postCount: number      // 작성한 게시글 수
  commentCount: number   // 작성한 댓글 수
}

// ============================================================
// 진행 상태
// ============================================================
export interface ProgressInfo {
  total: number
  current: number
  message?: string
}

// ============================================================
// 분석 결과
// ============================================================
export interface AnalysisResult {
  galleryId: string
  galleryName: string
  startDate: string
  endDate: string
  analysisType: AnalysisType
  ranking: UserRank[]
  tempFilename?: string
}

// ============================================================
// 임시 파일 관련
// ============================================================
export interface TempFileMeta {
  galleryId: string
  galleryName: string
  analysisType: AnalysisType
  startDate: string
  endDate: string
  createdAt: string
}

export interface TempFileInfo {
  filename: string
  meta: TempFileMeta
}

// ============================================================
// 저장 옵션 (텍스트 / HTML 내보내기)
// ============================================================
export interface SaveResultOptions {
  galleryName: string
  startDate: string
  endDate: string
  analysisType: AnalysisType
  data: UserRank[]
  maximumRank: number
  minimumCount: number
  format: 'text' | 'html'
}

// ============================================================
// Electron API 인터페이스 (preload → renderer)
// ============================================================
export interface ElectronAPI {
  // invoke (renderer → main)
  getVersion: () => Promise<string>
  verifyGallery: (galleryId: string, galleryType: GalleryType) => Promise<GalleryInfo | null>
  analyzeComments: (options: AnalyzeOptions) => Promise<AnalysisResult>
  analyzePosts: (options: AnalyzeOptions) => Promise<AnalysisResult>
  analyzeBoth: (options: AnalyzeOptions) => Promise<AnalysisResult>
  listTempFiles: () => Promise<TempFileInfo[]>
  loadTempFile: (filename: string) => Promise<AnalysisResult>
  saveResult: (options: SaveResultOptions) => Promise<string | null>

  // event listeners (main → renderer), 반환값은 cleanup 함수
  onLogMessage: (callback: (message: string) => void) => () => void
  onProgressUpdate: (callback: (progress: ProgressInfo) => void) => () => void
  onAnalysisComplete: (callback: (result: AnalysisResult) => void) => () => void
  onAnalysisError: (callback: (error: string) => void) => () => void
  onAnalysisStopped: (callback: (result: AnalysisResult | null) => void) => () => void

  // control
  pauseAnalysis: () => Promise<void>
  resumeAnalysis: () => Promise<void>
  stopAnalysis: () => Promise<void>
}

// ============================================================
// IPC 채널 상수
// ============================================================
export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
  GALLERY_VERIFY: 'gallery:verify',
  GALLERY_ANALYZE_COMMENTS: 'gallery:analyze-comments',
  GALLERY_ANALYZE_POSTS: 'gallery:analyze-posts',
  GALLERY_ANALYZE_BOTH: 'gallery:analyze-both',
  GALLERY_PAUSE_ANALYSIS: 'gallery:pause-analysis',
  GALLERY_RESUME_ANALYSIS: 'gallery:resume-analysis',
  GALLERY_STOP_ANALYSIS: 'gallery:stop-analysis',
  FILE_LIST_TEMP: 'file:list-temp',
  FILE_LOAD_TEMP: 'file:load-temp',
  FILE_SAVE_RESULT: 'file:save-result'
} as const

export const IPC_EVENTS = {
  LOG_MESSAGE: 'log:message',
  PROGRESS_UPDATE: 'progress:update',
  ANALYSIS_COMPLETE: 'analysis:complete',
  ANALYSIS_ERROR: 'analysis:error',
  ANALYSIS_STOPPED: 'analysis:stopped'
} as const
