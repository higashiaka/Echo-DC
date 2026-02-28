import React, { useEffect, useRef } from 'react'

interface Props {
  logs: string[]
}

export function LogConsole({ logs }: Props): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="section log-section">
      <div className="log-console">
        {logs.length === 0 ? (
          <span className="log-empty">수집을 시작하면 로그가 여기 표시됩니다</span>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="log-line">
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
