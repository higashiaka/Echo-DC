import { useState, useEffect, useRef } from 'react' // React 기본 훅과 기능을 불러옵니다.
import GalleryInput from './components/GalleryInput' // 갤러리 ID 입력을 위한 컴포넌트입니다.
import RangeInput from './components/RangeInput' // 수집 범위 설정을 위한 컴포넌트입니다.
import ProgressPanel from './components/ProgressPanel' // 크롤링 진행 상황 로그 표시 컴포넌트입니다.
import ResultTabs from './components/ResultTabs' // 수집 완료 후 랭킹 결과를 보여주는 컴포넌트입니다.
import './App.css' // 메인 앱의 스타일 시트입니다.

/**
 * 프로젝트의 메인 애플리케이션 컴포넌트입니다.
 * 전체적인 상태 관리와 시스템 간의 통신(IPC) 연결을 담당합니다.
 */
export default function App() {
  // 선택된 갤러리 정보 상태입니다.
  const [gallery, setGallery] = useState({ gallId: '', gallType: 0, gallName: '' })
  // 크롤링할 페이지 및 날짜 범위 상태입니다.
  const [range, setRange] = useState({
    startPage: '', endPage: '',
    startDate: '', endDate: '',
  })
  // 수집 모드 (전체, 게시글 전용, 댓글 전용) 상태입니다.
  const [mode, setMode] = useState('both')
  // 현재 작업 중인지 여부입니다.
  const [isCrawling, setIsCrawling] = useState(false)
  // 현재 일시정지 상태인지 여부입니다.
  const [isPaused, setIsPaused] = useState(false)
  // 화면에 표시할 수집 로그 배열입니다.
  const [logs, setLogs] = useState([])
  // 댓글 수집 등의 세부 진행률 상태입니다.
  const [progress, setProgress] = useState({ phase: '', current: 0, total: 0 })
  // 최종 집계 결과 데이터입니다.
  const [result, setResult] = useState(null)

  // 새로운 로그를 추가하는 함수입니다. 메모리 관리를 위해 최대 개수를 제한합니다.
  const appendLog = (msg) => {
    setLogs(prev => {
      const next = [...prev, msg]
      // 로그가 500개를 넘어가면 오래된 100개를 제거합니다.
      return next.length > 500 ? next.slice(-400) : next
    })
  }

  // 컴포넌트가 처음 마운트될 때 메인 프로세스로부터 오는 이벤트를 감지하도록 설정합니다.
  useEffect(() => {
    const api = window.dcAPI // 프리로드 스크립트에서 노출된 전자 메인 API입니다.
    if (!api) return

    // 실시간 진행 상황을 수신합니다.
    api.onProgress((data) => {
      appendLog(data.log) // 로그 텍스트 기록
      setProgress({
        phase: data.phase,
        current: data.current || 0,
        total: data.total || 0,
      })
    })

    // 모든 수기 완료 후 최종 결과를 수신합니다.
    api.onDone((data) => {
      setIsCrawling(false)
      setIsPaused(false)
      setResult(data) // 랭킹 결과 저장
      appendLog(`[완료] 집계 완료 — 총 글: ${data.totalPosts}, 총 댓글: ${data.totalComments}`)
    })

    // 작업 중 치명적인 오류 발생 시 호출됩니다.
    api.onError((msg) => {
      setIsCrawling(false)
      setIsPaused(false)
      appendLog(`[오류] ${msg}`)
    })

    // 컴포넌트 소멸 시 이벤트 리스너를 모두 제거하여 메모리 누수를 방지합니다.
    return () => api.removeAllListeners()
  }, [])

  /**
   * 사용자가 '크롤링 시작' 버튼을 눌렀을 때 실행됩니다.
   */
  const handleStart = async () => {
    if (!gallery.gallId) return alert('갤러리 ID를 입력하세요.')
    if (!gallery.gallName) return alert('갤러리 검증을 먼저 해주세요.')

    setResult(null) // 기존 결과 초기화
    setLogs([]) // 기존 로그 초기화
    setProgress({ phase: '', current: 0, total: 0 })
    setIsCrawling(true)

    // 메인 프로세스(main.js)의 'start-crawl' 핸들러를 호출합니다.
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

  /**
   * '일시정지' 버튼 클릭 시 메인 프로세스에 중단 요청을 보냅니다.
   */
  const handlePause = async () => {
    await window.dcAPI.pauseCrawl()
    setIsPaused(true)
  }

  /**
   * '재개' 버튼 클릭 시 메인 프로세스에 재시작 신호를 보냅니다.
   */
  const handleResume = async () => {
    await window.dcAPI.resumeCrawl()
    setIsPaused(false)
    appendLog('[재개] 댓글 수집 재개...')
  }

  /**
   * '중지' 버튼 클릭 시 현재 진행 중인 작업을 종료합니다.
   */
  const handleStop = async () => {
    await window.dcAPI.stopCrawl()
    setIsCrawling(false)
    setIsPaused(false)
    appendLog('[중지] 사용자가 중지했습니다.')
  }

  return (
    <div className="app">
      {/* 고정 상단 헤더 영역 */}
      <header className="app-header">
        <h1>Echo-DC</h1>
        <span className="subtitle">갤창랭킹 생성기</span>
      </header>

      {/* 설정과 결과가 나열되는 바디 영역 */}
      <div className="app-body">
        <div className="left-panel">
          {/* 갤러리 ID 입력 및 유효성 검사부 */}
          <GalleryInput
            gallery={gallery}
            onChange={setGallery}
            disabled={isCrawling}
          />
          {/* 수집 범위(페이지, 날짜) 설정부 */}
          <RangeInput
            range={range}
            onChange={setRange}
            mode={mode}
            onModeChange={setMode}
            disabled={isCrawling}
          />
          {/* 실행 제어 버튼 그룹 */}
          <div className="action-row">
            {!isCrawling ? (
              <button className="btn-primary" onClick={handleStart}>
                크롤링 시작
              </button>
            ) : (
              <>
                {isPaused ? (
                  <button className="btn-pause" onClick={handleResume}>
                    ▶ 이어서 시작
                  </button>
                ) : (
                  <button className="btn-pause" onClick={handlePause}>
                    ⏸ 일시정지
                  </button>
                )}
                <button className="btn-danger" onClick={handleStop}>
                  ■ 중지
                </button>
              </>
            )}
          </div>
          {/* 진행 상태 및 로그 메시지 패널 */}
          <ProgressPanel
            logs={logs}
            phase={progress.phase}
            current={progress.current}
            total={progress.total}
            isCrawling={isCrawling}
          />
        </div>

        {/* 결과 통계 및 랭킹 테이블 표시 패널 */}
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

