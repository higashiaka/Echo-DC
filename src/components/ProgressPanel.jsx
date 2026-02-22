import { useEffect, useRef } from 'react'
import './ProgressPanel.css'

export default function ProgressPanel({ logs, phase, current, total, isCrawling }) {
  const logRef = useRef(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  const phaseLabel = phase === 'gallery' ? '게시글 수집' : phase === 'comment' ? '댓글 수집' : ''

  return (
    <section className="card progress-card">
      <h2 className="card-title">진행 상황</h2>

      {isCrawling && phaseLabel && (
        <div className="progress-bar-wrap">
          <div className="progress-bar-label">
            {phaseLabel} {total > 0 ? `${current}/${total} (${pct}%)` : ''}
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: total > 0 ? `${pct}%` : '100%', animation: total === 0 ? 'pulse 1.5s infinite' : 'none' }}
            />
          </div>
        </div>
      )}

      <div className="log-area" ref={logRef}>
        {logs.length === 0 ? (
          <span className="log-empty">로그가 여기에 표시됩니다.</span>
        ) : (
          logs.map((l, i) => <div key={i} className="log-line">{l}</div>)
        )}
      </div>
    </section>
  )
}
