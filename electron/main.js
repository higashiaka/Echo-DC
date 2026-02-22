'use strict'

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')

const { checkGallery, crawlGallery } = require('./crawler/galleryHelper')
const { crawlComments } = require('./crawler/commentHelper')
const { aggregatePosts, mergeResults, toRanking, toText } = require('./crawler/userManager')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow = null
let stopFlag = false

function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Echo-DC',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── IPC 핸들러 ────────────────────────────────────────────

// 갤러리 유효성 검사
ipcMain.handle('check-gallery', async (_e, gallId, gallType) => {
  return await checkGallery(gallId, gallType)
})

// 크롤링 중지
ipcMain.handle('stop-crawl', () => {
  stopFlag = true
})

// 크롤링 시작
ipcMain.handle('start-crawl', async (_e, params) => {
  stopFlag = false

  const {
    gallId,
    gallType,
    startPage,
    endPage,
    startDate,
    endDate,
    gallName,
    mode = 'both',   // 'post' | 'comment' | 'both'
  } = params

  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  const isStopped = () => stopFlag

  try {
    // ── 1단계: 게시글 목록 크롤링 ──────────────────────────
    send('crawl-progress', { phase: 'gallery', log: `[시작] 게시글 수집 시작...` })

    const { posts, postsWithComments } = await crawlGallery({
      gallId,
      gallType,
      startPage: startPage || 1,
      endPage: endPage || null,
      startDate: startDate || null,   // "YYYY-MM-DD" 문자열 그대로 전달 (타임존 변환 없음)
      endDate: endDate || null,
      onProgress: ({ page, log }) => {
        send('crawl-progress', { phase: 'gallery', page, log })
      },
      isStopped,
    })

    if (isStopped()) {
      send('crawl-error', '사용자가 중지했습니다.')
      return
    }

    send('crawl-progress', {
      phase: 'gallery',
      log: `[완료] 총 ${posts.length}개 게시글 수집, 댓글 있는 게시글: ${postsWithComments.length}개`,
    })

    // ── 2단계: 댓글 수집 (mode가 'post'면 생략) ────────────
    let commentMap = new Map()
    if (mode !== 'post') {
      send('crawl-progress', { phase: 'comment', log: `[시작] 댓글 수집 시작...` })

      commentMap = await crawlComments(
        gallId,
        gallType,
        postsWithComments,
        ({ current, total, log }) => {
          send('crawl-progress', { phase: 'comment', current, total, log })
        },
        isStopped
      )

      if (isStopped()) {
        send('crawl-error', '사용자가 중지했습니다.')
        return
      }

      send('crawl-progress', { phase: 'comment', log: `[완료] 댓글 집계 완료` })
    }

    // ── 3단계: 집계 및 랭킹 산출 ──────────────────────────
    // mode가 'comment'면 게시글 수는 집계에서 제외
    const postMap = mode !== 'comment' ? aggregatePosts(posts) : new Map()
    const merged = mergeResults(postMap, commentMap)

    const combinedRanking = toRanking(merged, 'combined')
    const postRanking = toRanking(merged, 'post')
    const commentRanking = toRanking(merged, 'comment')

    const totalPosts = posts.length
    const totalComments = Array.from(commentMap.values()).reduce((s, u) => s + u.commentCount, 0)

    send('crawl-done', {
      gallName,
      totalPosts,
      totalComments,
      combinedRanking,
      postRanking,
      commentRanking,
    })
  } catch (e) {
    send('crawl-error', `오류 발생: ${e.message}`)
  }
})

// 파일 저장
ipcMain.handle('save-result', async (_e, content, defaultName, filters) => {
  if (!mainWindow) return { ok: false }

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'ranking.txt',
    filters: filters || [{ name: 'Text', extensions: ['txt'] }],
  })

  if (canceled || !filePath) return { ok: false }

  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, message: e.message }
  }
})
