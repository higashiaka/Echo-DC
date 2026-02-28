import { app, dialog } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type {
  UserRank,
  TempFileMeta,
  TempFileInfo,
  AnalysisResult,
  AnalysisType,
  SaveResultOptions
} from '../shared/ipc-types'

interface TempFileContent {
  meta: TempFileMeta
  data: UserRank[]
}

export class FileManager {
  private tempDir: string

  constructor() {
    this.tempDir = path.join(app.getPath('userData'), 'temp')
  }

  private async ensureTempDir(): Promise<void> {
    await fs.mkdir(this.tempDir, { recursive: true })
  }

  // ── 임시 파일 저장 ──────────────────────────────────────────
  async saveTempData(
    galleryId: string,
    galleryName: string,
    analysisType: AnalysisType,
    startDate: string,
    endDate: string,
    data: UserRank[]
  ): Promise<string> {
    await this.ensureTempDir()

    const now = new Date()
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `${galleryId}_${analysisType}_${ts}.json`

    const content: TempFileContent = {
      meta: {
        galleryId,
        galleryName,
        analysisType,
        startDate,
        endDate,
        createdAt: now.toISOString()
      },
      data
    }

    await fs.writeFile(
      path.join(this.tempDir, filename),
      JSON.stringify(content, null, 2),
      'utf-8'
    )
    return filename
  }

  // ── 임시 파일 목록 ──────────────────────────────────────────
  async listTempFiles(): Promise<TempFileInfo[]> {
    await this.ensureTempDir()

    const files = await fs.readdir(this.tempDir)
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse()

    const result: TempFileInfo[] = []
    for (const filename of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(this.tempDir, filename), 'utf-8')
        const content: TempFileContent = JSON.parse(raw)
        result.push({ filename, meta: content.meta })
      } catch {
        // 읽기 실패한 파일은 목록에서 제외
      }
    }
    return result
  }

  // ── 임시 파일 로드 ──────────────────────────────────────────
  async loadTempFile(filename: string): Promise<AnalysisResult> {
    const raw = await fs.readFile(path.join(this.tempDir, filename), 'utf-8')
    const content: TempFileContent = JSON.parse(raw)
    return {
      galleryId: content.meta.galleryId,
      galleryName: content.meta.galleryName,
      startDate: content.meta.startDate,
      endDate: content.meta.endDate,
      analysisType: content.meta.analysisType,
      ranking: content.data,
      tempFilename: filename
    }
  }

  // ── 결과 저장 (텍스트 / HTML) ───────────────────────────────
  async saveResult(options: SaveResultOptions): Promise<string | null> {
    const { format, galleryName, startDate, endDate, analysisType } = options
    const ext = format === 'html' ? 'html' : 'txt'
    const typeLabel = analysisType === 'comment' ? '댓글' : '글'
    const defaultName = `${galleryName}_${typeLabel}랭킹_${startDate}~${endDate}.${ext}`

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '랭킹 저장',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [
        format === 'html'
          ? { name: 'HTML 파일', extensions: ['html'] }
          : { name: '텍스트 파일', extensions: ['txt'] }
      ]
    })

    if (canceled || !filePath) return null

    const content =
      format === 'html'
        ? this.generateHTML(options)
        : this.generateText(options)

    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  // ── 텍스트 생성 ──────────────────────────────────────────────
  private generateText(options: SaveResultOptions): string {
    const { galleryName, startDate, endDate, analysisType, data, maximumRank, minimumCount } =
      options
    const isBoth = analysisType === 'both'
    const typeLabel = isBoth ? '글+댓글' : (analysisType === 'comment' ? '댓글' : '글')

    // 합계 계산
    const totalSum = data.reduce(
      (s, u) => s + (isBoth ? (u.postCount + u.commentCount) : (analysisType === 'comment' ? u.commentCount : u.postCount)),
      0
    )

    const header = isBoth
      ? `순위\t닉네임\t총합\t(글/댓글)\t비율`
      : `순위\t닉네임\t${analysisType === 'comment' ? '댓글수' : '글수'}\t비율`

    const lines: string[] = [
      `DC ${typeLabel} 랭킹 by dc-ranking`,
      `갤러리: ${galleryName}`,
      `기간: ${startDate} ~ ${endDate}`,
      `총 ${typeLabel}: ${totalSum}개`,
      '',
      header
    ]

    let rank = 0
    let displayRank = 0
    let prevVal = -1

    for (const user of data) {
      const val = isBoth ? (user.postCount + user.commentCount) : (analysisType === 'comment' ? user.commentCount : user.postCount)
      if (val < minimumCount) break
      rank++
      if (val !== prevVal) displayRank = rank
      if (displayRank > maximumRank) break
      prevVal = val

      const percent = totalSum > 0 ? ((val / totalSum) * 100).toFixed(2) : '0.00'
      const suffix = user.isFluid ? `(${user.ip})` : `(${user.uid})`
      const name = user.name.includes(suffix) ? user.name : `${user.name}${suffix}`

      if (isBoth) {
        lines.push(`${displayRank}위\t${name}\t${val}개\t(${user.postCount}/${user.commentCount})\t${percent}%`)
      } else {
        lines.push(`${displayRank}위\t${name}\t${val}개\t${percent}%`)
      }
    }

    return lines.join('\n')
  }

  // ── HTML 생성 (순수 table 태그와 내용물만 저장) ────────────────
  private generateHTML(options: SaveResultOptions): string {
    const { analysisType, data, maximumRank, minimumCount } = options
    const isBoth = analysisType === 'both'

    const totalSum = data.reduce(
      (s, u) => s + (isBoth ? (u.postCount + u.commentCount) : (analysisType === 'comment' ? u.commentCount : u.postCount)),
      0
    )

    const rows: string[] = []
    let rank = 0
    let displayRank = 0
    let prevVal = -1

    for (const user of data) {
      const val = isBoth ? (user.postCount + user.commentCount) : (analysisType === 'comment' ? user.commentCount : user.postCount)
      if (val < minimumCount) break
      rank++
      if (val !== prevVal) displayRank = rank
      if (displayRank > maximumRank) break
      prevVal = val

      const percent = totalSum > 0 ? ((val / totalSum) * 100).toFixed(2) : '0.00'
      const suffix = user.isFluid ? `(${user.ip})` : `(${user.uid})`
      const name = user.name.includes(suffix) ? user.name : `${user.name}${suffix}`

      const countCell = isBoth
        ? `<td>${val.toLocaleString()} (글 ${user.postCount} / 댓 ${user.commentCount})</td>`
        : `<td>${val.toLocaleString()}</td>`

      rows.push(
        `<tr>` +
        `<td>${displayRank}위</td>` +
        `<td>${escapeHtml(name)}</td>` +
        countCell +
        `<td>${percent}%</td>` +
        `</tr>`
      )
    }

    const countHeader = isBoth ? '총합 (글 / 댓글)' : (analysisType === 'comment' ? '댓글 수' : '글 수')

    return `<table>
  <thead>
    <tr>
      <th>순위</th>
      <th>닉네임 (ID/IP)</th>
      <th>${countHeader}</th>
      <th>비율</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join('\n    ')}
  </tbody>
</table>`
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
