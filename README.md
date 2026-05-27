# Manuscrit ✒️

웹소설 작가를 위한 집필 스튜디오. Scrivener에서 영감을 받은 PWA 앱.

## 기능

- **3단 레이아웃** — 프로젝트 트리 / 에디터 / 메모 (데스크톱), 풀스크린 에디터 + 슬라이드 패널 (모바일)
- **Google Drive 동기화** — appDataFolder에 자동 저장, 크로스 디바이스 싱크
- **상태 관리** — 초고(🟠) / 퇴고(🔴) / 완성(🟢) 배지, 클릭으로 순환
- **전체 검색** — 모든 프로젝트의 제목/본문/메모를 실시간 검색
- **TXT 추출** — 원하는 화를 선택해서 텍스트 파일로 내보내기
- **드래그앤드롭** — 프로젝트와 화의 순서를 자유롭게 변경
- **PWA** — 브라우저에서 설치하면 네이티브 앱처럼 독립 창으로 실행

## 배포 방법

### 1. GitHub 리포지토리 생성

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/manuscrit.git
git branch -M main
git push -u origin main
```

### 2. GitHub Pages 설정

1. GitHub 리포지토리 → **Settings** → **Pages**
2. Source를 **GitHub Actions**로 선택
3. push하면 자동으로 빌드 & 배포됨

### 3. Google Drive API 설정

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 프로젝트 생성
2. **APIs & Services** → **OAuth consent screen** 설정 (External, 본인 이메일만 test user 추가)
3. **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://YOUR_USERNAME.github.io`
   - Authorized redirect URIs: `https://YOUR_USERNAME.github.io/manuscrit/`
4. 발급받은 Client ID를 `src/App.jsx`의 `GOOGLE_CLIENT_ID` 상수에 입력
5. **APIs & Services** → **Library** → **Google Drive API** 활성화

### 4. 로컬 개발

```bash
npm install
npm run dev
```

## PWA 설치

배포 후 Chrome/Edge 주소창의 **설치** 아이콘 클릭 → 독립 창으로 실행됨.
모바일은 Safari/Chrome → **홈 화면에 추가**.

## 아이콘

`public/icon-192.png`과 `public/icon-512.png`을 교체하세요.
현재는 placeholder이며, Concept B (Platen + 펜촉) 디자인을 적용하면 됩니다.

## 기술 스택

React 18 · Tailwind CSS 3 · Vite 5 · vite-plugin-pwa · Google Drive API · Lucide Icons
