import React, { useState, useMemo } from 'react'
import type { UserRank, AnalysisType, SaveResultOptions } from '../../../shared/ipc-types'

interface Props {
  data: UserRank[]
  analysisType: AnalysisType
  galleryName: string
  startDate: string
  endDate: string
  onDataChange: (data: UserRank[]) => void
}

export function RankingTable({
  data,
  analysisType,
  galleryName,
  startDate,
  endDate,
  onDataChange
}: Props): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [maxRank, setMaxRank] = useState('999')
  const [minCount, setMinCount] = useState('1')
  const [isSaving, setIsSaving] = useState(false)

  const countOf = (u: UserRank) =>
    analysisType === 'both' ? u.postCount + u.commentCount : analysisType === 'comment' ? u.commentCount : u.postCount

  const totalCount = useMemo(
    () =>
      data.reduce(
        (s, u) =>
          s +
          (analysisType === 'both'
            ? u.postCount + u.commentCount
            : analysisType === 'comment'
              ? u.commentCount
              : u.postCount),
        0
      ),
    [data, analysisType]
  )

  const filtered = useMemo(() => {
    if (!search) return data
    return data.filter((u) => u.name.includes(search) || u.uid.includes(search))
  }, [data, search])

  // 같은 UID를 가진 고정 유저를 합산·병합
  const handleMerge = () => {
    const merged = new Map<string, UserRank>()
    for (const u of data) {
      if (u.isFluid) {
        const key = `ip:${u.name}:${u.ip}`
        merged.set(key, u)
      } else {
        const key = `uid:${u.uid}`
        const existing = merged.get(key)
        if (existing) {
          existing.commentCount += u.commentCount
          existing.postCount += u.postCount
          if (existing.name !== u.name) existing.name += `+${u.name}`
        } else {
          merged.set(key, { ...u })
        }
      }
    }
    const sorted = Array.from(merged.values()).sort((a, b) => countOf(b) - countOf(a))
    onDataChange(sorted)
  }

  const handleSave = async (format: 'text' | 'html') => {
    setIsSaving(true)
    try {
      const options: SaveResultOptions = {
        galleryName,
        startDate,
        endDate,
        analysisType,
        data,
        maximumRank: parseInt(maxRank) || 100,
        minimumCount: parseInt(minCount) || 1,
        format
      }
      const saved = await window.electron.saveResult(options)
      if (saved) alert(`저장 완료: ${saved}`)
    } finally {
      setIsSaving(false)
    }
  }

  const countLabel = analysisType === 'both' ? '총합 (글/댓글)' : analysisType === 'comment' ? '댓글 수' : '글 수'

  // 표시 순위 계산 (동순위 처리)
  const rows: { rank: number; user: UserRank; count: number; pct: string }[] = []
  let rank = 0
  let displayRank = 0
  let prevCount = -1
  for (const user of filtered) {
    const count = countOf(user)
    rank++
    if (count !== prevCount) displayRank = rank
    prevCount = count
    const pct = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0'
    rows.push({ rank: displayRank, user, count, pct })
  }

  return (
    <div className="ranking-wrap">
      {/* 툴바 및 저장 옵션 */}
      <div className="ranking-toolbar">
        <div className="left" style={{ gap: '8px' }}>
          <button className="btn btn-primary" onClick={handleMerge} disabled={data.length === 0}>
            유저병합
          </button>
          <input
            className="input"
            type="text"
            placeholder="닉네임 / ID 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '180px' }}
          />
        </div>

        <div className="right row-flex" style={{ width: 'auto', gap: '12px' }}>
          <div className="row-flex" style={{ width: 'auto' }}>
            <span className="section-label" style={{ fontSize: '11px' }}>TOP</span>
            <input
              className="input"
              type="number"
              min="1"
              value={maxRank}
              onChange={(e) => setMaxRank(e.target.value)}
              style={{ width: '80px', textAlign: 'left' }}
            />
          </div>
          <div className="row-flex" style={{ width: 'auto' }}>
            <span className="section-label" style={{ fontSize: '11px' }}>최소 {countLabel}</span>
            <input
              className="input"
              type="number"
              min="1"
              value={minCount}
              onChange={(e) => setMinCount(e.target.value)}
              style={{ width: '60px', textAlign: 'left' }}
            />
          </div>
          <div className="row-flex" style={{ width: 'auto', gap: '4px' }}>
            <button
              className="btn btn-primary"
              onClick={() => handleSave('text')}
              disabled={isSaving || data.length === 0}
            >
              TXT
            </button>
            <button
              className="btn btn-accent"
              onClick={() => handleSave('html')}
              disabled={isSaving || data.length === 0}
              style={{ padding: '7px 14px', width: 'auto' }}
            >
              HTML
            </button>
          </div>
        </div>
      </div>

      {/* 테이블 */}
      {data.length === 0 ? (
        <p className="empty-hint">파일을 불러오거나 분석을 완료하면 여기에 표시됩니다</p>
      ) : (
        <div className="table-wrap">
          <table className="rank-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>닉네임 (ID / IP)</th>
                <th className="num-col" style={{ width: '160px' }}>{countLabel}</th>
                <th className="num-col">비율</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rank: r, user, count, pct }, i) => {
                const suffix = user.isFluid ? `(${user.ip})` : `(${user.uid})`
                const displayName = user.name.includes(suffix) ? user.name : `${user.name} ${suffix}`
                return (
                  <tr key={i}>
                    <td className="rank-col">{r}위</td>
                    <td>{displayName}</td>
                    <td className="num-col">
                      {count.toLocaleString()}
                      {analysisType === 'both' && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                          (글 {user.postCount} / 댓 {user.commentCount})
                        </span>
                      )}
                    </td>
                    <td className="num-col">{pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
