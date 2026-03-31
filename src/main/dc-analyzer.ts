import { load } from 'cheerio'
import { DCClient } from './dc-client'
import type {
  GalleryInfo,
  GalleryType,
  AnalyzeOptions,
  UserRank,
  ProgressInfo
} from '../shared/ipc-types'


const COMMENT_API = 'https://m.dcinside.com/ajax/response-comment'

type LogFn = (msg: string) => void
type ProgressFn = (p: ProgressInfo) => void

// 갤러리 검증용 모바일 URL (path 방식, ?page=N 별도 붙임)
function buildGalleryUrl(gallId: string, gallType: GalleryType): string {
  if (gallType === 2) return `https://m.dcinside.com/mini/${gallId}`
  return `https://m.dcinside.com/board/${gallId}`
}

// 갤러리 목록 크롤링용 데스크탑 URL (sources/DCHelper.cs AnalyzeGallery 방식, &page=N 붙임)
function buildDesktopGalleryUrl(gallId: string, gallType: GalleryType): string {
  switch (gallType) {
    case 1: return `https://gall.dcinside.com/mgallery/board/lists/?id=${gallId}`
    case 2: return `https://gall.dcinside.com/mini/board/lists/?id=${gallId}`
    default: return `https://gall.dcinside.com/board/lists/?id=${gallId}`
  }
}

// 미니갤은 댓글 API 아이디에 mi$ 접두사 필요
function buildApiGallId(gallId: string, gallType: GalleryType): string {
  return gallType === 2 ? `mi$${gallId}` : gallId
}

// 모바일 웹 게시글 URL (429 폴백용)
function buildMobilePostUrl(gallId: string, gallType: GalleryType, gallNum: string): string {
  const base = gallType === 2
    ? `https://m.dcinside.com/mini/${gallId}/${gallNum}`
    : `https://m.dcinside.com/board/${gallId}/${gallNum}`
  return base
}

// 숫자 추출 (쉼표 제거 후), 없으면 0
function extractInt(str: string): number {
  const m = str.replace(/,/g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

// Date → YYYYMMDD 문자열
function dateToVal(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// YYYYMMDD 문자열 → Date
function valToDate(v: string): Date {
  return new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`)
}

export class DCAnalyzer {
  private client: DCClient
  private sessionInitialized = false
  public isPaused = false
  public isStopped = false

  public pause(): void {
    this.isPaused = true
  }

  public resume(): void {
    this.isPaused = false
  }

  public stop(): void {
    this.isStopped = true
    this.isPaused = false // pause 상태에서 강제 종료 시 탈출을 위함
  }

  constructor() {
    this.client = new DCClient()
  }

  private async ensureSession(): Promise<void> {
    if (!this.sessionInitialized) {
      await this.client.initSession()
      this.sessionInitialized = true
    }
  }

  // ── 대기 루프 (일시정지 처리용) ──────────────────────────
  private async checkPause(): Promise<void> {
    while (this.isPaused && !this.isStopped) {
      // 100ms마다 상태 확인
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // ── 갤러리 검증 ─────────────────────────────────────────────
  async verifyGallery(gallId: string, gallType: GalleryType): Promise<GalleryInfo | null> {
    await this.ensureSession()

    const baseUrl = buildGalleryUrl(gallId, gallType)
    const url = `${baseUrl}?page=1`

    let result = await this.client.get(url)

    // 리다이렉트 또는 빈 응답 → 세션 재초기화 후 1회 재시도
    if (result.status >= 300 || !result.data) {
      await this.client.initSession()
      result = await this.client.get(url)
      if (result.status >= 300 || !result.data) return null
    }

    const $ = load(result.data)

    // 갤러리 이름 후보 셀렉터 (우선순위 순, galleryHelper.js 참조)
    const nameCandidates: Array<() => string> = [
      () => $('h3.gall-tit a').first().text().trim(),
      () => $('h3.gall-tit').clone().children().remove().end().text().trim(),
      () => $('h4.gall_tit').find('a').first().text().trim(),
      () => $('h4.gall_tit').clone().children().remove().end().text().trim(),
      () => $('h2.title_txt').text().trim(),
      () => ($('meta[property="og:title"]').attr('content') ?? '').split(':')[0].trim(),
      () => $('title').text().replace(/\s*[-–|]\s*디시인사이드.*$/i, '').trim()
    ]

    let gallName = ''
    for (const fn of nameCandidates) {
      gallName = fn()
      if (gallName) break
    }

    // 게시글 목록도 없고 이름도 못 찾으면 잘못된 갤러리
    const rows = $('ul.gall-detail-lst > li')
    if (rows.length === 0 && !gallName) return null

    return { id: gallId, name: gallName || gallId, url: baseUrl, type: gallType }
  }

  // ── 댓글 랭킹 분석 (데스크탑 목록 크롤링 + 모바일 댓글 API) ──
  // sources/DCHelper.cs AnalyzeGallery + getComment 방식과 동일
  async analyzeComments(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    const { galleryId, galleryType, startPage, endPage, startDate, endDate } = options

    const baseUrl = buildDesktopGalleryUrl(galleryId, galleryType)
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T23:59:59')
    const startVal = dateToVal(start)
    const endVal = dateToVal(end)
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000)

    const userMap = new Map<string, UserRank>()
    const processedPostIds = new Set<string>() // 중복 수집 방지
    let page = startPage

    while (!this.isStopped) {
      await this.checkPause()
      if (this.isStopped) break

      const { data: html, status } = await this.client.getPage(`${baseUrl}&page=${page}`)
      if (status >= 300 || !html) {
        onLog(`[오류] 페이지 ${page} 접근 불가 (status: ${status})`)
        break
      }

      const $ = load(html)
      // 데스크탑 HTML 셀렉터 (sources/DCHelper.cs와 동일)
      const rows = $('tr.ub-content.us-post').toArray()
      if (rows.length === 0) break

      // DCInside 목록 구조: 상단 고정글(공지) → 일반글(최신순)
      // 마지막 행 = 해당 페이지 가장 오래된 일반글 → C# htmlNodeCollection.Last 방식
      let lastRowDateVal = ''

      for (const el of rows) {
        const row = $(el)

        // 날짜를 먼저 추출해 lastRowDateVal 갱신 (상단 고정글 포함 전체 행 추적)
        const dateAttr = row.find('td.gall_date').attr('title') ?? ''
        const dateVal = dateAttr ? dateAttr.slice(0, 10).replace(/-/g, '') : ''
        if (dateVal) lastRowDateVal = dateVal

        const gallNum = row.find('td.gall_num').text().trim()
        if (extractInt(gallNum) >= 1_000_000_000 || !gallNum || !dateVal) continue // 공지·관리글 제외
        if (processedPostIds.has(gallNum)) continue // 중복 스킵
        processedPostIds.add(gallNum)

        if (dateVal > endVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이후글, 작성일: ${dateAttr})`)
          continue
        }
        if (dateVal < startVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이전글, 작성일: ${dateAttr})`)
          continue
        }

        // 댓글 수: gall_subject 유무에 따라 td 위치 다름 (sources/DCHelper.cs 동일 로직)
        const tds = row.children('td').toArray()
        let titleTdIdx = 1
        if (tds.length > 1 && $(tds[1]).hasClass('gall_subject')) titleTdIdx = 2
        const replySpan = $(tds[titleTdIdx]).find('a.reply_numbox span')
        const replyCount = replySpan.length ? extractInt(replySpan.text()) : 0
        if (replyCount <= 0) continue

        onLog(`[수집] ${gallNum} | 댓글 ${replyCount}개 | ${dateAttr}`)
        await this.fetchComments(galleryId, galleryType, gallNum, userMap, onLog)
      }

      // 종료 조건: 마지막 일반글이 시작일 이전 → 이후 페이지에도 범위 내 글 없음
      if (endPage !== null) {
        onProgress({ total: endPage, current: page })
        if (page >= endPage) break
      } else {
        if (lastRowDateVal && lastRowDateVal < startVal) break
        if (lastRowDateVal) {
          const done = Math.ceil((end.getTime() - valToDate(lastRowDateVal).getTime()) / 86400000)
          onProgress({ total: Math.ceil(totalDays), current: done })
        }
      }
      page++
    }

    return Array.from(userMap.values()).sort((a, b) => {
      if (b.commentCount !== a.commentCount) return b.commentCount - a.commentCount
      return a.name.localeCompare(b.name)
    })
  }

  // ── 댓글 수집 (iterative — 재귀 제거) ───────────────────────
  private async fetchComments(
    gallId: string,
    gallType: GalleryType,
    gallNum: string,
    userMap: Map<string, UserRank>,
    onLog: LogFn
  ): Promise<void> {
    const apiGallId = buildApiGallId(gallId, gallType)
    const mobilePostUrl = buildMobilePostUrl(gallId, gallType, gallNum)

    for (let cpage = 1; ; cpage++) {
      let html: string
      try {
        html = await this.client.postForm(COMMENT_API, {
          id: apiGallId,
          no: gallNum,
          cpage: String(cpage),
          managerskill: '',
          csort: '',
          permission_pw: ''
        })
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 429) {
          onLog(`[429] ${gallNum} p${cpage} — 모바일 웹으로 폴백`)
          try {
            const url = `${mobilePostUrl}?cpage=${cpage}`
            const result = await this.client.get(url)
            if (result.status >= 300 || !result.data) break
            html = result.data
          } catch {
            onLog(`[오류] 댓글 로드 실패 (${gallNum} p${cpage}): 폴백도 실패`)
            break
          }
        } else {
          onLog(`[오류] 댓글 로드 실패 (${gallNum} p${cpage}): ${(e as Error).message}`)
          break
        }
      }

      const $ = load(html)
      const comments = $('li[class*="comment"]').toArray()
      if (comments.length === 0) break

      for (const c of comments) {
        const el = $(c)
        const authorEl = el.find('a').first()
        if (!authorEl.length) continue // 삭제된 댓글

        let name = authorEl.text().trim()
        // 고정닉: span.blockCommentId (data-info = uid)
        // 유동닉: span.ip.blockCommentIp (두 클래스 모두 필요 — C# ./a/span[@class='ip blockCommentIp'] 동일)
        const idSpan = el.find('span.blockCommentId')
        const ipSpan = el.find('span.ip.blockCommentIp')

        let uid = ''
        let ip = ''
        let isFluid = false

        if (idSpan.length) {
          uid = idSpan.attr('data-info') ?? ''
        } else if (ipSpan.length) {
          ip = ipSpan.text().replace(/[()]/g, '').trim()
          isFluid = true

          // 닉네임에 (IP)가 포함되어 있으면 제거 (중복 방지)
          if (ip && name.endsWith(`(${ip})`)) {
            name = name.slice(0, -(ip.length + 2)).trim()
          }
        }

        const key = isFluid ? `ip:${name}:${ip}` : `uid:${uid}`
        const existing = userMap.get(key)
        if (existing) {
          existing.commentCount++
        } else {
          userMap.set(key, { name, uid, ip, isFluid, postCount: 0, commentCount: 1 })
        }
      }

      const totalPages = $('div.paging.alg-ct div.rt div.sel-box select option').length
      if (totalPages <= cpage) break
    }
  }

  // ── 글 랭킹 분석 (데스크탑 목록 크롤링) ────────────────────
  async analyzePosts(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    const { galleryId, galleryType, startPage, endPage, startDate, endDate } = options

    const baseUrl = buildDesktopGalleryUrl(galleryId, galleryType)
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T23:59:59')
    const startVal = dateToVal(start)
    const endVal = dateToVal(end)
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000)

    const userMap = new Map<string, UserRank>()
    const processedPostIds = new Set<string>() // 중복 수집 방지
    let page = startPage

    while (!this.isStopped) {
      await this.checkPause()
      if (this.isStopped) break

      const { data: html, status } = await this.client.getPage(`${baseUrl}&page=${page}`)
      if (status >= 300 || !html) {
        onLog(`[오류] 페이지 ${page} 접근 불가 (status: ${status})`)
        break
      }

      const $ = load(html)
      const rows = $('tr.ub-content.us-post').toArray()
      if (rows.length === 0) break

      // DCInside 목록 구조: 상단 고정글(공지) → 일반글(최신순)
      // 마지막 행 = 해당 페이지 가장 오래된 일반글
      let lastRowDateVal = ''

      for (const el of rows) {
        const row = $(el)

        // 날짜를 먼저 추출해 lastRowDateVal 갱신
        const dateAttr = row.find('td.gall_date').attr('title') ?? ''
        const dateVal = dateAttr ? dateAttr.slice(0, 10).replace(/-/g, '') : ''
        if (dateVal) lastRowDateVal = dateVal

        const gallNum = row.find('td.gall_num').text().trim()
        if (extractInt(gallNum) >= 1_000_000_000 || !gallNum || !dateVal) continue
        if (processedPostIds.has(gallNum)) continue // 중복 스킵
        processedPostIds.add(gallNum)

        if (dateVal > endVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이후글, 작성일: ${dateAttr})`)
          continue
        }
        if (dateVal < startVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이전글, 작성일: ${dateAttr})`)
          continue
        }

        // 작성자: td.gall_writer.ub-writer data-nick / data-uid / data-ip
        const writerEl = row.find('td.gall_writer.ub-writer')
        const name = writerEl.attr('data-nick') ?? ''
        const uid = writerEl.attr('data-uid') ?? ''
        const ip = writerEl.attr('data-ip') ?? ''
        if (!name) continue

        const isFluid = uid === ''
        const key = isFluid ? `ip:${name}:${ip}` : `uid:${uid}`
        const existing = userMap.get(key)
        if (existing) {
          existing.postCount++
        } else {
          userMap.set(key, { name, uid, ip, isFluid, postCount: 1, commentCount: 0 })
        }

        onLog(`[수집] ${gallNum} | 작성자: ${name} | ${dateAttr}`)
      }

      if (endPage !== null) {
        onProgress({ total: endPage, current: page })
        if (page >= endPage) break
      } else {
        if (lastRowDateVal && lastRowDateVal < startVal) break
        if (lastRowDateVal) {
          const oldestDate = valToDate(lastRowDateVal)
          const done = Math.ceil((end.getTime() - oldestDate.getTime()) / 86400000)
          onProgress({ total: Math.ceil(totalDays), current: done })
        }
      }
      page++
    }

    return Array.from(userMap.values()).sort((a, b) => {
      if (b.postCount !== a.postCount) return b.postCount - a.postCount
      return a.name.localeCompare(b.name)
    })
  }

  // ── 글+댓글 통합 랭킹 분석 (데스크탑 목록 + 모바일 댓글 API) ──
  // 정확도를 위해 2단계로 분리: 1단계(글 목록 확보) -> 2단계(댓글 상세 수집)
  async analyzeBoth(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    const { galleryId, galleryType, startPage, endPage, startDate, endDate } = options

    const baseUrl = buildDesktopGalleryUrl(galleryId, galleryType)
    const start = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate + 'T23:59:59')
    const startVal = dateToVal(start)
    const endVal = dateToVal(end)
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000)

    const userMap = new Map<string, UserRank>()
    const processedPostIds = new Set<string>() // 중복 수집 방지

    // 1단계에서 수집할 게시글 리스트
    const postsToProcess: Array<{
      id: string;
      name: string;
      uid: string;
      ip: string;
      isFluid: boolean;
      expectedComments: number;
      dateAttr: string;
    }> = []

    let page = startPage
    onLog(`[1단계] 게시글 목록 수집 시작 (시작 페이지: ${page})`)

    // ── 1단계: 게시글 리스트 및 작성자 정보 확보 ────────────────
    while (!this.isStopped) {
      await this.checkPause()
      if (this.isStopped) break

      const { data: html, status } = await this.client.getPage(`${baseUrl}&page=${page}`)
      if (status >= 300 || !html) {
        onLog(`[오류] 페이지 ${page} 접근 불가 (status: ${status})`)
        break
      }

      const $ = load(html)
      const rows = $('tr.ub-content.us-post').toArray()
      if (rows.length === 0) break

      let lastRowDateVal = ''

      for (const el of rows) {
        const row = $(el)
        const gallNum = row.find('td.gall_num').text().trim()

        // 날짜 추출 및 갱신
        const dateAttr = row.find('td.gall_date').attr('title') ?? ''
        const dateVal = dateAttr ? dateAttr.slice(0, 10).replace(/-/g, '') : ''
        if (dateVal) lastRowDateVal = dateVal

        if (extractInt(gallNum) >= 1_000_000_000 || !gallNum || !dateVal) continue
        if (processedPostIds.has(gallNum)) continue // 이미 처리된 글 스킵

        if (dateVal > endVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이후글, 작성일: ${dateAttr})`)
          processedPostIds.add(gallNum)
          continue
        }
        if (dateVal < startVal) {
          onLog(`[스킵] ${gallNum} | 날짜 범위 초과 (이전글, 작성일: ${dateAttr})`)
          processedPostIds.add(gallNum)
          continue
        }

        // 작성자 정보
        const writerEl = row.find('td.gall_writer.ub-writer')
        const name = writerEl.attr('data-nick') ?? ''
        const uid = writerEl.attr('data-uid') ?? ''
        const ip = writerEl.attr('data-ip') ?? ''
        const isFluid = uid === ''

        // 댓글수 예상치
        const tds = row.children('td').toArray()
        let titleTdIdx = 1
        if (tds.length > 1 && $(tds[1]).hasClass('gall_subject')) titleTdIdx = 2
        const replySpan = $(tds[titleTdIdx]).find('a.reply_numbox span')
        const expectedComments = replySpan.length ? extractInt(replySpan.text()) : 0

        postsToProcess.push({
          id: gallNum,
          name,
          uid,
          ip,
          isFluid,
          expectedComments,
          dateAttr
        })
        processedPostIds.add(gallNum)

        // 글 카운트 집계
        if (name) {
          const key = isFluid ? `ip:${name}:${ip}` : `uid:${uid}`
          const existing = userMap.get(key)
          if (existing) {
            existing.postCount++
          } else {
            userMap.set(key, { name, uid, ip, isFluid, postCount: 1, commentCount: 0 })
          }
        }
      }

      onLog(`[진행] 1단계: 페이지 ${page} 완료 (누적 게시글: ${postsToProcess.length}개)`)

      if (endPage !== null) {
        onProgress({ total: endPage, current: page, message: `1단계: 목록 수집 중 (${page}/${endPage})` })
        if (page >= endPage) break
      } else {
        if (lastRowDateVal && lastRowDateVal < startVal) break
        if (lastRowDateVal) {
          const oldestDate = valToDate(lastRowDateVal)
          const done = Math.ceil((end.getTime() - oldestDate.getTime()) / 86400000)
          onProgress({ total: Math.ceil(totalDays), current: done, message: `1단계: 목록 수집 중 (${lastRowDateVal})` })
        }
      }
      page++
    }

    if (this.isStopped) return Array.from(userMap.values())

    // ── 2단계: 수집된 게시글 리스트를 기반으로 댓글 상세 수집 ──────
    onLog(`\n[2단계] 댓글 상세 수집 시작 (대상: ${postsToProcess.length}개 게시글)`)

    let processedCount = 0
    for (const post of postsToProcess) {
      await this.checkPause()
      if (this.isStopped) break

      processedCount++
      if (post.expectedComments > 0) {
        const preCount = Array.from(userMap.values()).reduce((sum, u) => sum + u.commentCount, 0)
        await this.fetchComments(galleryId, galleryType, post.id, userMap, onLog)
        const postCount = Array.from(userMap.values()).reduce((sum, u) => sum + u.commentCount, 0)
        const diff = postCount - preCount

        onLog(`[수집] ${post.id} | 작성자: ${post.name || 'N/A'} | 댓글 ${diff}개 완료 (예상: ${post.expectedComments}) | ${post.dateAttr}`)

        if (diff !== post.expectedComments) {
          onLog(`[알림] ${post.id} | 댓글 수 불일치 감지 (예상 ${post.expectedComments} vs 실측 ${diff})`)
        }
      } else {
        onLog(`[수집] ${post.id} | 작성자: ${post.name || 'N/A'} | 댓글 없음 | ${post.dateAttr}`)
      }

      onProgress({
        total: postsToProcess.length,
        current: processedCount,
        message: `2단계: 댓글 수집 중 (${processedCount}/${postsToProcess.length})`
      })
    }

    onLog(`\n[완료] 총 ${postsToProcess.length}개 게시글 분석 완료.`)

    return Array.from(userMap.values()).sort((a, b) => {
      const sumA = a.postCount + a.commentCount
      const sumB = b.postCount + b.commentCount
      if (sumB !== sumA) return sumB - sumA
      return a.name.localeCompare(b.name)
    })
  }
}
