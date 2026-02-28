import React from 'react'
import type { AnalysisType, ProgressInfo } from '../../../shared/ipc-types'

interface Props {
  startDate: string
  endDate: string
  startPage: string
  endPage: string
  analysisType: AnalysisType
  analysisStatus: 'idle' | 'analyzing' | 'paused'
  progress: ProgressInfo | null
  galleryVerified: boolean
  onStartDateChange: (v: string) => void
  onEndDateChange: (v: string) => void
  onStartPageChange: (v: string) => void
  onEndPageChange: (v: string) => void
  onTypeChange: (t: AnalysisType) => void
  onStart: () => void
  onPauseToggle: () => void
  onStop: () => void
}

export function AnalyzePanel({
  startDate,
  endDate,
  startPage,
  endPage,
  analysisType,
  analysisStatus,
  progress,
  galleryVerified,
  onStartDateChange,
  onEndDateChange,
  onStartPageChange,
  onEndPageChange,
  onTypeChange,
  onStart,
  onPauseToggle,
  onStop
}: Props): React.JSX.Element {
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0

  return (
    <div className="card">
      <div className="card-title">크롤링 범위</div>

      {/* ── 수집 대상(분석 타입) ── */}
      <div className="section">
        <label className="section-label" style={{ fontSize: '10px' }}>수집 대상</label>
        <div className="segmented-control" style={{ marginBottom: '8px' }}>
          {(['both', 'post', 'comment'] as AnalysisType[]).map((t) => (
            <label
              key={t}
              className={`segment-label ${analysisType === t ? 'selected' : ''} ${analysisStatus !== 'idle' ? 'disabled' : ''}`}
            >
              <input
                type="radio"
                name="analysisType"
                checked={analysisType === t}
                onChange={() => onTypeChange(t)}
                disabled={analysisStatus !== 'idle'}
              />
              {t === 'comment' ? '댓글만' : t === 'post' ? '글만' : '글+댓글'}
            </label>
          ))}
        </div>
      </div>

      {/* ── 페이지 범위 ── */}
      <div className="section">
        <label className="section-label" style={{ fontSize: '10px' }}>페이지 범위</label>
        <div className="row-flex">
          <input
            className="input input-page"
            type="number"
            min="1"
            placeholder="시작 (기본 1)"
            value={startPage}
            onChange={(e) => onStartPageChange(e.target.value)}
            disabled={analysisStatus !== 'idle'}
          />
          <span className="date-sep">~</span>
          <input
            className="input input-page"
            type="number"
            min="1"
            placeholder="끝 (비우면 날짜)"
            value={endPage}
            onChange={(e) => onEndPageChange(e.target.value)}
            disabled={analysisStatus !== 'idle'}
          />
        </div>
        <p className="hint">끝 페이지를 비우면 날짜 범위 기준으로 종료</p>
      </div>

      {/* ── 날짜 범위 ── */}
      <div className="section" style={{ marginTop: '4px' }}>
        <label className="section-label" style={{ fontSize: '10px' }}>날짜 범위 (선택)</label>
        <div className="row-flex">
          <input
            className="input input-date"
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            disabled={analysisStatus !== 'idle'}
          />
          <span className="date-sep">~</span>
          <input
            className="input input-date"
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            disabled={analysisStatus !== 'idle'}
          />
        </div>
        <p className="hint">비우면 날짜 필터 없이 페이지 범위만 적용</p>
      </div>

      {/* ── 시작 / 제어 버튼 ── */}
      <div style={{ marginTop: '1.2rem' }}>
        {analysisStatus === 'idle' ? (
          <button
            className="btn btn-accent"
            onClick={onStart}
            disabled={!galleryVerified || !startDate || !endDate}
          >
            크롤링 시작
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, backgroundColor: analysisStatus === 'paused' ? 'var(--ok)' : '#f59e0b', color: '#fff' }}
              onClick={onPauseToggle}
            >
              {analysisStatus === 'paused' ? '계속' : '일시정지'}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, backgroundColor: 'var(--err)', color: '#fff', border: 'none' }}
              onClick={onStop}
            >
              수집 중단
            </button>
          </div>
        )}
      </div>

      {analysisStatus !== 'idle' && progress && (
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px' }}>
            <span style={{ color: 'var(--fg-dim)' }}>
              {progress.current} / {progress.total} ({pct}%)
            </span>
            {progress.message && (
              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{progress.message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
