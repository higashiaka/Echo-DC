'use strict' // 엄격 모드 사용: 예기치 않은 오류를 방지합니다.

// 필요한 모듈들을 불러옵니다.
const axios = require('axios') // HTTP 요청을 보내기 위한 라이브러리입니다.
const cheerio = require('cheerio') // HTML 문자열을 파싱하여 jQuery처럼 다루게 해주는 라이브러리입니다.
const fs = require('fs') // 파일 시스템에 접근하여 결과를 저장할 때 사용합니다.

// DCInside 모바일 서버가 봇으로 인식하지 않도록 사용할 HTTP 헤더입니다.
const MOBILE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'X-Requested-With': 'XMLHttpRequest', // AJAX 요청임을 알립니다.
    'Origin': 'https://m.dcinside.com',
}

const GALL_ID = 'haccovirtual' // 진단 대상이 될 갤러리 ID입니다.
const API_ID = `mi$${GALL_ID}` // 미니갤러리용 API 호출 ID 포맷입니다.

/**
 * Step 1: 갤러리 목록을 조회하여 댓글이 달려 있는 최신 게시글 번호를 찾습니다.
 */
async function findPostWithComments() {
    const url = `https://m.dcinside.com/mini/${GALL_ID}?page=1` // 갤러리 1페이지 주소
    console.log('갤러리 목록 조회:', url)
    // 갤러리 목록 페이지를 가져옵니다.
    const res = await axios.get(url, { headers: MOBILE_HEADERS, timeout: 10000 })
    const $ = cheerio.load(res.data) // 파싱을 위해 cheerio 객체 생성

    let found = null
    // 각 게시글 항목(li)을 순회하며 댓글이 있는 글을 찾습니다.
    $('li').each((_, el) => {
        if (found) return false // 이미 찾았으면 루프 중단
        const li = $(el)
        // 해당 갤러리 경로를 가진 링크 요소를 찾습니다.
        const a = li.find('a[href*="/mini/haccovirtual/"]').first()
        const href = a.attr('href') || ''
        const m = href.match(/\/(\d+)$/) // URL 끝의 숫자(글 번호)를 추출합니다.
        const text = li.text()
        const hasComments = /\[\d+\]/.test(text) // 제목 옆에 "[숫자]" 형태의 댓글 표시가 있는지 확인합니다.
        if (m && hasComments) found = m[1]
    })

    // 만약 댓글 표시된 글을 못 찾았다면, 그냥 첫 번째 게시글 번호를 가져오는 예외 처리를 합니다.
    if (!found) {
        $('a[href*="/mini/haccovirtual/"]').each((_, el) => {
            if (found) return false
            const href = $(el).attr('href') || ''
            const m = href.match(/\/(\d{4,})$/) // 4자리 이상의 숫자를 글 번호로 간주
            if (m) found = m[1]
        })
    }

    return found // 찾은 글 번호를 반환합니다.
}

/**
 * Step 2: 특정 게시글의 댓글 API를 직접 호출하고 반환되는 HTML 구조를 분석합니다.
 */
async function inspectCommentAPI(gallNum) {
    const referer = `https://m.dcinside.com/mini/${GALL_ID}/${gallNum}` // API가 체크하는 Referer 헤더 값 설정
    // 댓글 로딩을 위한 POST 데이터 구성
    const body = new URLSearchParams({
        id: API_ID,
        no: String(gallNum),
        cpage: '1',
        managerskill: '',
        csort: '',
        permission_pw: '',
    }).toString()

    console.log(`\n댓글 API 요청 — gallNum: ${gallNum}`)
    // 실제 DCInside 댓글 AJAX API에 요청을 보냅니다.
    const res = await axios.post(
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

    console.log('응답 상태:', res.status)
    console.log('응답 타입:', typeof res.data)

    let html = ''
    // API 응답 형태에 맞춰 HTML 데이터를 추출합니다.
    if (typeof res.data === 'string') {
        html = res.data
    } else if (res.data && typeof res.data === 'object') {
        console.log('JSON 키:', Object.keys(res.data))
        html = res.data.comments_html || res.data.html || ''
        if (!html) {
            console.log('전체 JSON 응답:')
            console.log(JSON.stringify(res.data, null, 2).slice(0, 1000))
            return
        }
    }

    // 추출된 HTML이 비어있는 경우
    if (!html.trim()) {
        console.log('❌ HTML 비어있음')
        return
    }

    // 분석을 위해 가져온 HTML 원본을 파일로 저장합니다.
    fs.writeFileSync('diag_output.html', html, 'utf-8')
    console.log(`\nHTML 길이: ${html.length}자 → diag_output.html 저장됨`)
    console.log('\n=== 원본 HTML (처음 2000자) ===')
    console.log(html.slice(0, 2000)) // 내용 확인용 출력
    console.log('\n=== HTML 끝 ===')

    const $ = cheerio.load(html)

    // 여러가지 CSS 셀렉터를 테스트하여 실제 매칭되는 것이 있는지 확인합니다.
    console.log('\n=== 셀렉터 히트 수 ===')
    const sels = [
        'li.comment-item', 'li.ub-content', 'li.cmt',
        '.inner_dccon', 'span[data-uid]', 'span[data-info]',
        '.nick_comm', '.gall_writer', 'span.blockInfo', 'span.cmt_info',
        '.user_name', '.user_id', 'span.blockCommentId',
        'em.nick', '.write-info',
    ]
    sels.forEach(s => {
        const n = $(s).length // 각 셀렉터로 찾은 요소의 개수 출력
        console.log(`  '${s}' → ${n}개`)
    })

    // HTML 내의 모든 li 태그들이 어떤 클래스를 가지고 있는지 분석합니다.
    console.log('\n=== li 태그 클래스 목록 ===')
    const liClasses = new Set()
    $('li').each((_, el) => liClasses.add($(el).attr('class') || '(없음)'))
    liClasses.forEach(c => console.log(' ', c))

    // data-* 속성을 가진 span들이 있는지, 어떤 데이터를 담고 있는지 확인합니다. (UID 등 탐색)
    console.log('\n=== data-* 속성 가진 span ===')
    $('span').each((_, el) => {
        const attrs = el.attribs || {}
        if (Object.keys(attrs).some(k => k.startsWith('data-'))) {
            console.log(' ', JSON.stringify(attrs))
        }
    })

    // 파싱 로직 작성을 위해 첫 번째 댓글 항목의 HTML 구조를 세부적으로 출력합니다.
    const firstLi = $('li').first()
    if (firstLi.length) {
        console.log('\n=== 첫 번째 <li> HTML ===')
        console.log(firstLi.html()?.slice(0, 600))
    }
}

/**
 * 프로그램 실행 메인 함수입니다.
 */
async function run() {
    try {
        // 인자로 글 번호를 받았으면 그것을 사용하고, 없으면 목록에서 자동으로 찾습니다.
        const gallNum = process.argv[2] || await findPostWithComments()
        if (!gallNum) {
            console.log('❌ 글 번호를 찾지 못했습니다. 직접 지정: node diag2.js <글번호>')
            return
        }
        console.log('사용할 글 번호:', gallNum)
        await inspectCommentAPI(gallNum) // 분석 시작
    } catch (e) {
        console.error('오류:', e.message)
        if (e.response) console.error('응답 상태:', e.response.status)
    }
}

run() // 실행

