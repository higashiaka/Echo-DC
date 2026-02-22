import { useState, useEffect, useRef } from 'react'
import GalleryInput from './components/GalleryInput'
import RangeInput from './components/RangeInput'
import ProgressPanel from './components/ProgressPanel'
import ResultTabs from './components/ResultTabs'
import './App.css'

export default function App() {
  const [gallery, setGallery] = useState({ gallId: '', gallType: 0, gallName: '' })
  const [range, setRange] = useState({
    startPage: '', endPage: '',
    startDate: '', endDate: '',
  })
  const [mode, setMode] = useState('both')
  const [isCrawling, setIsCrawling] = useState(false)
  const [logs, setLogs] = useState([])
  const [progress, setProgress] = useState({ phase: '', current: 0, total: 0 })
  const [result, setResult] = useState(null)

  const appendLog = (msg) => {
    setLogs(prev => {
      const next = [...prev, msg]
      return next.length > 500 ? next.slice(-400) : next
    })
  }

  useEffect(() => {
    const api = window.dcAPI
    if (!api) return

    api.onProgress((data) => {
      appendLog(data.log)
      setProgress({
        phase: data.phase,
        current: data.current || 0,
        total: data.total || 0,
      })
    })

    api.onDone((data) => {
      setIsCrawling(false)
      setResult(data)
      appendLog(`[완료] 집계 완료 — 총 글: ${data.totalPosts}, 총 댓글: ${data.totalComments}`)
    })

    api.onError((msg) => {
      setIsCrawling(false)
      appendLog(`[오류] ${msg}`)
    })

    return () => api.removeAllListeners()
  }, [])

  const handleStart = async () => {
    if (!gallery.gallId) return alert('갤러리 ID를 입력하세요.')
    if (!gallery.gallName) return alert('갤러리 검증을 먼저 해주세요.')

    setResult(null)
    setLogs([])
    setProgress({ phase: '', current: 0, total: 0 })
    setIsCrawling(true)

    await window.dcAPI.startCrawl({
      gallId: gallery.gallId,
      gallType: gallery.gallType,
      gallName: gallery.gallName,
      startPage: range.startPage ? parseInt(range.startPage) : null,
      endPage: range.endPage ? parseInt(range.endPage) : null,
      startDate: range.startDate || null,
      endDate: range.endDate || null,
      mode,
    })
  }

  const handleStop = async () => {
    await window.dcAPI.stopCrawl()
    setIsCrawling(false)
    appendLog('[중지] 사용자가 중지했습니다.')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Echo-DC</h1>
        <span className="subtitle">갤창랭킹 생성기</span>
      </header>

      <div className="app-body">
        <div className="left-panel">
          <GalleryInput
            gallery={gallery}
            onChange={setGallery}
            disabled={isCrawling}
          />
          <RangeInput
            range={range}
            onChange={setRange}
            mode={mode}
            onModeChange={setMode}
            disabled={isCrawling}
          />
          <div className="action-row">
            {!isCrawling ? (
              <button className="btn-primary" onClick={handleStart}>
                크롤링 시작
              </button>
            ) : (
              <button className="btn-danger" onClick={handleStop}>
                중지
              </button>
            )}
          </div>
          <ProgressPanel
            logs={logs}
            phase={progress.phase}
            current={progress.current}
            total={progress.total}
            isCrawling={isCrawling}
          />
        </div>

        <div className="right-panel">
          {result ? (
            <ResultTabs result={result} />
          ) : (
            <div className="empty-state">
              크롤링 완료 후 여기에 결과가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
