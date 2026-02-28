'use strict' // 엄격 모드 사용: 잠재적인 오류를 방지하고 최적화를 돕습니다.

// Electron 기본 모듈들을 불러옵니다. 앱 생명주기 관리, 브라우저 창 생성, IPC 통신 등에 사용됩니다.
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path') // 파일 및 디렉토리 경로 작업을 위한 Node.js 기본 모듈입니다.
const fs = require('fs') // 파일 시스템 조작을 위한 Node.js 기본 모듈입니다.

// 크롤링 관련 커스텀 헬퍼 모듈들을 불러옵니다. 이들은 실제 DCInside 데이터를 가져오는 역할을 합니다.
const { checkGallery, crawlGallery } = require('./crawler/galleryHelper') // 갤러리 확인 및 게시글 목록 크롤링 함수입니다.
const { crawlComments } = require('./crawler/commentHelper') // 게시글별 댓글 수집을 담당하는 함수입니다.
// 수집된 데이터를 가공하고 순위를 산출하는 매니저 모듈입니다.
const { aggregatePosts, mergeResults, toRanking, toText } = require('./crawler/userManager')
const logger = require('./logger') // 앱의 동작 상태와 오류를 기록하기 위한 로거 모듈입니다.

// 개발 모드 여부를 확인합니다. 환경 변수나 패키징 상태를 기준으로 판단합니다.
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow = null // 메인 윈도우 객체를 담을 변수입니다.
let stopFlag = false // 크롤링 중지 요청을 추적하는 플래그입니다.
let pauseFlag = false // 크롤링 일시정지 요청을 추적하는 플래그입니다.
let resumeResolver = null // 일시정지 상태에서 재개할 때 사용하는 Promise resolver입니다.

// Electron 메인 창을 생성하고 설정하는 함수입니다.
function createWindow() {
  Menu.setApplicationMenu(null) // 앱의 기본 메뉴바를 제거하여 깔끔한 UI를 유지합니다.

  // 브라우저 창의 크기와 속성을 정의합니다.
  mainWindow = new BrowserWindow({
    width: 1280, // 넓이 1280px
    height: 720, // 높이 720px
    resizable: false, // 사용자 창 크기 조절 방지 (디자인 일관성 유지)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // 렌더러 프로세스와 통신하기 위한 프리로드 스크립트 설정입니다.
      contextIsolation: true, // 보안을 위한 컨텍스트 격리 설정입니다.
      nodeIntegration: false, // 렌더러 프로세스에서 Node.js 직접 접근을 방지합니다.
    },
    title: 'Echo-DC', // 창의 제목입니다.
  })

  // 개발 모드인 경우 Vite 개발 서버를 로드하고 개발자 도구를 엽니다.
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173') // Vite 기본 포트로 접속합니다.
    mainWindow.webContents.openDevTools() // 개발자 도구 창을 자동으로 엽니다.
  } else {
    // 운영 모드인 경우 빌드된 index.html 파일을 직접 로드합니다.
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 창이 닫힐 때 객체 참조를 해제합니다.
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 앱이 준비되면 메인 창을 생성합니다.
app.whenReady().then(createWindow)

// 모든 창이 닫혔을 때 앱을 종료합니다. (macOS 제외 플랫폼)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 앱이 다시 활성화될 때 창이 없으면 새로 생성합니다. (macOS 전용 동작 대응)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── IPC 핸들러 ────────────────────────────────────────────
// 렌더러 프로세스(UI)에서 보내는 요청을 처리하는 인터페이스 정의 영역입니다.

// 갤러리 ID가 유효한지 검사하는 요청을 처리합니다. galleryHelper의 checkGallery를 호출합니다.
ipcMain.handle('check-gallery', async (_e, gallId, gallType) => {
  return await checkGallery(gallId, gallType)
})

// 크롤링 중지 버튼 클릭 시 호출됩니다.
ipcMain.handle('stop-crawl', () => {
  stopFlag = true // 중지 플래그를 참으로 설정합니다.
  pauseFlag = false // 일시정지 중이었다면 해제합니다.
  // 일시정지 대기 중인 비동기 작업이 있다면 인위적으로 재개시켜 종료 로직을 타게 합니다.
  if (resumeResolver) {
    const r = resumeResolver
    resumeResolver = null
    r()
  }
})

// 크롤링 일시정지 요청을 처리합니다.
ipcMain.handle('pause-crawl', () => {
  pauseFlag = true // 일시정지 플래그를 참으로 설정합니다.
})

// 크롤링 재개 요청을 처리합니다.
ipcMain.handle('resume-crawl', (_e) => {
  pauseFlag = false // 일시정지 플래그를 거짓으로 설정합니다.
  // 대기 중이던 resolve 함수를 실행하여 막혀있던 루프를 진행시킵니다.
  if (resumeResolver) {
    const r = resumeResolver
    resumeResolver = null
    r()
  }
})

// 실제 데이터 수집(크롤링)을 시작하는 메인 핸들러입니다.
ipcMain.handle('start-crawl', async (_e, params) => {
  stopFlag = false // 작업 시작 시 중지 플래그 초기화
  pauseFlag = false // 작업 시작 시 일시정지 플래그 초기화
  resumeResolver = null // 리졸버 초기화

  // 프론트엔드로부터 전달받은 파라미터들을 구조 분해 할당합니다.
  const {
    gallId, // 갤러리 ID
    gallType, // 갤러리 타입 (마이너, 미니 등)
    startPage, // 수집 시작 페이지
    endPage, // 수집 종료 페이지
    startDate, // 수집 시작 날짜
    endDate, // 수집 종료 날짜
    gallName, // 갤러리 이름
    mode = 'both', // 수집 모드: 게시글만, 댓글만, 혹은 둘 다
  } = params

  // 렌더러 프로세스로 실시간 진행 상태 정보를 전달하는 내부 헬퍼 함수입니다.
  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  // 루프 도중 중지 여부를 체크하기 위한 함수입니다.
  const isStopped = () => stopFlag

  // 일시정지 상태인 경우 작업을 대기시키는 함수입니다.
  const waitIfPaused = () => {
    if (!pauseFlag) return Promise.resolve() // 일시정지가 아니면 즉시 통과
    const pauseMsg = '[일시정지] 재개 버튼을 누를 때까지 대기 중...'
    send('crawl-progress', { phase: 'comment', log: pauseMsg }) // UI에 상태 전달
    logger.log(pauseMsg) // 로그 기록
    // 재개 요청이 올 때까지 Resolve되지 않는 Promise를 반환하여 실행을 막습니다.
    return new Promise(resolve => { resumeResolver = resolve })
  }

  // 크롤링 세션을 시작하고 로그 파일 이름을 반환받습니다. logger 모듈을 사용합니다.
  const logFile = logger.startSession(gallId, { startDate, endDate, startPage, endPage, mode })

  try {
    // ── 1단계: 게시글 목록 크롤링 ──────────────────────────
    const galleryStartMsg = `[시작] 게시글 수집 시작...`
    send('crawl-progress', { phase: 'gallery', log: galleryStartMsg })
    logger.log(galleryStartMsg)

    // galleryHelper의 crawlGallery 함수를 호출하여 게시글 목록을 가져옵니다.
    const { posts, postsWithComments } = await crawlGallery({
      gallId,
      gallType,
      startPage: startPage || 1,
      endPage: endPage || null,
      startDate: startDate || null,
      endDate: endDate || null,
      onProgress: ({ page, log: msg }) => {
        // 매 페이지 수집마다 UI에 진행 상황을 업데이트합니다.
        send('crawl-progress', { phase: 'gallery', page, log: msg })
        logger.log(msg)
      },
      isStopped, // 중지 여부 확인용 콜백 전달
    })

    // 중간에 중지되었는지 확인합니다.
    if (isStopped()) {
      const stopMsg = '사용자가 중지했습니다.'
      logger.log(`[중지] ${stopMsg}`)
      logger.endSession('중지됨')
      send('crawl-error', stopMsg)
      return
    }

    const galleryDoneMsg = `[완료] 총 ${posts.length}개 게시글 수집, 댓글 있는 게시글: ${postsWithComments.length}개`
    send('crawl-progress', { phase: 'gallery', log: galleryDoneMsg })
    logger.log(galleryDoneMsg)

    // ── 2단계: 댓글 수집 (mode가 'post'면 생략) ────────────
    let commentMap = new Map() // 사용자별 댓글 수를 저장할 Map 객체입니다.
    if (mode !== 'post') {
      const commentStartMsg = `[시작] 댓글 수집 시작...`
      send('crawl-progress', { phase: 'comment', log: commentStartMsg })
      logger.log(commentStartMsg)

      // commentHelper의 crawlComments 함수를 호출하여 실제 댓글 데이터를 수집합니다.
      commentMap = await crawlComments(
        gallId,
        gallType,
        postsWithComments, // 댓글이 달린 게시글 리스트 전달
        ({ current, total, log: msg }) => {
          // 실시간 수집 개수 정보를 UI로 보냅니다.
          send('crawl-progress', { phase: 'comment', current, total, log: msg })
          logger.log(msg)
        },
        isStopped, // 중지 콜백
        waitIfPaused // 일시정지 콜백
      )

      if (isStopped()) {
        const stopMsg = '사용자가 중지했습니다.'
        logger.log(`[중지] ${stopMsg}`)
        logger.endSession('중지됨')
        send('crawl-error', stopMsg)
        return
      }

      const commentDoneMsg = `[완료] 댓글 집계 완료`
      send('crawl-progress', { phase: 'comment', log: commentDoneMsg })
      logger.log(commentDoneMsg)
    }

    // ── 3단계: 집계 및 랭킹 산출 ──────────────────────────
    // userManager 모듈을 사용하여 데이터를 바탕으로 랭킹 정보를 계산합니다.
    const postMap = mode !== 'comment' ? aggregatePosts(posts) : new Map() // 게시글 기반 집계
    const merged = mergeResults(postMap, commentMap) // 게시글과 댓글 데이터 통합

    const combinedRanking = toRanking(merged, 'combined') // 통합 랭킹 (글+댓글)
    const postRanking = toRanking(merged, 'post') // 게시글 전용 랭킹
    const commentRanking = toRanking(merged, 'comment') // 댓글 전용 랭킹

    const totalPosts = posts.length // 총 수집 게시글 수
    // Map 내의 유저 객체들의 댓글 수를 모두 합산합니다.
    const totalComments = Array.from(commentMap.values()).reduce((s, u) => s + u.commentCount, 0)

    // 세션 종료 로그를 기록합니다.
    logger.endSession(`게시글 ${totalPosts}개 / 댓글 ${totalComments}개 수집 완료`)

    // 최종 결과 데이터를 UI 프로세스로 전송합니다.
    send('crawl-done', {
      gallName,
      totalPosts,
      totalComments,
      combinedRanking,
      postRanking,
      commentRanking,
      logFile,
    })
  } catch (e) {
    // 런타임 오류 시 스택 정보를 기록하고 UI에 오류 알림을 보냅니다.
    logger.error(e.stack || e.message)
    logger.endSession(`오류로 종료: ${e.message}`)
    send('crawl-error', `오류 발생: ${e.message}`)
  }
})

// 수집된 결과를 파일(.txt 등)로 저장하는 요청을 처리합니다.
ipcMain.handle('save-result', async (_e, content, defaultName, filters) => {
  if (!mainWindow) return { ok: false }

  // OS 표준 저장 대화상자를 엽니다.
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'ranking.txt',
    filters: filters || [{ name: 'Text', extensions: ['txt'] }],
  })

  // 사용자가 취소했으면 중단합니다.
  if (canceled || !filePath) return { ok: false }

  try {
    // 파일 시스템(fs)을 통해 실제 내용을 파일로 씁니다.
    fs.writeFileSync(filePath, content, 'utf-8')
    return { ok: true, filePath }
  } catch (e) {
    // 파일 쓰기 실패 시 에러 메시지 반환
    return { ok: false, message: e.message }
  }
})

