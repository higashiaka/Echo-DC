'use strict'

const axios = require('axios')
const cheerio = require('cheerio')

// ▼▼▼ 테스트할 미니갤 ID로 변경 ▼▼▼
const GALLERY_ID = 'haccovirtual'  // 예시, 실제 미니갤 ID로 바꾸세요
// ▲▲▲

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
}

async function main() {
  const url = `https://m.dcinside.com/mini/${GALLERY_ID}?page=1`
  console.log(`요청: ${url}\n`)

  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 0,
    validateStatus: s => s < 500,
  })

  console.log(`HTTP ${res.status} | HTML ${res.data?.length ?? 0}자`)

  if (res.status >= 300) {
    console.log('리다이렉트 대상:', res.headers['location'])
    return
  }

  const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  const $ = cheerio.load(html)

  // 1. ul.gall-detail-lst 존재 여부
  const rows = $('ul.gall-detail-lst > li')
  console.log(`\nul.gall-detail-lst > li: ${rows.length}개`)

  // 2. li가 5개 이상인 모든 ul/ol 출력 (다른 구조 확인)
  if (rows.length === 0) {
    console.log('\n=== 대체 목록 탐색 (li 5개 이상) ===')
    $('ul, ol').each((_, el) => {
      const children = $(el).children('li')
      if (children.length >= 5) {
        console.log(`  .${$(el).attr('class') || '(no class)'} → ${children.length}개`)
        console.log(`    첫 li: ${children.first().html()?.replace(/\s+/g, ' ').slice(0, 200)}`)
      }
    })
  }

  // 3. 처음 3개 행 상세 출력
  rows.slice(0, 3).each((i, el) => {
    const row = $(el)
    const href = row.find('a.lt').attr('href') || '(없음)'
    const numMatch = href.match(/\/(\d+)(?:\?|#|$)/)
    const ginfoItems = []
    row.find('ul.ginfo > li').each((j, li) => {
      ginfoItems.push(`[${j}]="${$(li).text().trim()}"`)
    })
    const nick = row.find('span.blockInfo').attr('data-name') || '(없음)'
    const reply = row.find('a.rt span.ct').text().trim() || '(없음)'

    console.log(`\n── 행 ${i} ──`)
    console.log(`  href     : ${href}`)
    console.log(`  numMatch : ${numMatch ? numMatch[1] : 'FAIL'}`)
    console.log(`  ginfo    : ${ginfoItems.join(', ')}`)
    console.log(`  nick     : ${nick} | reply: ${reply}`)
    console.log(`  li class : "${$(el).attr('class') || ''}"`)
  })

  // 4. 미니갤 전용 구조 힌트
  console.log('\n=== 미니갤 전용 셀렉터 탐색 ===')
  const candidates = [
    'ul.mini-gall-list > li',
    'ul.list-wrap > li',
    'div.gall-list-wrap li',
    'section.gall-list-group li',
    '.gall-detail-lst li',
    '[class*="mini"] li',
  ]
  for (const sel of candidates) {
    const cnt = $(sel).length
    if (cnt > 0) console.log(`  ${sel} → ${cnt}개`)
  }
}

main().catch(console.error)
