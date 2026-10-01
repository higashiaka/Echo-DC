import { load } from 'cheerio'
import { DCClient } from './dc-client'
import type {
  GalleryInfo,
  GalleryType,
  AnalysisType,
  AnalyzeOptions,
  UserRank,
  ProgressInfo
} from '../shared/ipc-types'


const COMMENT_API = 'https://m.dcinside.com/ajax/response-comment'
const DESKTOP_COMMENT_API = 'https://gall.dcinside.com/board/comment/'

const AUTO_LIST_SIZE = 100 // 날짜 자동 탐색 시 한 페이지에 받을 글 수
const LIST_CONCURRENCY = 3
const COMMENT_CONCURRENCY = 3
const PARSE_RETRIES = 3 // 빈 응답(차단·오류 페이지) 재시도 횟수
const MAX_PAGE = 1_048_576 // 페이지 탐색 안전 한도
const MAX_COMMENT_PAGES = 1000
const DESKTOP_FAIL_LIMIT = 5 // 연속 실패 시 데스크탑 댓글 API 사용 중단

type LogFn = (msg: string) => void
type ProgressFn = (p: ProgressInfo) => void

interface Author {
  name: string
  uid: string
  ip: string
  isFluid: boolean
}

interface ListPost extends Author {
  id: string
  expectedComments: number
  dateAttr: string
  dateVal: string // YYYYMMDD
}

interface ListPage {
  posts: ListPost[]
  token: string // 댓글 API용 e_s_n_o
  newest: string // 공지 제외 일반글 중 가장 최근 날짜 (없으면 '')
  oldest: string // 공지 제외 일반글 중 가장 오래된 날짜 (없으면 '')
}

interface CommentPayload {
  comments?: Array<Record<string, unknown>> | null
  pagination?: unknown
}

// 탐색 도중 사용자가 중단했음을 알리는 신호
class StopSignal extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

// 데스크탑 게시글 URL (댓글 JSON API의 Referer)
function buildDesktopPostUrl(gallId: string, gallType: GalleryType, gallNum: string): string {
  switch (gallType) {
    case 1: return `https://gall.dcinside.com/mgallery/board/view/?id=${gallId}&no=${gallNum}`
    case 2: return `https://gall.dcinside.com/mini/board/view/?id=${gallId}&no=${gallNum}`
    default: return `https://gall.dcinside.com/board/view/?id=${gallId}&no=${gallNum}`
  }
}

// 데스크탑 댓글 API의 _GALLTYPE_ 값
function buildGallTypeCode(gallType: GalleryType): string {
  switch (gallType) {
    case 1: return 'M'
    case 2: return 'MI'
    default: return 'G'
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

// 데스크탑 목록 HTML → 게시글·토큰·날짜 경계
function parseListPage(html: string): ListPage {
  const $ = load(html)
  const token = $('#e_s_n_o').attr('value') ?? ''
  const posts: ListPost[] = []
  let newest = ''
  let oldest = ''

  // 데스크탑 HTML 셀렉터 (sources/DCHelper.cs와 동일)
  for (const el of $('tr.ub-content.us-post').toArray()) {
    const row = $(el)
    const id = row.attr('data-no') ?? ''
    const dateAttr = row.find('td.gall_date').attr('title') ?? ''
    const dateVal = dateAttr ? dateAttr.slice(0, 10).replace(/-/g, '') : ''
    if (!/^\d+$/.test(id) || Number(id) >= 1_000_000_000 || !dateVal) continue // 관리글 제외

    // 상단 고정 공지는 모든 페이지에 반복되므로 날짜 경계 계산에서만 제외 (집계는 날짜로 판단)
    if (row.attr('data-type') !== 'icon_notice') {
      if (!newest || dateVal > newest) newest = dateVal
      if (!oldest || dateVal < oldest) oldest = dateVal
    }

    // 작성자: td.gall_writer.ub-writer data-nick / data-uid / data-ip
    const writerEl = row.find('td.gall_writer.ub-writer')
    const name = (writerEl.attr('data-nick') ?? '').trim()
    const uid = (writerEl.attr('data-uid') ?? '').trim()
    const ip = (writerEl.attr('data-ip') ?? '').trim()

    const replySpan = row.find('a.reply_numbox span')
    const expectedComments = replySpan.length ? extractInt(replySpan.first().text()) : 0

    posts.push({ id, name, uid, ip, isFluid: uid === '', expectedComments, dateAttr, dateVal })
  }

  return { posts, token, newest, oldest }
}

export class DCAnalyzer {
  private client: DCClient
  private sessionInitialized = false
  private desktopFailStreak = 0
  public isPaused = false
  public isStopped = false
  // 수집이 불완전할 때의 사유 (결과와 함께 사용자에게 표시)
  public warnings: string[] = []

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

  // ── 병렬 작업 풀 (일시정지·중지 반영, worker는 예외를 던지지 않아야 함) ──
  private async runPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let next = 0
    const run = async (): Promise<void> => {
      while (true) {
        await this.checkPause()
        if (this.isStopped || next >= items.length) return
        await worker(items[next++])
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
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

  // ── 댓글 랭킹 분석 ──────────────────────────────────────────
  async analyzeComments(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    return this.analyze(options, 'comment', onLog, onProgress)
  }

  // ── 글 랭킹 분석 ────────────────────────────────────────────
  async analyzePosts(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    return this.analyze(options, 'post', onLog, onProgress)
  }

  // ── 글+댓글 통합 랭킹 분석 ──────────────────────────────────
  async analyzeBoth(
    options: AnalyzeOptions,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    return this.analyze(options, 'both', onLog, onProgress)
  }

  // ── 랭킹 분석 공통 (데스크탑 목록 크롤링 + 댓글 API) ─────────
  // 정확도를 위해 2단계로 분리: 1단계(글 목록 확보) -> 2단계(댓글 상세 수집)
  private async analyze(
    options: AnalyzeOptions,
    type: AnalysisType,
    onLog: LogFn,
    onProgress: ProgressFn
  ): Promise<UserRank[]> {
    const { galleryId, galleryType, endPage, startDate, endDate } = options
    const startPage = Math.max(1, options.startPage)
    const startVal = startDate.replace(/-/g, '')
    const endVal = endDate.replace(/-/g, '')

    // 페이지를 직접 지정하면 사이트 기본 목록 크기를 유지해 페이지 번호가 어긋나지 않게 함
    const autoRange = endPage === null
    const listSize = autoRange && startPage === 1 ? AUTO_LIST_SIZE : null
    const baseUrl = buildDesktopGalleryUrl(galleryId, galleryType)

    const userMap = new Map<string, UserRank>()
    const nickMap = new Map<string, Set<string>>()
    const pages = new Map<number, ListPage>()
    const loadPage = async (page: number): Promise<ListPage> => {
      const cached = pages.get(page)
      if (cached) return cached
      const parsed = await this.fetchListPage(baseUrl, page, listSize)
      pages.set(page, parsed)
      return parsed
    }

    // ── 1단계: 게시글 리스트 및 작성자 정보 확보 ────────────────
    let targetPages: number[] = []
    try {
      if (autoRange) {
        onLog(`[1단계] 날짜 범위에 해당하는 페이지 탐색 중 (시작 페이지: ${startPage})`)
        onProgress({ total: 1, current: 0, message: '1단계: 페이지 범위 탐색 중' })
        const range = await this.findPageRange(startPage, startVal, endVal, loadPage)
        if (range) {
          onLog(`[1단계] 대상 페이지: ${range[0]} ~ ${range[1]}`)
          for (let p = range[0]; p <= range[1]; p++) targetPages.push(p)
        }
      } else {
        onLog(`[1단계] 게시글 목록 수집 시작 (페이지: ${startPage} ~ ${endPage})`)
        for (let p = startPage; p <= endPage; p++) targetPages.push(p)
      }
    } catch (e) {
      if (!(e instanceof StopSignal)) throw e
      targetPages = []
    }

    const failedPages: number[] = []
    let emptyFrom = Infinity // 이 페이지부터는 글이 없음 (갤러리 끝)
    let pagesDone = 0
    await this.runPool(targetPages, LIST_CONCURRENCY, async (page) => {
      if (page < emptyFrom) {
        try {
          const parsed = await loadPage(page)
          if (parsed.posts.length === 0) emptyFrom = Math.min(emptyFrom, page)
          onLog(`[진행] 1단계: 페이지 ${page} 완료 (${parsed.posts.length}개)`)
        } catch (e) {
          failedPages.push(page)
          onLog(`[오류] 페이지 ${page} 수집 실패: ${(e as Error).message}`)
        }
      }
      pagesDone++
      onProgress({
        total: targetPages.length,
        current: pagesDone,
        message: `1단계: 목록 수집 중 (${pagesDone}/${targetPages.length})`
      })
    })

    // 수집 도중 새 글로 페이지가 밀려도 중복 집계되지 않도록 글 번호로 중복 제거
    const posts: ListPost[] = []
    const processedPostIds = new Set<string>()
    let token = ''
    for (const page of Array.from(pages.keys()).sort((a, b) => a - b)) {
      const parsed = pages.get(page)!
      if (!token) token = parsed.token
      for (const post of parsed.posts) {
        if (processedPostIds.has(post.id)) continue
        processedPostIds.add(post.id)
        if (post.dateVal > endVal || post.dateVal < startVal) continue
        posts.push(post)
        if (type !== 'comment' && post.name) this.addCount(userMap, nickMap, post, 'postCount')
      }
    }
    onLog(`[1단계] 완료: 날짜 범위 내 게시글 ${posts.length}개`)

    // ── 2단계: 수집된 게시글 리스트를 기반으로 댓글 상세 수집 ──────
    const failedPosts: string[] = []
    if (type !== 'post' && !this.isStopped) {
      const targets = posts.filter((p) => p.expectedComments > 0)
      onLog(`\n[2단계] 댓글 상세 수집 시작 (대상: ${targets.length}개 게시글)`)
      if (!token) onLog('[알림] 댓글 API 토큰을 찾지 못해 모바일 방식으로 수집합니다')

      let processedCount = 0
      await this.runPool(targets, COMMENT_CONCURRENCY, async (post) => {
        try {
          const authors = await this.fetchComments(galleryId, galleryType, post.id, token, onLog)
          // 글 하나를 끝까지 받은 뒤에만 반영 (도중 실패 시 부분 집계 방지)
          for (const author of authors) this.addCount(userMap, nickMap, author, 'commentCount')

          onLog(`[수집] ${post.id} | 작성자: ${post.name || 'N/A'} | 댓글 ${authors.length}개 완료 (예상: ${post.expectedComments}) | ${post.dateAttr}`)
          if (authors.length !== post.expectedComments) {
            onLog(`[알림] ${post.id} | 댓글 수 불일치 감지 (예상 ${post.expectedComments} vs 실측 ${authors.length})`)
          }
        } catch (e) {
          failedPosts.push(post.id)
          onLog(`[오류] 댓글 로드 실패 (${post.id}): ${(e as Error).message}`)
        }

        processedCount++
        onProgress({
          total: targets.length,
          current: processedCount,
          message: `2단계: 댓글 수집 중 (${processedCount}/${targets.length})`
        })
      })
    }

    // 조용히 누락되지 않도록 불완전 수집 사유를 남김
    if (failedPages.length > 0) {
      failedPages.sort((a, b) => a - b)
      this.warnings.push(`목록 ${failedPages.length}개 페이지 수집 실패 (${failedPages.join(', ')})`)
    }
    if (failedPosts.length > 0) {
      const shown = failedPosts.slice(0, 20).join(', ') + (failedPosts.length > 20 ? ' …' : '')
      this.warnings.push(`게시글 ${failedPosts.length}개의 댓글 수집 실패 (${shown})`)
    }
    if (this.isStopped) this.warnings.push('사용자 중단으로 일부만 수집됨')
    for (const w of this.warnings) onLog(`[경고] ${w}`)

    onLog(`\n[완료] 총 ${posts.length}개 게시글 분석 완료.`)

    const countOf = (u: UserRank): number =>
      type === 'both' ? u.postCount + u.commentCount : type === 'comment' ? u.commentCount : u.postCount
    return Array.from(userMap.values()).sort((a, b) => {
      if (countOf(b) !== countOf(a)) return countOf(b) - countOf(a)
      return a.name.localeCompare(b.name)
    })
  }

  // 고정닉은 uid, 유동닉은 닉+IP 기준으로 집계. 닉을 바꾼 고정닉은 닉을 +로 이어 붙임
  private addCount(
    userMap: Map<string, UserRank>,
    nickMap: Map<string, Set<string>>,
    author: Author,
    field: 'postCount' | 'commentCount'
  ): void {
    const { name, uid, ip, isFluid } = author
    const key = isFluid ? `ip:${name}:${ip}` : `uid:${uid}`
    const existing = userMap.get(key)
    if (!existing) {
      userMap.set(key, { name, uid, ip, isFluid, postCount: 0, commentCount: 0, [field]: 1 })
      nickMap.set(key, new Set([name]))
      return
    }
    existing[field]++
    const nicks = nickMap.get(key)!
    if (name && !nicks.has(name)) {
      nicks.add(name)
      existing.name += `+${name}`
    }
  }

  // ── 목록 페이지 요청 (빈 응답은 재시도 후 오류 처리) ─────────
  private async fetchListPage(
    baseUrl: string,
    page: number,
    listSize: number | null
  ): Promise<ListPage> {
    const url = `${baseUrl}&page=${page}` + (listSize ? `&list_num=${listSize}` : '')
    for (let attempt = 0; ; attempt++) {
      const { data: html } = await this.client.getPage(url)
      const parsed = parseListPage(html)
      // 토큰이 있으면 정상 페이지 (글이 없으면 갤러리 끝), 둘 다 없으면 차단·오류 페이지
      if (parsed.posts.length > 0 || parsed.token) return parsed
      if (attempt >= PARSE_RETRIES || this.isStopped) break
      await sleep(500 * 2 ** attempt)
    }
    throw new Error(`페이지 ${page} 목록을 해석할 수 없음 (차단 또는 페이지 구조 변경)`)
  }

  // ── 날짜 범위에 해당하는 페이지 구간을 이진 탐색 ─────────────
  // 목록은 최신순이므로 페이지 번호가 커질수록 날짜가 과거로 감 (단조)
  private async findPageRange(
    low: number,
    startVal: string,
    endVal: string,
    loadPage: (page: number) => Promise<ListPage>
  ): Promise<[number, number] | null> {
    const firstTrue = async (from: number, pred: (p: ListPage) => boolean): Promise<number> => {
      const test = async (page: number): Promise<boolean> => {
        await this.checkPause()
        if (this.isStopped) throw new StopSignal()
        return pred(await loadPage(page))
      }
      let lo = from
      let hi = from
      let step = 1
      while (!(await test(hi))) {
        lo = hi + 1
        hi += step
        step *= 2
        if (hi > MAX_PAGE) throw new Error('페이지 탐색이 안전 한도를 초과했습니다')
      }
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (await test(mid)) hi = mid
        else lo = mid + 1
      }
      return lo
    }

    // 일반글이 없는 페이지(갤러리 끝)는 두 조건 모두 참으로 취급
    const first = await firstTrue(low, (p) => !p.oldest || p.oldest <= endVal)
    const firstOlder = await firstTrue(first, (p) => !p.newest || p.newest < startVal)
    if (firstOlder <= first) return null

    // 수집 도중 페이지가 밀리는 경우에 대비해 앞뒤로 한 페이지씩 여유
    return [Math.max(low, first - 1), firstOlder]
  }

  // ── 댓글 수집: 데스크탑 JSON API 우선, 실패 시 모바일 방식으로 폴백 ──
  private async fetchComments(
    gallId: string,
    gallType: GalleryType,
    gallNum: string,
    token: string,
    onLog: LogFn
  ): Promise<Author[]> {
    if (token && this.desktopFailStreak < DESKTOP_FAIL_LIMIT) {
      try {
        const authors = await this.fetchCommentsDesktop(gallId, gallType, gallNum, token)
        this.desktopFailStreak = 0
        return authors
      } catch (e) {
        this.desktopFailStreak++
        onLog(`[폴백] ${gallNum} — 댓글 API 실패 (${(e as Error).message}), 모바일 방식으로 재시도`)
        if (this.desktopFailStreak === DESKTOP_FAIL_LIMIT) {
          onLog('[알림] 댓글 API 연속 실패 — 이후 모바일 방식으로만 수집합니다')
        }
      }
    }
    return this.fetchCommentsMobile(gallId, gallType, gallNum, onLog)
  }

  // ── 데스크탑 댓글 JSON API ──────────────────────────────────
  private async fetchCommentsDesktop(
    gallId: string,
    gallType: GalleryType,
    gallNum: string,
    token: string
  ): Promise<Author[]> {
    const referer = buildDesktopPostUrl(gallId, gallType, gallNum)
    const found: Author[] = []
    const seenCommentNos = new Set<string>() // 페이지 경계에서의 중복 방지

    for (let cpage = 1; cpage <= MAX_COMMENT_PAGES; cpage++) {
      const payload = await this.requestCommentJson(
        {
          id: gallId,
          no: gallNum,
          cmt_id: gallId,
          cmt_no: gallNum,
          focus_cno: '',
          focus_pno: '',
          e_s_n_o: token,
          comment_page: String(cpage),
          sort: 'D',
          prevCnt: '',
          board_type: '',
          _GALLTYPE_: buildGallTypeCode(gallType),
          secret_article_key: '',
          clean: '',
          nptest: ''
        },
        referer
      )

      for (const c of payload.comments ?? []) {
        const commentNo = String(c.no ?? '')
        if (commentNo) {
          if (seenCommentNos.has(commentNo)) continue
          seenCommentNos.add(commentNo)
        }
        if (c.del_yn === 'Y' || String(c.is_delete ?? '') === '1') continue // 삭제된 댓글

        const name = String(c.name ?? '').trim()
        const uid = String(c.user_id ?? '').trim()
        const ip = String(c.ip ?? '').trim()
        if (!name || (!uid && !ip)) continue // 댓글돌이 등 식별자 없는 댓글
        found.push({ name, uid, ip, isFluid: uid === '' })
      }

      const nextPages = Array.from(
        String(payload.pagination ?? '').matchAll(/viewComments\((\d+),/g),
        (m) => Number(m[1])
      )
      if (!nextPages.includes(cpage + 1)) break
    }
    return found
  }

  private async requestCommentJson(
    fields: Record<string, string>,
    referer: string
  ): Promise<CommentPayload> {
    let body = ''
    for (let attempt = 0; ; attempt++) {
      body = await this.client.postDesktopForm(DESKTOP_COMMENT_API, fields, referer)
      try {
        const parsed: unknown = JSON.parse(body)
        if (parsed && typeof parsed === 'object' && 'comments' in parsed) {
          return parsed as CommentPayload
        }
      } catch {
        // JSON이 아닌 응답 (차단·오류 문구) → 재시도
      }
      if (attempt >= PARSE_RETRIES || this.isStopped) break
      await sleep(500 * 2 ** attempt)
    }
    throw new Error(`JSON이 아닌 응답: ${body.slice(0, 40).trim()}`)
  }

  // ── 모바일 댓글 수집 (sources/DCHelper.cs getComment 방식) ───
  private async fetchCommentsMobile(
    gallId: string,
    gallType: GalleryType,
    gallNum: string,
    onLog: LogFn
  ): Promise<Author[]> {
    const apiGallId = buildApiGallId(gallId, gallType)
    const mobilePostUrl = buildMobilePostUrl(gallId, gallType, gallNum)
    const found: Author[] = []

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
        if (status !== 429) throw e
        onLog(`[429] ${gallNum} p${cpage} — 모바일 웹으로 폴백`)
        const result = await this.client.get(`${mobilePostUrl}?cpage=${cpage}`)
        if (result.status >= 300 || !result.data) {
          throw new Error(`p${cpage} 폴백도 실패 (status: ${result.status})`)
        }
        html = result.data
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

        if (idSpan.length) {
          uid = idSpan.attr('data-info') ?? ''
        } else if (ipSpan.length) {
          ip = ipSpan.text().replace(/[()]/g, '').trim()

          // 닉네임에 (IP)가 포함되어 있으면 제거 (중복 방지)
          if (ip && name.endsWith(`(${ip})`)) {
            name = name.slice(0, -(ip.length + 2)).trim()
          }
        }
        if (!uid && !ip) continue // 댓글돌이 등 식별자 없는 댓글

        found.push({ name, uid, ip, isFluid: uid === '' })
      }

      const totalPages = $('div.paging.alg-ct div.rt div.sel-box select option').length
      if (totalPages <= cpage) break
    }
    return found
  }
}
