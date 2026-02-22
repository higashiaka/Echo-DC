'use strict'

const axios = require('axios')
const cheerio = require('cheerio')

// ─── Constants and Headers ─────────────────────────────────────────

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
}

let sessionCookie = ''

// 세션 초기화: 모바일 메인을 방문하여 쿠키를 획득함
async function initSession() {
  try {
    const res = await axios.get('https://m.dcinside.com/', {
      headers: BASE_HEADERS,
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: s => s < 400,
    })
    sessionCookie = extractCookies(res)
    console.log('Session initialized. Cookie:', sessionCookie)
  } catch (e) {
    console.error('Session initialization failed:', e.message)
  }
}

function getGalleryUrl(gallId, gallType) {
  switch (gallType) {
    case 0: return `https://m.dcinside.com/board/${gallId}`
    case 1: return `https://m.dcinside.com/board/${gallId}`
    case 2: return `https://m.dcinside.com/mini/${gallId}`
    default: throw new Error('알 수 없는 갤러리 타입')
  }
}

function extractCookies(response) {
  const raw = response.headers['set-cookie']
  if (!raw) return ''
  return raw.map(c => c.split(';')[0]).join('; ')
}

async function checkGallery(gallId, gallType) {
  // 세션이 없으면 먼저 초기화 시도
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

    // 3xx 리다이렉트 = 모바일 → PC로 밀림: 세션 갱신 후 재시도
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

    if (!res.data || (typeof res.data === 'string' && res.data.length === 0)) {
      // 빈 응답: 세션 갱신 후 재시도
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

function parseGalleryResponse(html, gallId) {
  const $ = cheerio.load(html)
  let gallName = ''
  const nameCandidates = [
    () => $('h3.gall-tit a').first().text().trim(),    // 모바일
    () => $('h3.gall-tit').clone().children().remove().end().text().trim(),
    () => $('h4.gall_tit').find('a').first().text().trim(), // PC
    () => $('h4.gall_tit').clone().children().remove().end().text().trim(),
    () => $('h2.title_txt').text().trim(),
    () => $('meta[property="og:title"]').attr('content')?.split(':')[0]?.trim(),
    () => $('title').text().replace(/\s*[-–|]\s*디시인사이드.*$/i, '').trim(),
  ]
  for (const fn of nameCandidates) {
    gallName = fn()
    if (gallName) break
  }

  const rows = $('ul.gall-detail-lst > li')
  if (rows.length === 0 && !gallName) {
    return { ok: false, message: '갤러리 데이터를 찾을 수 없습니다.' }
  }
  return { ok: true, gallName: gallName || gallId }
}

// 단일 페이지 fetch (병렬 사용용, 리다이렉트 시 null 반환)
async function fetchPage(url, referer, cookie) {
  try {
    const res = await axios.get(url, {
      headers: { ...BASE_HEADERS, Referer: referer, ...(cookie ? { Cookie: cookie } : {}) },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: s => s < 500,
    })
    return res.status >= 300 ? null : res
  } catch {
    return null
  }
}

// ginfo li 중 날짜 패턴에 맞는 항목 텍스트를 반환 (미니갤/일반갤 구조 차이 대응)
function findGinfoDate(row, $) {
  let rawDate = ''
  row.find('ul.ginfo > li').each((_, li) => {
    const text = $(li).text().trim()
    if (parseMobileDateStr(text)) { rawDate = text; return false }
  })
  return rawDate
}

function parsePageRows($, startVal, endVal) {
  const rows = $('ul.gall-detail-lst > li')
  const pagePosts = []
  const pageCommentPosts = []
  let anyValid = false
  let lastTooOld = false

  rows.each((_, el) => {
    const row = $(el)
    const href = row.find('a.lt').attr('href') || ''
    const numMatch = href.match(/\/(\d+)(?:\?|#|$)/)
    if (!numMatch) return

    const gallNumText = numMatch[1]
    const rawDate = findGinfoDate(row, $)
    const dateVal = parseMobileDateStr(rawDate)

    if (!dateVal) return
    if (endVal && dateVal > endVal) return
    if (startVal && dateVal < startVal) { lastTooOld = true; return }

    anyValid = true
    lastTooOld = false

    const blockInfo = row.find('span.blockInfo')
    const nick = blockInfo.attr('data-name') || ''
    const dataInfo = blockInfo.attr('data-info') || ''
    const isFluid = /^\d{1,3}\.\d/.test(dataInfo)
    const uid = isFluid ? '' : dataInfo
    const ip  = isFluid ? dataInfo : ''
    const replyCount = extractInt(row.find('a.rt span.ct').text().trim())
    const postDate = parseMobileDate(rawDate)
    const postInfo = { gallNum: gallNumText, nick, uid, ip, isFluid, date: postDate, replyCount }

    pagePosts.push(postInfo)
    if (replyCount > 0) pageCommentPosts.push(postInfo)
  })

  return { rows: rows.length, pagePosts, pageCommentPosts, anyValid, lastTooOld }
}

async function crawlGallery(params) {
  const { gallId, gallType, startPage, endPage, startDate, endDate, onProgress, isStopped } = params
  const baseUrl = getGalleryUrl(gallId, gallType)

  const posts = []
  const postsWithComments = []
  let cookie = sessionCookie || ''

  const startVal = startDate ? startDate.replace(/\D/g, '') : ''
  const endVal   = endDate   ? endDate.replace(/\D/g, '')   : ''

  const firstPage = startPage || 1
  const lastPage  = endPage   || null

  onProgress({ page: 0, log: `[시작] 크롤링 시작 (페이지: ${firstPage}, 범위: ${startDate || '없음'} ~ ${endDate || '없음'})` })

  // ── 5페이지 병렬 배치 크롤링 ────────────────────────────────
  const BATCH = 5
  let page = firstPage
  let done = false

  while (!done) {
    if (isStopped && isStopped()) break

    const batch = []
    for (let i = 0; i < BATCH; i++) {
      const p = page + i
      if (lastPage !== null && p > lastPage) break
      batch.push(p)
    }
    if (batch.length === 0) break

    onProgress({ log: `[스캔] 페이지 ${batch[0]}~${batch[batch.length - 1]} 요청 중...` })

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

      const newCookie = extractCookies(res)
      if (newCookie) cookie = newCookie

      const $ = cheerio.load(res.data)
      const { rows, pagePosts, pageCommentPosts, anyValid, lastTooOld } = parsePageRows($, startVal, endVal)

      if (rows === 0) {
        onProgress({ page: p, log: `[종료] 페이지 ${p}: 게시글 없음` })
        done = true; break
      }

      for (const post of pagePosts) posts.push(post)
      for (const post of pageCommentPosts) postsWithComments.push(post)

      if (pagePosts.length > 0) {
        batchHadValid = true
        onProgress({
          page: p,
          log: `[페이지 ${p}] ${pagePosts.length}개 수집 | 댓글대상 누적: ${postsWithComments.length}개`,
        })
      }

      if (lastTooOld && !anyValid && p > firstPage) {
        onProgress({ page: p, log: `  → [종료] 기준 날짜(${startDate}) 이전 구역 도달` })
        done = true; break
      }

      if (lastPage !== null && p >= lastPage) { done = true; break }
    }

    if (done) break
    page = batch[batch.length - 1] + 1
    // 수집 구간 진입 전(스킵 중)엔 딜레이 최소화, 수집 중엔 서버 부하 고려
    await new Promise(r => setTimeout(r, batchHadValid ? 150 : 50))
  }

  return { posts, postsWithComments }
}

// "HH:MM" → 오늘 YYYYMMDD, "MM.DD" → 올해(또는 작년), "YYYY.MM.DD" → 그대로 (비교용 문자열)
function parseMobileDateStr(rawDate) {
  if (/^\d{1,2}:\d{2}$/.test(rawDate)) {
    const t = new Date()
    return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
  }
  if (/^\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    const [mm, dd] = rawDate.split('.')
    const today = new Date()
    let year = today.getFullYear()
    const candidate = `${year}${mm.padStart(2, '0')}${dd.padStart(2, '0')}`
    // 미래 날짜로 파싱되면 작년으로 보정 (연말/연초 경계)
    const todayVal = `${year}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    if (candidate > todayVal) year -= 1
    return `${year}${mm.padStart(2, '0')}${dd.padStart(2, '0')}`
  }
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(rawDate)) {
    const [y, m, d] = rawDate.split('.')
    return `${y}${m.padStart(2, '0')}${d.padStart(2, '0')}`
  }
  return ''
}

// Date 객체 반환 (postInfo.date 저장용)
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

function extractInt(text) {
  const m = text.replace(/,/g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

module.exports = { checkGallery, crawlGallery, getGalleryUrl }
