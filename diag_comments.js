'use strict' // 엄격 모드 사용: 자바스크립트의 잠재적인 논리 오류를 수집합니다.

// 외부 라이브러리를 임포트합니다.
const axios = require('axios') // HTTP 클라이언트 모듈로, 웹 페이지나 API 요청을 보낼 때 사용합니다.
const cheerio = require('cheerio') // Node.js 환경에서 jQuery처럼 HTML 문서를 탐색하고 파싱할 수 있게 해줍니다.

// 디시인사이드 서버의 차단을 피하기 위해 사용하는 모바일 환경의 HTTP 헤더 설정입니다.
const MOBILE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'X-Requested-With': 'XMLHttpRequest', // AJAX 요청임을 나타냅니다.
    'Origin': 'https://m.dcinside.com',
}

// 테스트 및 진단에 사용할 특정 갤러리 정보입니다.
const GALL_ID = 'haccovirtual' // 진단 대상 갤러리의 영문 식별자입니다.
const GALL_TYPE = 2  // 갤러리 유형 식별 (1: 마이너, 2: 미니 등)

/**
 * 갤러리 1페이지를 조회하여 댓글이 있는 게시글 번호를 자동으로 찾아 반환합니다.
 */
async function getRecentPostWithComments() {
    const apiId = `mi$${GALL_ID}` // 미니갤러리인 경우 'mi$' 접두사가 붙은 ID를 구성합니다.
    const url = `https://m.dcinside.com/mini/${GALL_ID}?page=1` // 갤러리 메인 목록 주소

    try {
        // 갤러리 목록 HTML을 가져옵니다.
        const res = await axios.get(url, { headers: MOBILE_HEADERS, timeout: 10000 })
        const $ = cheerio.load(res.data) // 파싱을 위해 로드합니다.

        let found = null
        // 각 게시글 항목(li)을 돌면서 댓글 수 표시가 있는 글을 찾습니다.
        $('li').each((_, el) => {
            if (found) return false // 이미 찾았으면 반복문을 탈출합니다.
            const text = $(el).text()
            const href = $(el).find('a').attr('href') || ''
            const numMatch = href.match(/\/(\d+)$/) // URL에서 숫자 형태의 게시글 번호를 추출합니다.
            // 번호가 있고 제목 어딘가에 댓글 개수 표시인 "[" 문자가 있다면 선택합니다.
            if (numMatch && text.includes('[')) {
                found = numMatch[1]
            }
        })

        // 만약 댓글이 있는 글을 못 찾았다면, 예외적으로 첫 번째 글 번호라도 가져와서 반환합니다.
        if (!found) {
            $('a[href*="/mini/haccovirtual/"]').each((_, el) => {
                if (found) return false
                const href = $(el).attr('href') || ''
                const m = href.match(/\/(\d+)$/)
                if (m) found = m[1]
            })
        }
        return found
    } catch (e) {
        console.error('갤러리 목록 가져오기 실패:', e.message)
        return null
    }
}

/**
 * 특정 게시글의 댓글 HTML 원본을 가져와서 구조를 진단합니다.
 */
async function dumpCommentHTML(gallNum) {
    const apiId = `mi$${GALL_ID}`
    const referer = `https://m.dcinside.com/mini/${GALL_ID}/${gallNum}` // 요청 출처 설정
    // 댓글 조회 API에 보낼 폼 데이터 구성
    const body = new URLSearchParams({
        id: apiId,
        no: String(gallNum),
        cpage: '1',
        managerskill: '',
        csort: '',
        permission_pw: '',
    }).toString()

    console.log(`\n댓글 API 요청: gallId=${GALL_ID}, gallNum=${gallNum}`)
    console.log('Referer:', referer)

    // 실제 댓글 AJAX 엔드포인트에 POST 요청을 보냅니다.
    const res = await axios.post(
        'https://m.dcinside.com/ajax/response-comment',
        body,
        {
            headers: {
                ...MOBILE_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': referer,
            },
            timeout: 10000,
        }
    )

    console.log('응답 상태:', res.status)
    console.log('응답 타입:', typeof res.data)

    let html = ''
    // 서버가 문자열로 줄 수도 있고, JSON 내부의 'html' 필드로 줄 수도 있어서 처리합니다.
    if (typeof res.data === 'string') {
        html = res.data
    } else if (res.data && typeof res.data === 'object') {
        console.log('JSON 키:', Object.keys(res.data))
        html = res.data.comments_html || res.data.html || ''
    }

    // 결과 확인
    if (!html || html.trim() === '') {
        console.log('❌ HTML이 비어있음')
        console.log('전체 응답:', JSON.stringify(res.data).slice(0, 1000))
        return
    }

    console.log('HTML 길이:', html.length)
    console.log('\n=== 원본 HTML (처음 3000자) ===')
    console.log(html.slice(0, 3000)) // 파악을 위해 직접 출력합니다.
    console.log('=== HTML 끝 ===\n')

    const $ = cheerio.load(html)

    // 크롤러 필터 작성을 위해 유효한 HTML 셀렉터들을 전수 조사합니다.
    const selectors = [
        'li.comment-item',
        'li[class*="cmt"]',
        'li.cmt',
        'li.ub-content',
        'li.dcinside-comment',
        '.inner_dccon',
        'div.comment-item',
        'div[class*="comment"]',
        'ul.comment_lst > li',
        'ul > li',
    ]

    console.log('=== 셀렉터 히트 수 ===')
    selectors.forEach(sel => {
        const count = $(sel).length // 해당 셀렉터로 몇 개의 아이템이 잡히는지 출력합니다.
        if (count > 0) console.log(`  '${sel}' → ${count}개 히트`)
    })

    // HTML 구조의 <li> 태그들이 가진 모든 클래스명을 수집하여 중복 없이 출력합니다.
    console.log('\n=== 모든 li 클래스 목록 ===')
    const liClasses = new Set()
    $('li').each((_, el) => liClasses.add($(el).attr('class') || '(없음)'))
    liClasses.forEach(c => console.log(' ', c))

    // 분석을 위해 첫 번째 <li> 태그의 내부 구조를 상세히 봅니다. (닉네임, 아이피 위치 파악)
    const firstLi = $('li').first()
    if (firstLi.length) {
        console.log('\n=== 첫 번째 <li> 내부 HTML ===')
        console.log(firstLi.html()?.slice(0, 500))

        // 내부의 모든 <span> 요소들의 속성값을 분석합니다. (UID가 여기에 숨어 있을 확률이 높음)
        console.log('\n=== 첫 번째 <li> 내부 span 목록 ===')
        firstLi.find('span').each((_, el) => {
            const attrs = $(el).attr()
            console.log(' ', JSON.stringify(attrs))
        })

        // 작성자 닉네임을 담고 있을 수 있는 <a> 태그 정보를 수집합니다.
        console.log('\n=== 첫 번째 <li> 내부 a 태그 ===')
        firstLi.find('a').each((_, el) => {
            const attrs = $(el).attr()
            console.log(' ', JSON.stringify(attrs), '→ text:', $(el).text().trim())
        })
    }
}

/**
 * 작업을 순차적으로 실행하는 메인 로직입니다.
 */
async function run() {
    try {
        console.log('갤러리에서 최근 글 번호 찾는 중...')
        const gallNum = await getRecentPostWithComments()

        if (!gallNum) {
            console.log('❌ 글 번호를 찾지 못했습니다. 수동으로 지정합니다.')
            // 목록 조회 실패 시 하드코딩된 글 번호로 대신 시도합니다.
            await dumpCommentHTML('1181000')
            return
        }

        console.log('글 번호:', gallNum)
        await dumpCommentHTML(gallNum) // 찾은 글 번호로 HTML 분석 실행
    } catch (e) {
        console.error('오류:', e.message)
    }
}

run() // 프로그램 실행

