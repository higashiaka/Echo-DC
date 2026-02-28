'use strict' // 엄격 모드 사용: 논리적 오류를 사전에 방지합니다.

/**
 * 게시글 목록과 댓글 맵을 받아 유저별 통합 집계 결과를 반환한다.
 *
 * 유저별 데이터 구조 (UserRecord):
 * {
 *   nick: string,       // 닉네임
 *   uid: string,        // 고정닉 ID
 *   ip: string,         // 유동닉 IP
 *   isFluid: boolean,   // 유동닉 여부
 *   postCount: number,  // 작성한 게시글 수
 *   commentCount: number, // 작성한 댓글 수
 * }
 */

/**
 * 게시글 작성자 목록을 순회하며 유저별 글 수를 집계합니다.
 * 고정닉은 UID를 기준으로, 유동닉은 닉네임과 IP 조합을 기준으로 동일 유저를 판별합니다.
 * @param {Array} posts - 크롤링된 게시글 정보 배열
 * @returns {Map<string, UserRecord>} - 유저 키별 집계 데이터 맵
 */
function aggregatePosts(posts) {
  const map = new Map() // 집계 결과를 저장할 Map 객체입니다.

  for (const post of posts) {
    const key = makeKey(post) // 유저를 식별할 수 있는 고유 키를 생성합니다.
    if (map.has(key)) {
      map.get(key).postCount++ // 이미 맵에 존재하는 유저라면 글 개수만 1 증가시킵니다.
    } else {
      // 처음 발견된 유저라면 맵에 새로운 레코드를 생성하여 저장합니다.
      map.set(key, {
        nick: post.nick,
        uid: post.uid || '',
        ip: post.ip || '',
        isFluid: post.isFluid,
        postCount: 1,
        commentCount: 0,
      })
    }
  }

  return map // 결과 맵을 반환합니다.
}

/**
 * 게시글 집계 Map과 댓글 집계 Map을 하나로 합칩니다.
 * @param {Map} postMap - 게시글 기준 집계 결과
 * @param {Map} commentMap - 댓글 기준 집계 결과 (commentHelper에서 생성됨)
 * @returns {Map<string, UserRecord>} - 통합 집계 결과 맵
 */
function mergeResults(postMap, commentMap) {
  // 먼저 게시글 데이터가 담긴 맵을 복사하여 시작합니다.
  const merged = new Map(postMap)

  // 댓글 데이터가 담긴 맵을 순회하며 통합합니다.
  for (const [key, cdata] of commentMap) {
    if (merged.has(key)) {
      // 게시글 수집 시 이미 발견된 유저라면 댓글 수만 더해줍니다.
      merged.get(key).commentCount += cdata.commentCount
    } else {
      // 게시글은 쓴 적 없고 댓글만 쓴 유저라면 새로 레코드를 생성합니다.
      merged.set(key, {
        nick: cdata.nick,
        uid: cdata.uid || '',
        ip: cdata.ip || '',
        isFluid: cdata.isFluid,
        postCount: 0,
        commentCount: cdata.commentCount,
      })
    }
  }

  return merged // 통합된 맵을 반환합니다.
}

/**
 * 집계 맵 데이터를 정렬된 배열 형태로 변환합니다.
 * @param {Map} map - 통합 집계 맵
 * @param {string} sortBy - 정렬 기준 ('combined': 합산, 'post': 글 수, 'comment': 댓글 수)
 * @returns {Array} - 정렬된 유저 레코드 배열
 */
function toRanking(map, sortBy = 'combined') {
  const arr = Array.from(map.values()) // Map의 값들만 뽑아 배열로 만듭니다.

  arr.sort((a, b) => {
    // 요청된 기준에 따라 내림차순 정렬을 수행합니다.
    if (sortBy === 'post') return b.postCount - a.postCount
    if (sortBy === 'comment') return b.commentCount - a.commentCount
    // 기본값: 글 수 + 댓글 수를 합산하여 정렬
    return (b.postCount + b.commentCount) - (a.postCount + a.commentCount)
  })

  return arr // 정렬된 배열을 반환합니다.
}

/**
 * 랭킹 정보를 사용자가 읽기 좋은 텍스트 형식으로 변환합니다 (파일 저장용).
 * @param {Array} ranking - 정렬된 랭킹 배열
 * @param {string} gallName - 갤러리 이름
 * @param {string} mode - 출력 모드
 * @returns {string} - 포맷팅된 텍스트 문자열
 */
function toText(ranking, gallName, mode) {
  // 전체 글 수와 댓글 수의 총합을 계산합니다.
  const totalPosts = ranking.reduce((s, u) => s + u.postCount, 0)
  const totalComments = ranking.reduce((s, u) => s + u.commentCount, 0)

  const modeLabel = { combined: '글+댓글 통합', post: '글 수', comment: '댓글 수' }[mode]

  let lines = [
    `${gallName} ${modeLabel} 랭킹`,
    `총 글: ${totalPosts} | 총 댓글: ${totalComments}`,
    '─'.repeat(60), // 가용성 증대를 위한 구분선
  ]

  if (mode === 'combined') {
    lines.push('순위\t\t닉네임(ID/IP)\t\t글 수\t\t댓글 수\t\t합산')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid // 유동닉은 IP, 고정닉은 ID 표시
      const combined = u.postCount + u.commentCount
      lines.push(`${i + 1}위\t\t${u.nick}(${id})\t\t${u.postCount}\t\t${u.commentCount}\t\t${combined}`)
    })
  } else if (mode === 'post') {
    lines.push('순위\t\t닉네임(ID/IP)\t\t글 수')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
      lines.push(`${i + 1}위\t\t${u.nick}(${id})\t\t${u.postCount}`)
    })
  } else {
    lines.push('순위\t\t닉네임(ID/IP)\t\t댓글 수')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
      lines.push(`${i + 1}위\t\t${u.nick}(${id})\t\t${u.commentCount}`)
    })
  }

  return lines.join('\n') // 모든 줄을 줄바꿈 문자로 합쳐 반환합니다.
}

/**
 * 유저의 정보를 바탕으로 Map의 키로 사용할 고유 문자열을 생성합니다.
 * 고정닉: 'fixed::ID'
 * 유동닉: 'fluid::닉네임::IP' (단, 닉네임이 'ㅇㅇ'인 경우 IP로만 식별)
 */
function makeKey(user) {
  if (!user.isFluid && user.uid) {
    return `fixed::${user.uid}` // 고정닉 고유 키
  }
  // 유동닉 중 'ㅇㅇ' 닉네임은 변별력이 없으므로 무시하고 IP 위주로 처리합니다.
  const nick = user.nick === 'ㅇㅇ' ? '' : user.nick
  return `fluid::${nick}::${user.ip || ''}` // 유동닉 고유 키
}

// 외부 모듈(main.js 등)에서 이 로직들을 사용할 수 있도록 내보냅니다.
module.exports = { aggregatePosts, mergeResults, toRanking, toText, makeKey }

