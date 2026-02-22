'use strict'

const axios = require('axios')
const cheerio = require('cheerio')

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'X-Requested-With': 'XMLHttpRequest',
  'Origin': 'https://m.dcinside.com',
}

/**
 * 단일 게시글의 모든 댓글 작성자를 수집한다.
 * Fetches all comment authors for a single post.
 * @param {function} logFn  (msg: string) => void  상세 로그 콜백 (Detailed log callback)
 */
async function fetchCommentAuthors(gallId, gallType, gallNum, expectedCount, logFn) {
  const log = logFn || (() => { })
  const apiId = gallType === 2 ? `mi$${gallId}` : gallId
  const referer = `https://m.dcinside.com/board/${gallId}/${gallNum}`

  const authors = []
  let cpage = 1
  let totalParsed = 0

  while (true) {
    const body = new URLSearchParams({
      id: apiId,
      no: gallNum,
      cpage: String(cpage),
      managerskill: '',
      csort: '',
      permission_pw: '',
    }).toString()

    let res
    try {
      res = await axios.post(
        'https://m.dcinside.com/ajax/response-comment',
        body,
        {
          headers: {
            ...MOBILE_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': referer,
          },
          timeout: 15000,
        }
      )
    } catch (e) {
      log(`    [오류] API 요청 실패 (cpage=${cpage}): ${e.message}`)
      break
    }

    const data = res.data
    const dataType = typeof data

    // 응답 형식 판별 및 HTML 추출
    let html = ''
    if (dataType === 'string') {
      html = data
    } else if (data && dataType === 'object') {
      html = data.comments_html || data.html || ''
    }

    if (!html || html.trim() === '') {
      break
    }

    const $ = cheerio.load(html)

    let commentEls = $('li.comment-item')
    if (commentEls.length === 0) commentEls = $('li[class*="cmt"]')
    if (commentEls.length === 0) {
      commentEls = $('li').filter((_i, el) => {
        const cls = $(el).attr('class') || ''
        return cls.includes('comment') && !cls.includes('recomm')
      })
    }

    if (commentEls.length === 0) break

    let pageAuthors = 0
    commentEls.each((_i, el) => {
      const comment = $(el)

      const nickEl = comment.find('.user-info a, .nick a, a.writer').first()
      const nick = nickEl.length ? nickEl.text().trim() : comment.find('a').first().text().trim()

      let uid = ''
      let ip = ''
      let isFluid = true

      const uidSpan = comment.find('span.blockCommentId')
      if (uidSpan.length > 0) {
        uid = (uidSpan.attr('data-info') || '').trim()
        isFluid = false
      } else {
        const ipSpan = comment.find('span.ip, span.blockCommentIp, .ip-text')
        ip = ipSpan.text().trim()
      }

      if (nick) {
        authors.push({ nick, uid, ip, isFluid })
        pageAuthors++
      }
    })

    totalParsed += pageAuthors

    if (commentEls.length < 50) break
    cpage++
  }

  if (expectedCount !== undefined && expectedCount - totalParsed > 0) {
    log(`    [누락] 예상 ${expectedCount} vs 수집 ${totalParsed}`)
  }

  return authors
}

/**
 * 댓글 있는 게시글 전체를 순회하며 댓글 작성자를 집계한다.
 * Iterates through all posts with comments and aggregates comment authors.
 */
async function crawlComments(gallId, gallType, postsWithComments, onProgress, isStopped) {
  const commentMap = new Map()
  const total = postsWithComments.length
  let mismatches = 0
  const BATCH = 10  // 10개 게시글 병렬 처리

  for (let i = 0; i < total; i += BATCH) {
    if (isStopped && isStopped()) break

    const batchPosts = postsWithComments.slice(i, i + BATCH)

    // 배치 내 게시글 댓글을 병렬 fetch
    const batchResults = await Promise.all(
      batchPosts.map((post, bi) =>
        fetchCommentAuthors(gallId, gallType, post.gallNum, post.replyCount, (msg) => {
          if (msg.includes('[누락]')) {
            onProgress({ current: i + bi + 1, total, log: `[댓글 ${i + bi + 1}/${total}] 글 ${post.gallNum} ${msg.trim()}` })
          }
        })
      )
    )

    // 결과 처리 및 commentMap 갱신
    for (let bi = 0; bi < batchResults.length; bi++) {
      const post = batchPosts[bi]
      const authors = batchResults[bi]
      const idx = i + bi

      const gap = post.replyCount - authors.length
      if (gap > 0) {
        mismatches++
        onProgress({ current: idx + 1, total, log: `[댓글 ${idx + 1}/${total}] 글 ${post.gallNum} — ${authors.length}명 (${gap}개 누락)` })
      } else {
        onProgress({ current: idx + 1, total, log: `[댓글 ${idx + 1}/${total}] 글 ${post.gallNum} — ${authors.length}명` })
      }

      for (const author of authors) {
        const key = author.isFluid
          ? `fluid::${author.nick}::${author.ip}`
          : `fixed::${author.uid}`

        if (commentMap.has(key)) {
          commentMap.get(key).commentCount++
        } else {
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

    if (i + BATCH < total) await sleep(50)
  }

  // 최종 요약
  // Final summary
  const totalCollected = Array.from(commentMap.values()).reduce((s, u) => s + u.commentCount, 0)
  onProgress({
    current: total,
    total,
    log: `[완료] ${total}개 게시글 댓글 수집 — 총 ${totalCollected}개${mismatches > 0 ? ` (누락 의심 ${mismatches}건)` : ''}`,
  })

  return commentMap
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { crawlComments, fetchCommentAuthors }
