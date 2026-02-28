'use strict' // 엄격 모드 사용: 런타임 오류 방지 및 성능 최적화

// 외부 라이브러리를 불러옵니다.
const axios = require('axios') // HTTP 요청을 처리하기 위한 라이브러리입니다.
const cheerio = require('cheerio') // HTML 파싱 및 DOM 조작을 위한 Node.js용 라이브러리입니다.
// 같은 디렉토리의 다른 헬퍼 함수들을 불러옵니다.
const { initSession, getSessionCookie } = require('./galleryHelper') // 세션 관리 및 쿠키 획득을 담당합니다.
const { makeKey } = require('./userManager') // 유저 식별을 위한 고유 키 생성 로직을 담당합니다.

// DCInside 서버에 요청을 보낼 때 사용할 모바일 환경의 HTTP 헤더 설정입니다.
const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'X-Requested-With': 'XMLHttpRequest',
  'Origin': 'https://m.dcinside.com',
}

const COMMENT_TIMEOUT_MS = 30000 // 댓글 API 요청 타임아웃 제한 (30초)
const MAX_RETRIES = 2 // 요청 실패 시 최대 재시도 횟수
// 한 글당 최대 수집할 댓글 페이지 수 (보통 1페이지당 50개이므로 총 5000개 수준)
const MAX_COMMENT_PAGES = 100

/**
 * 단일 게시글의 모든 댓글 작성자를 수집한다.
 * @param {string} gallId - 갤러리 ID
 * @param {number} gallType - 갤러리 종류 (일반, 마이너, 미니)
 * @param {string} gallNum - 게시글 번호
 * @param {number} expectedCount - 게시글 목록에서 확인된 예상 댓글 수
 * @param {function} logFn - 진행 상태 기록을 위한 콜백 함수
 * @param {string} cookie - 요청에 사용할 세션 쿠키
 */
async function fetchCommentAuthors(gallId, gallType, gallNum, expectedCount, logFn, cookie) {
  const log = logFn || (() => { }) // 로그 함수가 없으면 빈 함수로 대체
  const apiId = gallType === 2 ? `mi$${gallId}` : gallId // 미니갤러리인 경우 ID 앞에 'mi$' 접두사 추가
  const baseDomain = gallType === 2 ? 'mini' : 'board' // 갤러리 종류에 따른 도메인 구분
  const referer = `https://m.dcinside.com/${baseDomain}/${gallId}/${gallNum}` // 요청의 출처(Referer) 설정

  const authors = [] // 수집된 작성자 정보를 담을 배열
  let cpage = 1 // 현재 수집 중인 댓글 페이지 번호
  let totalParsed = 0 // 현재까지 파싱된 댓글 총 개수

  // 댓글 페이지를 순차적으로 방문합니다.
  while (cpage <= MAX_COMMENT_PAGES) {
    // API 요청에 실어 보낼 파라미터를 구성합니다.
    const body = new URLSearchParams({
      id: apiId,
      no: gallNum,
      cpage: String(cpage),
      managerskill: '',
      csort: '',
      permission_pw: '',
    }).toString()

    let res
    let lastError
    let currentCookie = cookie

    // 네트워킹 불안정 대응을 위해 재시도 루프를 실행합니다.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        log(`    [재시도] cpage=${cpage} — ${attempt}/${MAX_RETRIES}번째`)
        await initSession() // 세션이 만료되었을 수 있으므로 다시 초기화 시도
        currentCookie = getSessionCookie() // 새로운 쿠키 획득
        await sleep(600 * attempt) // 재시도 간격 지연 (Backoff)
      }
      try {
        // 실제 DCInside 모바일 댓글 API를 호출합니다.
        res = await axios.post(
          'https://m.dcinside.com/ajax/response-comment',
          body,
          {
            headers: {
              ...MOBILE_HEADERS,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'Referer': referer,
              ...(currentCookie ? { 'Cookie': currentCookie } : {}),
            },
            timeout: COMMENT_TIMEOUT_MS,
          }
        )
        lastError = null
        break // 요청 성공 시 루프 탈출
      } catch (e) {
        lastError = e
        const isTimeout = e.code === 'ECONNABORTED' || e.message.toLowerCase().includes('timeout')
        // 타임아웃이 아니거나 최대 재시도 횟수에 도달하면 루프 종료
        if (!isTimeout || attempt >= MAX_RETRIES) break
        log(`    [타임아웃] cpage=${cpage} — 재시도 (${attempt + 1}/${MAX_RETRIES})`)
      }
    }

    // 모든 시도가 실패한 경우
    if (lastError) {
      log(`    [오류] API 요청 실패 (cpage=${cpage}): ${lastError.message}`)
      break
    }

    const data = res.data
    let html = ''
    // 응답 데이터 포맷(JSON 혹은 문자열)에 따라 HTML 내용을 추출합니다.
    if (typeof data === 'string') {
      html = data
    } else if (data && typeof data === 'object') {
      html = data.comments_html || data.html || ''
    }

    // 내용이 없으면 더 이상 수집할 댓글이 없는 것으로 간주합니다.
    if (!html || html.trim() === '') break

    const $ = cheerio.load(html) // 가져온 HTML 조각을 Cheerio 객체로 로드합니다.

    // 게시글 내의 댓글 아이템들을 선택합니다. (li.comment: 일반댓글, li.comment-add: 답글 포함)
    const commentEls = $('li.comment, li.comment-add')
    if (commentEls.length === 0) break

    let pageAuthors = 0 // 현재 페이지에서 추출한 작성자 수
    commentEls.each((_, el) => {
      const comment = $(el)
      const nickEl = comment.find('a.nick')

      // 닉네임 추출: 유동닉의 경우 닉네임 뒤에 IP가 붙어 나오므로 순수 텍스트 노드만 가져옵니다.
      const nick = nickEl.contents()
        .filter((_, n) => n.type === 'text')
        .first()
        .text()
        .trim()

      if (!nick) return // 닉네임이 비어있으면(예: 빈 입력칸) 건너뜁니다.

      // 고정닉 사용자의 UID 정보를 추출합니다. (숨겨진 span 요소에 위치)
      const uidSpan = comment.find('span.blockCommentId')
      const uid = (uidSpan.attr('data-info') || '').trim()

      // 유동닉 사용자의 IP 정보를 추출합니다.
      const ipSpan = comment.find('span.blockCommentIp')
      let ip = (ipSpan.attr('data-info') || ipSpan.text() || '').trim().replace(/^\(|\)$/g, '')

      const isFluid = !uid // UID가 없으면 유동닉으로 간주

      // 유동닉인데 IP를 못 찾은 경우, 닉네임 옆의 텍스트에서 정규식으로 추출 시도
      if (isFluid && !ip) {
        const fullText = nickEl.text().trim()
        const ipMatch = fullText.match(/\((\d+\.\d+)\)/)
        if (ipMatch) ip = ipMatch[1]
      }

      // 수집된 정보를 배열에 추가합니다.
      authors.push({ nick, uid, ip, isFluid })
      pageAuthors++
    })

    totalParsed += pageAuthors

    // 다음 페이지가 있는지 확인합니다. (HTML 내의 하단 페이지 선택창 유무 체크)
    const pageSelect = $('div.paging.alg-ct div.rt div.sel-box select')
    if (pageSelect.length > 0) {
      const totalPages = pageSelect.find('option').length
      if (totalPages > cpage) {
        cpage++ // 다음 페이지로 이동
        continue
      }
    }
    break // 다음 페이지가 없으면 루프 종료
  }

  return authors // 수집된 작성자 리스트 반환
}

/**
 * 댓글이 있는 게시글 목록을 순회하며 전체 댓글 작성자를 집계한다.
 * @param {string} gallId - 갤러리 ID
 * @param {number} gallType - 갤러리 종류
 * @param {Array} postsWithComments - 댓글이 포함된 게시글 객체 배열
 * @param {function} onProgress - 전체 진행도 업데이트를 위한 콜백
 * @param {function} isStopped - 중지 여부 확인 콜백
 * @param {function} waitIfPaused - 일시정지 대기 콜백
 */
async function crawlComments(gallId, gallType, postsWithComments, onProgress, isStopped, waitIfPaused) {
  // 게시글 번호를 기준으로 중복 수집을 방지합니다.
  const seenNums = new Set()
  const uniquePosts = postsWithComments.filter(p => {
    if (seenNums.has(p.gallNum)) return false
    seenNums.add(p.gallNum)
    return true
  })

  const commentMap = new Map() // 유저별 댓글 횟수를 누적할 맵
  const total = uniquePosts.length // 처리해야 할 총 게시글 수
  let mismatches = 0 // 수집된 댓글 수와 글 목록상의 댓글 수가 다른 경우를 카운트
  const BATCH = 10 // 동시에 요청을 보낼 단위 (너무 과한 요청 방지)

  // 게시글 목록을 BATCH 단위로 끊어서 처리합니다.
  for (let i = 0; i < total; i += BATCH) {
    if (isStopped && isStopped()) break // 중지 상태 체크
    if (waitIfPaused) await waitIfPaused() // 일시정지 상태 체크
    if (isStopped && isStopped()) break

    const cookie = getSessionCookie() // 매 배치마다 최신 쿠키를 가져옵니다.
    const batchPosts = uniquePosts.slice(i, i + BATCH)

    // 선택된 Batch의 게시글들에 대해 병렬로 댓글 수집을 시작합니다.
    const batchResults = await Promise.all(
      batchPosts.map((post, bi) =>
        fetchCommentAuthors(gallId, gallType, post.gallNum, post.replyCount, (msg) => {
          // 상세 로그(누락, 오류 등)가 발생한 경우만 UI에 전달합니다.
          if (msg.includes('[누락]') || msg.includes('[오류]') || msg.includes('[타임아웃]') || msg.includes('[재시도]')) {
            onProgress({ current: i + bi + 1, total, log: `[댓글 ${i + bi + 1}/${total}] 글 ${post.gallNum} ${msg.trim()}` })
          }
        }, cookie)
      )
    )

    // 수집된 결과를 Map 데이터구조에 병합합니다.
    for (let bi = 0; bi < batchResults.length; bi++) {
      const post = batchPosts[bi]
      const authors = batchResults[bi]
      const idx = i + bi

      // 예상 댓글 수와 실제 수집된 수의 차이를 계산합니다.
      const gap = post.replyCount - authors.length
      if (gap > 0) {
        mismatches++ // 차이가 있으면 누락 의심으로 체크
        onProgress({ current: idx + 1, total, log: `[댓글 ${idx + 1}/${total}] 글 ${post.gallNum} — ${authors.length}명 (${gap}개 누락)` })
      } else {
        onProgress({ current: idx + 1, total, log: `[댓글 ${idx + 1}/${total}] 글 ${post.gallNum} — ${authors.length}명` })
      }

      // 수집된 각 작성자에 대해 카운트를 증가시킵니다.
      for (const author of authors) {
        const key = makeKey(author) // userManager 모듈을 사용하여 유저 식별 키 생성
        if (commentMap.has(key)) {
          commentMap.get(key).commentCount++ // 이미 있으면 1 증가
        } else {
          // 새로 발견된 유저인 경우 초기화하여 삽입
          commentMap.set(key, {
            nick: author.nick,
            uid: author.uid || '',
            ip: author.ip || '',
            isFluid: author.isFluid,
            commentCount: 1,
          })
        }
      }
    }

    // 서버 부하를 줄이기 위해 배치 사이에 짧은 지연시간을 둡니다.
    if (i + BATCH < total) await sleep(300)
  }

  // 최종 수집된 댓글의 총합을 계산합니다.
  const totalCollected = Array.from(commentMap.values()).reduce((s, u) => s + u.commentCount, 0)
  // 작업 완료 로그를 전송합니다.
  onProgress({
    current: total,
    total,
    log: `[완료] ${total}개 게시글 댓글 수집 — 총 ${totalCollected}개${mismatches > 0 ? ` (누락 의심 ${mismatches}건)` : ''}`,
  })

  return commentMap // 완성된 집계 맵 반환
}

// 비동기 실행을 일정 시간 멈추게 하는 헬퍼 함수입니다.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 메인 모듈이나 수집 흐름에서 사용할 수 있도록 외부로 노출합니다.
module.exports = { crawlComments, fetchCommentAuthors }

