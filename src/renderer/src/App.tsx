import React, { useState, useEffect, useCallback } from 'react'
import { GalleryInput } from './components/GalleryInput'
import { AnalyzePanel } from './components/AnalyzePanel'
import { LogConsole } from './components/LogConsole'
import { RankingTable } from './components/RankingTable'
import type {
  GalleryInfo,
  GalleryType,
  AnalysisType,
  ProgressInfo,
  AnalysisResult,
  UserRank,
  TempFileInfo
} from '../../shared/ipc-types'

const today = new Date().toISOString().slice(0, 10)

export default function App(): React.JSX.Element {
  const [mainTab, setMainTab] = useState<'rank' | 'logs'>('rank')

  // ── 수집 탭 상태 ────────────────────────────────────────────
  const [galleryId, setGalleryId] = useState('')
  const [galleryType, setGalleryType] = useState<GalleryType>(0)
  const [galleryInfo, setGalleryInfo] = useState<GalleryInfo | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [startPage, setStartPage] = useState('1')
  const [endPage, setEndPage] = useState('')
  const [analysisType, setAnalysisType] = useState<AnalysisType>('both')
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'analyzing' | 'paused'>('idle')
  const [progress, setProgress] = useState<ProgressInfo | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  // ── 랭킹 탭 상태 ────────────────────────────────────────────
  const [tempFiles, setTempFiles] = useState<TempFileInfo[]>([])
  const [loadedFile, setLoadedFile] = useState('')
  const [rankData, setRankData] = useState<UserRank[]>([])
  const [rankMeta, setRankMeta] = useState<Omit<AnalysisResult, 'ranking'> | null>(null)

  // ── IPC 이벤트 리스너 등록 ────────────────────────────────
  useEffect(() => {
    const cleanLog = window.electron.onLogMessage((msg) =>
      setLogs((prev) => (prev.length > 2000 ? [msg] : [...prev, msg]))
    )
    const cleanProgress = window.electron.onProgressUpdate((p) => setProgress(p))
    const cleanComplete = window.electron.onAnalysisComplete((result: AnalysisResult) => {
      setAnalysisStatus('idle')
      setProgress(null)
      setRankData(result.ranking)
      setRankMeta(result)
      setLoadedFile(result.tempFilename ?? '')
      setMainTab('rank')
    })
    const cleanError = window.electron.onAnalysisError((err) => {
      setAnalysisStatus('idle')
      setProgress(null)
      setLogs((prev) => [...prev, `[오류] ${err}`])
    })
    const cleanStopped = window.electron.onAnalysisStopped((result) => {
      setAnalysisStatus('idle')
      setProgress(null)
      setLogs((prev) => [...prev, '[안내] 분석이 중지되었습니다.'])
      if (result) {
        setRankData(result.ranking)
        setRankMeta(result)
        setLoadedFile(result.tempFilename ?? '')
        setMainTab('rank')
      }
    })
    return () => {
      cleanLog()
      cleanProgress()
      cleanComplete()
      cleanError()
      cleanStopped()
    }
  }, [])

  // ── 갤러리 검증 ──────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (!galleryId) return
    setIsVerifying(true)
    setGalleryInfo(null)
    try {
      const info = await window.electron.verifyGallery(galleryId, galleryType)
      setGalleryInfo(info)
    } finally {
      setIsVerifying(false)
    }
  }, [galleryId, galleryType])

  // ── 분석 시작 / 제어 ────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!galleryInfo) return
    setAnalysisStatus('analyzing')
    setMainTab('logs')
    setLogs([])
    setProgress(null)

    const options = {
      galleryId: galleryInfo.id,
      galleryName: galleryInfo.name,
      galleryType,
      startPage: parseInt(startPage) || 1,
      endPage: endPage ? parseInt(endPage) : null,
      startDate,
      endDate,
      analysisType
    }

    try {
      if (analysisType === 'comment') {
        await window.electron.analyzeComments(options)
      } else if (analysisType === 'post') {
        await window.electron.analyzePosts(options)
      } else if (analysisType === 'both') {
        await window.electron.analyzeBoth(options)
      }
    } catch {
      // 에러는 onAnalysisError 이벤트로 처리
    }
  }, [galleryInfo, galleryType, startPage, endPage, startDate, endDate, analysisType])

  const handlePauseToggle = useCallback(async () => {
    if (analysisStatus === 'analyzing') {
      await window.electron.pauseAnalysis()
      setAnalysisStatus('paused')
    } else if (analysisStatus === 'paused') {
      await window.electron.resumeAnalysis()
      setAnalysisStatus('analyzing')
    }
  }, [analysisStatus])

  const handleStop = useCallback(async () => {
    if (analysisStatus !== 'idle') {
      await window.electron.stopAnalysis()
    }
  }, [analysisStatus])

  // ── 임시 파일 목록 갱신 ──────────────────────────────────────
  const refreshTempFiles = useCallback(async () => {
    const files = await window.electron.listTempFiles()
    setTempFiles(files)
  }, [])

  useEffect(() => {
    if (mainTab === 'rank') refreshTempFiles()
  }, [mainTab, refreshTempFiles])

  // ── 임시 파일 불러오기 ───────────────────────────────────────
  const handleLoad = useCallback(async (filename: string) => {
    try {
      const result = await window.electron.loadTempFile(filename)
      setRankData(result.ranking)
      setRankMeta(result)
      setLoadedFile(filename)
    } catch (e) {
      alert(`파일 로드 실패: ${(e as Error).message}`)
    }
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title-prefix">Echo-DC<span className="app-title-suffix">by higashiaka</span></div>
      </header>

      <div className="app-body">
        {/* ── 좌측 사이드바 구조 ──────────────────────────────────────── */}
        <aside className="sidebar">
          <GalleryInput
            galleryId={galleryId}
            galleryType={galleryType}
            galleryInfo={galleryInfo}
            isVerifying={isVerifying}
            onIdChange={(id) => { setGalleryId(id); setGalleryInfo(null) }}
            onTypeChange={(t) => { setGalleryType(t); setGalleryInfo(null) }}
            onVerify={handleVerify}
          />
          <AnalyzePanel
            startDate={startDate}
            endDate={endDate}
            startPage={startPage}
            endPage={endPage}
            analysisType={analysisType}
            analysisStatus={analysisStatus}
            progress={progress}
            galleryVerified={galleryInfo !== null}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onStartPageChange={setStartPage}
            onEndPageChange={setEndPage}
            onTypeChange={setAnalysisType}
            onStart={handleStart}
            onPauseToggle={handlePauseToggle}
            onStop={handleStop}
          />
        </aside>

        {/* ── 우측 메인 콘텐츠 공간 ──────────────────────────────────────── */}
        <main className="main-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* 메인 탭 헤더 */}
          <div className="main-tabs">
            <button
              className={`main-tab-btn ${mainTab === 'rank' ? 'active' : ''}`}
              onClick={() => setMainTab('rank')}
            >
              랭킹
            </button>
            <button
              className={`main-tab-btn ${mainTab === 'logs' ? 'active' : ''}`}
              onClick={() => setMainTab('logs')}
            >
              로그 {analysisStatus !== 'idle' && <span className="pulse-dot"></span>}
            </button>
          </div>

          <div className="main-tab-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {mainTab === 'logs' ? (
              /* 1. 수집 로그 탭 */
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '1rem', marginTop: '0.5rem' }}>
                <div className="card-title">실시간 수집 로그 ({analysisStatus === 'idle' ? '대기 중' : analysisStatus === 'paused' ? '일시정지' : '진행 중'})</div>
                <LogConsole logs={logs} />
              </div>
            ) : (
              /* 2. 랭킹 결과 탭 */
              <div className="ranking-wrap" style={{ padding: '1rem', paddingTop: '0.5rem', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="ranking-toolbar">
                  <div className="left">
                    <div className="row-flex" style={{ width: 'auto' }}>
                      <select
                        className="input"
                        value={loadedFile}
                        onChange={(e) => handleLoad(e.target.value)}
                        style={{ width: '180px' }}
                      >
                        <option value="">-- 과거 파일 탐색 --</option>
                        {tempFiles.map((f) => (
                          <option key={f.filename} value={f.filename}>
                            {f.filename} ({f.meta.analysisType === 'both' ? '통합' : f.meta.analysisType === 'comment' ? '댓글' : '글'})
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-primary" onClick={refreshTempFiles}>
                        목록갱신
                      </button>
                    </div>
                    {rankMeta && (
                      <div className="status-ok" style={{ margin: 0, marginLeft: '12px' }}>
                        {rankMeta.galleryName} | {rankMeta.startDate} ~ {rankMeta.endDate} |{' '}
                        {rankMeta.analysisType === 'both' ? '통합' : rankMeta.analysisType === 'comment' ? '댓글' : '글'} |{' '}
                        {rankData.length}명
                      </div>
                    )}
                  </div>
                </div>

                <RankingTable
                  data={rankData}
                  analysisType={rankMeta?.analysisType || analysisType}
                  galleryName={rankMeta?.galleryName || (galleryInfo?.name || '')}
                  startDate={rankMeta?.startDate || startDate}
                  endDate={rankMeta?.endDate || endDate}
                  onDataChange={setRankData}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
