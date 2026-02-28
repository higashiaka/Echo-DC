# Echo-DC

DCInside 갤러리의 글·댓글 수를 통합 집계하여 사용자별 랭킹을 생성하는 데스크톱 애플리케이션입니다.

## 다운로드

[Releases](https://github.com/higashiaka/Echo-DC/releases) 페이지에서 최신 버전을 다운로드하세요.

| 파일 | 설명 |
|------|------|
| `Echo-DC Setup x.x.x.exe` | 설치형 (권장) |
| `Echo-DC x.x.x.exe` | 포터블 (설치 없이 실행) |

## 기능

- **갤러리 통합 집계** — 일반 갤러리, 마이너 갤러리, 미니갤러리 지원
- **수집 대상 선택** — 글+댓글 / 글만 / 댓글만
- **범위 지정** — 페이지 범위 또는 날짜 범위로 수집 구간 설정
- **사용자 식별** — 고정닉(UID 기준)·유동닉(닉네임+IP 기준) 자동 구분
- **랭킹 3종** — 통합(글+댓글), 글 수, 댓글 수 별 정렬
- **결과 저장** — TXT 및 HTML 파일로 내보내기

## 사용 방법

1. **갤러리 설정** — 갤러리 유형(일반/마이너/미니)과 ID를 입력하고 검증
2. **범위 설정** — 수집할 페이지 범위와 날짜 범위(선택) 입력
3. **수집 모드 선택** — 글+댓글 / 글만 / 댓글만 중 선택
4. **크롤링 시작** — 진행률과 로그를 실시간으로 확인
5. **결과 확인** — 탭별 랭킹 테이블 확인 후 TXT/HTML로 저장

## 기술 스택

- **Electron 28** — 데스크톱 앱 프레임워크
- **React 18 + Vite 5** — UI
- **axios + cheerio** — HTTP 요청 및 HTML 파싱

## 개발 환경 설정

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (Vite + Electron 동시 실행)
npm run dev
```

## 빌드

```bash
npm run build
```

빌드 결과물은 `dist-electron/` 폴더에 생성됩니다.

## 릴리즈

`v`로 시작하는 태그를 푸시하면 GitHub Actions가 자동으로 빌드 후 릴리즈에 exe 파일을 업로드합니다.

```bash
git tag v1.1.0
git push origin v1.1.0
```

# 참고한 프로젝트
https://github.com/hanel2527/dcinisde-crawler.ver.2

https://github.com/OFox213/DCRanking
