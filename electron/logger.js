'use strict' // 엄격 모드 사용: 예기치 않은 오류 방지

const fs = require('fs') // 파일 시스템 조작을 위한 Node.js 기본 모듈입니다.
const path = require('path') // 경로 계산을 위한 Node.js 기본 모듈입니다.
const { app } = require('electron') // Electron 앱의 정보 및 경로 획득을 위해 사용합니다.

let logStream = null // 로그 파일에 데이터를 쓰기 위한 WriteStream 객체입니다.
let currentLogFile = null // 현재 작성 중인 로그 파일의 절대 경로입니다.

/**
 * 앱이 로그를 저장할 디렉토리 경로를 결정합니다.
 */
function getLogDir() {
  try {
    return app.getPath('logs') // 시스템 권장 로그 폴더 경로를 시도합니다.
  } catch {
    // 만약 실패하면 앱 데이터 폴더 내에 'logs' 하위 폴더를 경로로 사용합니다.
    return path.join(app.getPath('userData'), 'logs')
  }
}

/**
 * 새로운 크롤링 세션이 시작될 때 로그 파일을 생성하고 스트림을 엽니다.
 * @param {string} gallId - 갤러리 ID
 * @param {object} params - 크롤링 조건 (페이지, 날짜 등)
 * @returns {string} 생성된 로그 가공 경로
 */
function startSession(gallId, params = {}) {
  // 이미 열려있는 세션이 있다면 강제로 종료하고 새 세션을 시작합니다.
  endSession('(이전 세션 강제 종료)')

  const logDir = getLogDir()
  // 로그 폴더가 없으면 생성합니다.
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })

  const now = new Date()
  // 파일명에 사용할 타임스탬프를 생성합니다 (예: 2024-02-25-14-15-00).
  const ts = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  currentLogFile = path.join(logDir, `crawl-${ts}-${gallId}.log`)
  // 실제 파일에 데이터를 이어 쓸 수 있도록 스트림을 생성합니다.
  logStream = fs.createWriteStream(currentLogFile, { flags: 'a', encoding: 'utf-8' })

  // 로그 파일 상단에 기록할 세션 정보 헤더를 구성합니다.
  const header = [
    '='.repeat(60),
    `Echo-DC 크롤링 로그`,
    `시작: ${now.toLocaleString('ko-KR')}`,
    `갤러리: ${gallId}`,
    params.startDate || params.endDate
      ? `기간: ${params.startDate || '처음'} ~ ${params.endDate || '현재'}`
      : null,
    params.startPage || params.endPage
      ? `페이지: ${params.startPage || 1} ~ ${params.endPage || '끝'}`
      : null,
    `모드: ${params.mode || 'both'}`,
    '='.repeat(60),
  ].filter(Boolean).join('\n')

  logStream.write(header + '\n') // 헤더를 파일에 씁니다.

  return currentLogFile // 생성된 파일 경로 반환
}

/**
 * 세션을 종료하고 로그 파일 스트림을 닫습니다.
 */
function endSession(summary = '') {
  if (!logStream) return // 열려있는 스트림이 없으면 무시
  const now = new Date()
  logStream.write(`${'='.repeat(60)}\n`)
  // 종료 시간과 작업 요약(성공/중지 등)을 기록합니다.
  logStream.write(`종료: ${now.toLocaleString('ko-KR')}${summary ? `  ${summary}` : ''}\n`)
  logStream.write(`${'='.repeat(60)}\n`)
  logStream.end() // 스트림 종료
  logStream = null
}

/**
 * 일반 로그 메시지를 타임스탬프와 함께 파일에 한 줄 기록합니다.
 */
function log(msg) {
  if (!logStream) return
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23)
  logStream.write(`[${ts}] ${msg}\n`)
}

/**
 * 오류 발생 시 [ERROR] 태그를 붙여 로그 파일에 기록합니다.
 */
function error(msg) {
  if (!logStream) return
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23)
  logStream.write(`[${ts}] [ERROR] ${msg}\n`)
}

/**
 * 현재 활성화된 로그 파일 경로를 반환합니다.
 */
function getLogFile() {
  return currentLogFile
}

/**
 * 로그 폴더 경로를 외부로 반환합니다.
 */
function getLogDir2() {
  return getLogDir()
}

// 다른 모듈에서 로거 기능을 사용할 수 있도록 내보냅니다.
module.exports = { startSession, endSession, log, error, getLogFile, getLogDir: getLogDir2 }

