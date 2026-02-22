'use strict'

/**
 * 게시글 목록과 댓글 맵을 받아 유저별 통합 집계 결과를 반환한다.
 * Receives the post list and comment map to return integrated aggregation results per user.
 *
 * UserRecord: {
 *   nick: string,
 *   uid: string,
 *   ip: string,
 *   isFluid: boolean,
 *   postCount: number,
 *   commentCount: number,
 * }
 */

/**
 * 게시글 작성자 목록에서 유저별 글 수를 집계한다.
 * 고정닉: uid 기준, 유동닉: nick + ip 기준 (ㅇㅇ는 ip 기준으로만)
 *
 * Aggregates post counts per user from the list of post authors.
 * Fixed ID: based on uid, Fluid ID: based on nick + ip (ㅇㅇ uses ip only).
 *
 * @param {Array<{nick, uid, ip, isFluid}>} posts
 * @returns {Map<string, UserRecord>}
 */
function aggregatePosts(posts) {
  const map = new Map()

  for (const post of posts) {
    const key = makeKey(post)
    if (map.has(key)) {
      map.get(key).postCount++
    } else {
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

  return map
}

/**
 * 게시글 맵과 댓글 맵을 합쳐 통합 UserRecord 맵을 반환한다.
 * Merges the post map and comment map to return an integrated UserRecord map.
 *
 * @param {Map<string, UserRecord>} postMap
 * @param {Map<string, {nick, uid, ip, isFluid, commentCount}>} commentMap
 * @returns {Map<string, UserRecord>}
 */
function mergeResults(postMap, commentMap) {
  // postMap을 기반으로 시작
  const merged = new Map(postMap)

  // commentMap을 순회하며 병합
  for (const [key, cdata] of commentMap) {
    if (merged.has(key)) {
      merged.get(key).commentCount += cdata.commentCount
    } else {
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

  return merged
}

/**
 * 통합 맵을 정렬된 배열로 변환한다.
 * Converts the integrated map into a sorted array.
 *
 * @param {Map<string, UserRecord>} map
 * @param {'combined'|'post'|'comment'} sortBy
 * @returns {UserRecord[]}
 */
function toRanking(map, sortBy = 'combined') {
  const arr = Array.from(map.values())

  arr.sort((a, b) => {
    if (sortBy === 'post') return b.postCount - a.postCount
    if (sortBy === 'comment') return b.commentCount - a.commentCount
    // combined: 글+댓글 합산
    return (b.postCount + b.commentCount) - (a.postCount + a.commentCount)
  })

  return arr
}

/**
 * 결과 배열을 텍스트로 직렬화한다.
 * Serializes the ranking array into a text string.
 *
 * @param {UserRecord[]} ranking
 * @param {string} gallName
 * @param {'combined'|'post'|'comment'} mode
 * @returns {string}
 */
function toText(ranking, gallName, mode) {
  const totalPosts = ranking.reduce((s, u) => s + u.postCount, 0)
  const totalComments = ranking.reduce((s, u) => s + u.commentCount, 0)

  const modeLabel = { combined: '글+댓글 통합', post: '글 수', comment: '댓글 수' }[mode]

  let lines = [
    `${gallName} ${modeLabel} 랭킹`,
    `총 글: ${totalPosts} | 총 댓글: ${totalComments}`,
    '─'.repeat(60),
  ]

  if (mode === 'combined') {
    lines.push('순위\t\t닉네임(ID/IP)\t\t글 수\t\t댓글 수\t\t합산')
    ranking.forEach((u, i) => {
      const id = u.isFluid ? u.ip : u.uid
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

  return lines.join('\n')
}

// 키 생성: 고정닉은 uid, 유동닉은 nick+ip (ㅇㅇ는 ip만)
// Key generation: Fixed ID uses uid, Fluid ID uses nick+ip (ㅇㅇ uses ip only)
function makeKey(user) {
  if (!user.isFluid && user.uid) {
    return `fixed::${user.uid}`
  }
  const nick = user.nick === 'ㅇㅇ' ? '' : user.nick
  return `fluid::${nick}::${user.ip || ''}`
}

module.exports = { aggregatePosts, mergeResults, toRanking, toText, makeKey }
