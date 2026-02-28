'use strict' // 엄격 모드 사용: 런타임 오류 방지 및 성능 최적화

// 외부 모듈을 불러옵니다.
const axios = require('axios') // HTTP 통신을 위한 라이브러리입니다.
const cheerio = require('cheerio') // HTML 문서 파싱 및 요소 추출을 위한 라이브러리입니다.

// ─── 상수 및 헤더 설정 ─────────────────────────────────────────

// DCInside 서버 요청 시 사용할 기본 모바일 브라우저 헤더입니다.
const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
}

let sessionCookie = '' // 서버로부터 획득한 세션 쿠키를 저장할 변수입니다.

/**
 * 세션 초기화: 디시인사이드 모바일 메인 페이지를 방문하여 기본 쿠키를 획득합니다.
 */
async function initSession() {
  try {
    const res = await axios.get('https://m.dcinside.com/', {
      headers: BASE_HEADERS,
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: s => s < 400,
    })
    sessionCookie = extractCookies(res) // 응답 헤더에서 쿠키를 추출합니다.
    console.log('Session initialized. Cookie:', sessionCookie)
  } catch (e) {
    console.error('Session initialization failed:', e.message)
  }
}

/**
 * 갤러리 ID와 타입에 따른 모바일 접속 URL을 생성합니다.
 */
function getGalleryUrl(gallId, gallType) {
  switch (gallType) {
    case 0: return `https://m.dcinside.com/board/${gallId}` // 일반 갤러리
    case 1: return `https://m.dcinside.com/board/${gallId}` // 마이너 갤러리 (URL 구조 동일)
    case 2: return `https://m.dcinside.com/mini/${gallId}`  // 미니 갤러리
    default: throw new Error('알 수 없는 갤러리 타입')
  }
}

/**
 * HTTP 응답 객체로부터 set-cookie 헤더를 분석하여 문자열로 반환합니다.
 */
function extractCookies(response) {
  const raw = response.headers['set-cookie']
  if (!raw) return ''
  // 세미콜론 기준으로 쿠키 이름과 값만 추출하여 병합합니다.
  return raw.map(c => c.split(';')[0]).join('; ')
}

/**
 * 입력된 갤러리 ID가 실제로 존재하는지 확인하고 갤러리 이름을 가져옵니다.
 */
async function checkGallery(gallId, gallType) {
  // 세션 쿠키가 없는 경우 초기화 작업을 수행합니다.
  if (!sessionCookie) await initSession()

  const baseUrl = getGalleryUrl(gallId, gallType)
  const url = `${baseUrl}?page=1`

  const reqOpts = {
    headers: {
      ...BASE_HEADERS,
      'Referer': 'https://m.dcinside.com/',
      ...(sessionCookie ? { 'Cookie': sessionCookie } : {})
    },
    timeout: 15000,
    maxRedirects: 0,
    validateStatus: s => s < 400,
  }

  try {
    const res = await axios.get(url, reqOpts)

    // 만약 리다이렉트(301, 302)가 발생하면 모바일 페이지 접근이 차단된 것으로 보고 세션을 갱신합니다.
    if (res.status >= 300) {
      console.log(`Redirect ${res.status} detected. Reinitializing session...`)
      await initSession()
      const retryRes = await axios.get(url, {
        ...reqOpts,
        headers: { ...reqOpts.headers, ...(sessionCookie ? { 'Cookie': sessionCookie } : {}) },
      })
      if (retryRes.status >= 300 || !retryRes.data || retryRes.data.length === 0) {
        return { ok: false, message: '모바일 접근 실패: 리다이렉트 차단 불가' }
      }
      return parseGalleryResponse(retryRes.data, gallId)
    }

    // 서버 응답 데이터가 비어있는 경우 재시도합니다.
    if (!res.data || (typeof res.data === 'string' && res.data.length === 0)) {
      console.log('Empty response. Retrying with fresh session...')
      await initSession()
      const retryRes = await axios.get(url, {
        ...reqOpts,
        headers: { ...reqOpts.headers, ...(sessionCookie ? { 'Cookie': sessionCookie } : {}) },
      })
      if (!retryRes.data || retryRes.data.length === 0) {
        return { ok: false, message: '서버에서 빈 응답을 받았습니다. (연속 실패)' }
      }
      return parseGalleryResponse(retryRes.data, gallId)
    }

    return parseGalleryResponse(res.data, gallId)
  } catch (e) {
    const status = e.response ? `HTTP ${e.response.status}` : e.message
    return { ok: false, message: status }
  }
}

/**
 * 갤러리 페이지 HTML에서 갤러리 이름을 파싱합니다.
 */
function parseGalleryResponse(html, gallId) {
  const $ = cheerio.load(html)
  let gallName = ''
  // 갤러리 이름이 위치할 수 있는 다양한 셀렉터 후보들입니다.
  const nameCandidates = [
    () => $('h3.gall-tit a').first().text().trim(),    // 모바일 표준
    () => $('h3.gall-tit').clone().children().remove().end().text().trim(),
    () => $('h4.gall_tit').find('a').first().text().trim(), // PC 유사 구조
    () => $('h4.gall_tit').clone().children().remove().end().text().trim(),
    () => $('h2.title_txt').text().trim(),
    () => $('meta[property="og:title"]').attr('content')?.split(':')[0]?.trim(),
    () => $('title').text().replace(/\s*[-–|]\s*디시인사이드.*$/i, '').trim(),
  ]
  for (const fn of nameCandidates) {
    gallName = fn()
    if (gallName) break
  }

  // 게시글 목록 영역을 확인합니다.
  const rows = $('ul.gall-detail-lst > li')
  if (rows.length === 0 && !gallName) {
    return { ok: false, message: '갤러리 데이터를 찾을 수 없습니다.' }
  }
  return { ok: true, gallName: gallName || gallId }
}

/**
 * 갤러리 개별 페이지를 가져오는 내부 함수입니다 (병렬 처리용).
 */
async function fetchPage(url, referer, cookie) {
  try {
    const res = await axios.get(url, {
      headers: { ...BASE_HEADERS, Referer: referer, ...(cookie ? { Cookie: cookie } : {}) },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: s => s < 500, // 500 미만의 모든 상태는 일단 응답으로 처리
    })
    return res.status >= 300 ? null : res // 리다이렉트 발생 시 실패로 간주
  } catch {
    return null
  }
}

/**
 * 게시글 정보 중 날짜 데이터가 들어있는 li 요소를 찾아 텍스트를 반환합니다.
 */
function findGinfoDate(row, $) {
  let rawDate = ''
  row.find('ul.ginfo > li').each((_, li) => {
    const text = $(li).text().trim()
    // 날짜 패턴(시간 또는 월.일)에 부합하는지 확인합니다.
    if (parseMobileDateStr(text)) { rawDate = text; return false }
  })
  return rawDate
}

/**
 * 가져온 페이지의 HTML에서 게시글들의 메타정보(작성자, 날짜, 댓글 수 등)를 추출합니다.
 */
function parsePageRows($, startVal, endVal) {
  const rows = $('ul.gall-detail-lst > li')
  const pagePosts = []
  const pageCommentPosts = []
  let anyValid = false
  let newestDateOnPage = '' // 해당 페이지에서 가장 최신 날짜를 추적합니다.

  rows.each((_, el) => {
    const row = $(el)
    const href = row.find('a.lt').attr('href') || ''
    const numMatch = href.match(/\/(\d+)(?:\?|#|$)/) // URL에서 글 번호를 추출합니다.
    if (!numMatch) return

    const gallNumText = numMatch[1]
    const rawDate = findGinfoDate(row, $)
    const dateVal = parseMobileDateStr(rawDate) // 비교 가능한 YYYYMMDD 형태 문자열로 변환

    if (!dateVal) return

    // 수집 범위와 상관없이 이 페이지의 가장 최신 글 날짜 기록
    if (dateVal > newestDateOnPage) newestDateOnPage = dateVal

    // 설정된 날짜 범위(startDate ~ endDate)를 벗어나는지 확인합니다.
    if (endVal && dateVal > endVal) return // 수집 종료일보다 뒤의 글이면 스킵
    if (startVal && dateVal < startVal) return // 수집 시작일보다 앞의 글이면 스킵

    anyValid = true

    // 유저 정보 영역에서 닉네임과 UID/IP 정보를 추출합니다.
    const blockInfo = row.find('span.blockInfo')
    const nick = blockInfo.attr('data-name') || ''
    const dataInfo = blockInfo.attr('data-info') || ''
    const isFluid = /^\d{1,3}\.\d/.test(dataInfo) // IP 주소 패턴이면 유동닉
    const uid = isFluid ? '' : dataInfo
    const ip = isFluid ? dataInfo : ''
    // 댓글 개수를 정수형으로 가져옵니다.
    const replyCount = extractInt(row.find('a.rt span.ct').text().trim())
    const postDate = parseMobileDate(rawDate) // Date 객체로 변환
    const postInfo = { gallNum: gallNumText, nick, uid, ip, isFluid, date: postDate, replyCount }

    pagePosts.push(postInfo)
    if (replyCount > 0) pageCommentPosts.push(postInfo) // 댓글 수집 대상에 추가
  })

  // 이 페이지에서 가장 최신 글조차 수집 시작일보다 과거라면, 이후 페이지는 볼 필요가 없습니다.
  const fullyTooOld = !!(startVal && newestDateOnPage && newestDateOnPage < startVal)

  return { rows: rows.length, pagePosts, pageCommentPosts, anyValid, fullyTooOld }
}

/**
 * 설정된 조건(페이지 범위, 날짜 범위)에 맞춰 게시글 목록을 크롤링합니다.
 */
async function crawlGallery(params) {
  const { gallId, gallType, startPage, endPage, startDate, endDate, onProgress, isStopped } = params
  const baseUrl = getGalleryUrl(gallId, gallType)

  const posts = [] // 수집된 모든 게시글 정보
  const postsWithComments = [] // 댓글이 달린 게시글들만 따로 저장
  const collectedNums = new Set() // 중복 수집을 방지하기 위한 게시글 번호 집합
  let cookie = sessionCookie || '' // 현재 사용 중인 세션 쿠키

  // 날짜 비교를 위해 'YYYY-MM-DD' 형태에서 숫자만 남긴 문자열로 변환합니다.
  const startVal = startDate ? startDate.replace(/\D/g, '') : ''
  const endVal = endDate ? endDate.replace(/\D/g, '') : ''

  const firstPage = startPage || 1
  const lastPage = endPage || null

  onProgress({ page: 0, log: `[시작] 크롤링 시작 (페이지: ${firstPage}, 범위: ${startDate || '없음'} ~ ${endDate || '없음'})` })

  // ── 5페이지씩 병렬로 크롤링을 진행합니다. ────────────────────────────────
  const BATCH = 5
  // 데이터를 어느 정도 모은 후, 더 이상 유효한 글이 나오지 않을 때의 중단 임계값입니다.
  const MAX_EMPTY_BATCHES_AFTER_COLLECT = 4
  let page = firstPage
  let done = false
  let totalCollected = 0
  let emptyBatchesAfterCollect = 0

  while (!done) {
    if (isStopped && isStopped()) break // 전역 중지 플래그 확인

    const batch = []
    for (let i = 0; i < BATCH; i++) {
      const p = page + i
      if (lastPage !== null && p > lastPage) break
      batch.push(p)
    }
    if (batch.length === 0) break

    onProgress({ log: `[스캔] 페이지 ${batch[0]}~${batch[batch.length - 1]} 요청 중...` })

    // BATCH 크기만큼 페이지를 동시에 요청합니다.
    const responses = await Promise.all(
      batch.map(p => fetchPage(`${baseUrl}?page=${p}`, baseUrl, cookie))
    )

    let batchHadValid = false

    for (let i = 0; i < responses.length; i++) {
      const p = batch[i]
      const res = responses[i]

      if (!res) {
        onProgress({ page: p, log: `[오류] 페이지 ${p} 로드 실패, 중단` })
        done = true; break
      }

      // 서버에서 새로 내려준 쿠키가 있으면 업데이트합니다 (만료 방지).
      const newCookie = extractCookies(res)
      if (newCookie) cookie = newCookie

      const $ = cheerio.load(res.data)
      // 페이지 안의 행들을 분석하여 결과를 받아옵니다.
      const { rows, pagePosts, pageCommentPosts, fullyTooOld } = parsePageRows($, startVal, endVal)

      if (rows === 0) {
        onProgress({ page: p, log: `[종료] 페이지 ${p}: 게시글 없음` })
        done = true; break
      }

      // 페이지에서 추출된 각 게시글을 최종 결과 목록에 추가합니다.
      for (const post of pagePosts) {
        if (!collectedNums.has(post.gallNum)) {
          // 날짜 범위를 한 번 더 엄격하게 체크합니다.
          const postDateVal = post.date ? parseDateToVal(post.date) : ''
          const isTooNew = endVal && postDateVal > endVal
          const isTooOld = startVal && postDateVal < startVal

          if (!isTooNew && !isTooOld) {
            posts.push(post)
            collectedNums.add(post.gallNum)
            if (post.replyCount > 0) postsWithComments.push(post)
          }
        }
      }

      if (pagePosts.length > 0) {
        batchHadValid = true
        totalCollected += pagePosts.length
        onProgress({
          page: p,
          log: `[페이지 ${p}] ${pagePosts.length}개 분석 | 누적 유효글: ${posts.length}개 (댓글대상: ${postsWithComments.length}개)`,
        })
      }

      // 페이지 전체가 설정된 날짜보다 이전이라면 탐색을 완전히 종료합니다.
      if (fullyTooOld) {
        onProgress({ page: p, log: `  → [종료] 기준 날짜(${startDate}) 이전 구역 도달` })
        done = true; break
      }

      // 설정된 마지막 페이지에 도달한 경우 종료합니다.
      if (lastPage !== null && p >= lastPage) { done = true; break }
    }

    if (done) break

    // 데이터를 일부 찾은 후에 연속으로 빈 결과가 나오면 범위를 완전히 벗어난 것으로 간주합니다.
    if (startVal && totalCollected > 0) {
      if (batchHadValid) {
        emptyBatchesAfterCollect = 0
      } else {
        emptyBatchesAfterCollect++
        if (emptyBatchesAfterCollect >= MAX_EMPTY_BATCHES_AFTER_COLLECT) {
          onProgress({ log: `  → [종료] 수집 범위 종료 (${MAX_EMPTY_BATCHES_AFTER_COLLECT}배치 연속 수집 없음)` })
          break
        }
      }
    }

    page = batch[batch.length - 1] + 1
    // 서버 부하 조절을 위해 배치 사이에 짧은 지연 시간을 둡니다.
    await new Promise(r => setTimeout(r, 300))
  }

  return { posts, postsWithComments } // 수집된 게시글 배열 반환
}

/**
 * 다양한 형식의 모바일 날짜 문자열(HH:MM, MM.DD, YYYY.MM.DD)을 비교용 YYYYMMDD 숫자로 변환합니다.
 */
function parseMobileDateStr(rawDate) {
  if (/^\d{1,2}:\d{2}$/.test(rawDate)) {
    // 오늘 올라온 글 (예: "14:15")
    const t = new Date()
    return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
  }
  if (/^\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    // 날짜만 표시 (예: "02.25")
    const [mm, dd] = rawDate.split('.')
    const today = new Date()
    let year = today.getFullYear()
    const candidate = `${year}${mm.padStart(2, '0')}${dd.padStart(2, '0')}`
    const todayVal = `${year}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    // 미래 날짜라면 작년에 작성된 글로 판단 (연초에 작년 연말 글 수집 시 고려)
    if (candidate > todayVal) year -= 1
    return `${year}${mm.padStart(2, '0')}${dd.padStart(2, '0')}`
  }
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    // 년도까지 포함된 전체 날짜 (예: "2024.02.25")
    const [y, m, d] = rawDate.split('.')
    return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`
  }
  return ''
}

/**
 * 날짜 문자열을 실제 자바스크립트 Date 객체로 변환합니다.
 */
function parseMobileDate(rawDate) {
  if (/^\d{1,2}:\d{2}$/.test(rawDate)) {
    const t = new Date()
    const [h, m] = rawDate.split(':')
    t.setHours(parseInt(h), parseInt(m), 0, 0)
    return t
  }
  if (/^\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    const [mm, dd] = rawDate.split('.')
    const dateStr = parseMobileDateStr(rawDate)
    if (!dateStr) return null
    return new Date(`${dateStr.slice(0, 4)}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`)
  }
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    const [y, m, d] = rawDate.split('.')
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
  }
  return null
}

/**
 * "1,234"와 같이 쉼표가 섞인 텍스트에서 숫자만 추출하여 정수로 반환합니다.
 */
function extractInt(text) {
  const m = text.replace(/,/g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

/**
 * Date 객체를 YYYYMMDD 형태의 문자열로 변환합니다.
 */
function parseDateToVal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * 보관 중인 현재 세션 쿠키를 외부로 공유합니다.
 */
function getSessionCookie() {
  return sessionCookie
}

// 다른 모듈(main.js, commentHelper.js)에서 사용할 수 있도록 내보냅니다.
module.exports = { checkGallery, crawlGallery, getGalleryUrl, initSession, getSessionCookie }

