import axios from 'axios'

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.6099.144 Mobile Safari/537.36'

const BASE_HEADERS = {
  'User-Agent': MOBILE_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
}

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36'

export interface GetResult {
  data: string
  status: number
}

export class DCClient {
  private sessionCookie = ''

  private extractCookies(headers: Record<string, string | string[] | undefined>): string {
    const raw = headers['set-cookie']
    if (!raw) return ''
    const list = Array.isArray(raw) ? raw : [raw]
    return list.map((c) => c.split(';')[0]).join('; ')
  }

  private cookieHeader(): Record<string, string> {
    return this.sessionCookie ? { Cookie: this.sessionCookie } : {}
  }

  private async requestWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 1000
  ): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (retries <= 0) throw e
      await new Promise((resolve) => setTimeout(resolve, delay))
      return this.requestWithRetry(fn, retries - 1, delay * 2)
    }
  }

  // m.dcinside.com 메인을 방문해 세션 쿠키를 획득
  async initSession(): Promise<void> {
    try {
      await this.requestWithRetry(async () => {
        const res = await axios.get<string>('https://m.dcinside.com/', {
          headers: BASE_HEADERS,
          timeout: 10000,
          maxRedirects: 0,
          validateStatus: (s) => s < 400,
          responseType: 'text'
        })
        const cookie = this.extractCookies(res.headers as Record<string, string | string[]>)
        if (cookie) this.sessionCookie = cookie
      }, 2) // 세션 초기화는 2회만 재시도
    } catch {
      // 세션 초기화 실패는 무시 (이후 요청에서 재시도)
    }
  }

  // maxRedirects:0 으로 리다이렉트를 직접 감지, 쿠키 자동 갱신
  async get(url: string): Promise<GetResult> {
    return this.requestWithRetry(async () => {
      const res = await axios.get<string>(url, {
        headers: {
          ...BASE_HEADERS,
          Referer: 'https://m.dcinside.com/',
          ...this.cookieHeader()
        },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (s) => s < 500,
        responseType: 'text'
      })
      const cookie = this.extractCookies(res.headers as Record<string, string | string[]>)
      if (cookie) this.sessionCookie = cookie
      return { data: typeof res.data === 'string' ? res.data : '', status: res.status }
    })
  }

  // 데스크탑 UA로 갤러리 목록 페이지 요청 (sources/DCHelper.cs AnalyzeGallery 방식)
  async getPage(url: string): Promise<GetResult> {
    return this.requestWithRetry(async () => {
      const res = await axios.get<string>(url, {
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        timeout: 15000,
        responseType: 'text'
      })
      return { data: typeof res.data === 'string' ? res.data : '', status: res.status }
    })
  }

  async postForm(url: string, fields: Record<string, string>): Promise<string> {
    return this.requestWithRetry(async () => {
      const body = new URLSearchParams(fields).toString()
      const res = await axios.post<string>(url, body, {
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://m.dcinside.com/',
          ...this.cookieHeader()
        },
        timeout: 15000,
        responseType: 'text'
      })
      return res.data
    })
  }
}
