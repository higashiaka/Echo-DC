import { useState } from 'react'
import './ResultTabs.css'

const TABS = [
  { key: 'combined', label: '통합 (글+댓글)', rankKey: 'combinedRanking' },
  { key: 'post', label: '글 수', rankKey: 'postRanking' },
  { key: 'comment', label: '댓글 수', rankKey: 'commentRanking' },
]

export default function ResultTabs({ result }) {
  const [activeTab, setActiveTab] = useState('combined')

  const tab = TABS.find(t => t.key === activeTab)
  const ranking = result[tab.rankKey] || []

  const handleSave = async (format = 'txt') => {
    let content = ''
    let defaultName = ''
    let filters = []

    if (format === 'html') {
      content = buildHtml(result, activeTab, ranking)
      defaultName = `${result.gallName}_${tab.label}_${new Date().toISOString().slice(0, 10)}.html`
      filters = [{ name: 'HTML', extensions: ['html'] }]
    } else {
      content = buildText(result, activeTab, ranking)
      defaultName = `${result.gallName}_${tab.label}_${new Date().toISOString().slice(0, 10)}.txt`
      filters = [{ name: 'Text', extensions: ['txt'] }]
    }

    const res = await window.dcAPI.saveResult(content, defaultName, filters)
    if (res.ok) alert(`저장 완료: ${res.filePath}`)
    else if (res.message) alert(`저장 실패: ${res.message}`)
  }

  return (
    <div className="result-wrap">
      <div className="result-header">
        <div className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="result-meta">
          <span>{result.gallName}</span>
          <span>총 글 {result.totalPosts.toLocaleString()}</span>
          <span>총 댓글 {result.totalComments.toLocaleString()}</span>
          <div className="save-btns">
            <button className="btn-save" onClick={() => handleSave('txt')}>TXT 저장</button>
            <button className="btn-save btn-html" onClick={() => handleSave('html')}>HTML 저장</button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>닉네임</th>
              <th>ID / IP</th>
              {(activeTab === 'combined' || activeTab === 'post') && <th>글 수</th>}
              {(activeTab === 'combined' || activeTab === 'comment') && <th>댓글 수</th>}
              {activeTab === 'combined' && <th>합계</th>}
            </tr>
          </thead>
          <tbody>
            {ranking.map((u, i) => (
              <tr key={i} className={i < 3 ? `rank-top-${i + 1}` : ''}>
                <td className="td-rank">{i + 1}위</td>
                <td className="td-nick">{u.nick}</td>
                <td className="td-id">{u.isFluid ? u.ip : u.uid}</td>
                {(activeTab === 'combined' || activeTab === 'post') && (
                  <td className="td-num">{u.postCount.toLocaleString()}</td>
                )}
                {(activeTab === 'combined' || activeTab === 'comment') && (
                  <td className="td-num">{u.commentCount.toLocaleString()}</td>
                )}
                {activeTab === 'combined' && (
                  <td className="td-num td-combined">
                    {(u.postCount + u.commentCount).toLocaleString()}
                  </td>
                )}
              </tr>
            ))}
            {ranking.length === 0 && (
              <tr>
                <td colSpan={6} className="td-empty">데이터 없음</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function buildHtml(result, mode, ranking) {
  const headers = ['순위', '이름', '식별코드']
  if (mode === 'combined' || mode === 'post') headers.push('글')
  if (mode === 'combined' || mode === 'comment') headers.push('댓글')
  if (mode === 'combined') headers.push('합계')

  let html = '<table>\n'
  html += '    <thead>\n'
  html += '        <tr>\n'
  headers.forEach(h => {
    html += `            <th>${h}</th>\n`
  })
  html += '        </tr>\n'
  html += '    </thead>\n'
  html += '    <tbody>\n'

  ranking.forEach((u, i) => {
    const id = u.isFluid ? u.ip : u.uid
    html += '        <tr>'
    html += `<td>${i + 1}위</td>`
    html += `<td>${u.nick}</td>`
    html += `<td>${id}</td>`

    if (mode === 'combined' || mode === 'post') {
      html += `<td>${u.postCount}</td>`
    }
    if (mode === 'combined' || mode === 'comment') {
      html += `<td>${u.commentCount}</td>`
    }
    if (mode === 'combined') {
      html += `<td>${u.postCount + u.commentCount}</td>`
    }

    html += '</tr>\n'
  })

  html += '    </tbody>\n'
  html += '</table>'
  return html
}

function buildText(result, mode, ranking) {
  const modeLabel = { combined: '글+댓글 통합', post: '글 수', comment: '댓글 수' }[mode]
  const lines = [
    `${result.gallName} ${modeLabel} 랭킹`,
    `총 글: ${result.totalPosts} | 총 댓글: ${result.totalComments}`,
    '─'.repeat(60),
  ]

  if (mode === 'combined') {
    lines.push('순위\t\t닉네임\t\tID/IP\t\t글 수\t\t댓글 수\t\t합산')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
      lines.push(`${i + 1}위\t${u.nick}\t${id}\t${u.postCount}\t${u.commentCount}\t${u.postCount + u.commentCount}`)
    })
  } else if (mode === 'post') {
    lines.push('순위\t\t닉네임\t\tID/IP\t\t글 수')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
      lines.push(`${i + 1}위\t${u.nick}\t${id}\t${u.postCount}`)
    })
  } else {
    lines.push('순위\t\t닉네임\t\tID/IP\t\t댓글 수')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
      lines.push(`${i + 1}위\t${u.nick}\t${id}\t${u.commentCount}`)
    })
  }

  return lines.join('\n')
}
