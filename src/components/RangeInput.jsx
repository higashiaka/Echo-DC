import './RangeInput.css'

const MODES = [
  { value: 'both',    label: '글+댓글' },
  { value: 'post',    label: '글만' },
  { value: 'comment', label: '댓글만' },
]

export default function RangeInput({ range, onChange, mode, onModeChange, disabled }) {
  const set = (key, val) => onChange({ ...range, [key]: val })

  return (
    <section className="card">
      <h2 className="card-title">크롤링 범위</h2>

      <div className="range-group">
        <span className="range-label">수집 대상</span>
        <div className="mode-toggle">
          {MODES.map(({ value, label }) => (
            <button
              key={value}
              className={`mode-btn${mode === value ? ' active' : ''}`}
              onClick={() => onModeChange(value)}
              disabled={disabled}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="range-group">
        <span className="range-label">페이지 범위</span>
        <div className="range-row">
          <input
            className="range-input"
            type="number"
            min="1"
            placeholder="시작 (기본 1)"
            value={range.startPage}
            disabled={disabled}
            onChange={e => set('startPage', e.target.value)}
          />
          <span className="range-sep">~</span>
          <input
            className="range-input"
            type="number"
            min="1"
            placeholder="끝 (비우면 날짜까지)"
            value={range.endPage}
            disabled={disabled}
            onChange={e => set('endPage', e.target.value)}
          />
        </div>
        <p className="range-hint">끝 페이지를 비우면 날짜 범위 기준으로 종료</p>
      </div>

      <div className="range-group">
        <span className="range-label">날짜 범위 (선택)</span>
        <div className="range-row">
          <input
            className="range-input date-input"
            type="date"
            value={range.startDate}
            disabled={disabled}
            onChange={e => set('startDate', e.target.value)}
          />
          <span className="range-sep">~</span>
          <input
            className="range-input date-input"
            type="date"
            value={range.endDate}
            disabled={disabled}
            onChange={e => set('endDate', e.target.value)}
          />
        </div>
        <p className="range-hint">비우면 날짜 필터 없이 페이지 범위만 적용</p>
      </div>
    </section>
  )
}
