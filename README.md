# Visual Stagram Code

VS Code처럼 보이는 인스타그램 DM 앱. 대화가 파이썬 코드처럼 보입니다.

## 1. 로그인

탭 줄 오른쪽 끝의 미리보기 아이콘을 누르면 인스타그램 로그인 화면이 나옵니다.
로그인이 끝나면 자동으로 이 화면으로 돌아오고, 다음부터는 로그인된 채로 열립니다.
비밀번호는 instagram.com 페이지에 직접 입력되며 이 앱은 저장하지 않습니다.

## 2. 대화 열기

왼쪽 EXPLORER의 `direct` 폴더 안 `이름.py` 파일 하나가 대화방 하나입니다.
파일을 누르면 대화가 열립니다. 이 설명서는 `README.md`를 누르면 다시 볼 수 있습니다.

## 3. 읽기

- `print("안녕")` : 받은 메시지
- `input("안녕")` : 내가 보낸 메시지
- `# 오후 9:03` : 시간, 읽음 표시, 보낸 사람 이름
- `print(open("photo.jpg"))` : 사진과 GIF. 마우스를 올리면 미리보기가 뜹니다
- 맨 위에서 더 위로 스크롤하면 이전 메시지를 불러옵니다

## 4. 보내기

마지막 줄 `input("")` 의 따옴표 안에 쓰고 Enter를 누르면 전송됩니다.

## 5. 사진 보내기

- 복사한 이미지를 마지막 줄에 붙여넣기 (`Cmd+V`, Windows는 `Ctrl+V`)
- 파일을 에디터 위로 끌어다 놓기
- `Cmd+O` (Windows는 `Ctrl+O`) 로 파일 고르기

`# 1 attachment(s) ready, Enter sends` 줄이 뜨면 Enter로 보냅니다.

## 그 밖에

- 미리보기 아이콘 : 실제 인스타그램 화면과 코드 화면을 전환합니다.
  GIF·스티커 검색, 통화, 메시지 삭제처럼 코드 화면에 없는 기능은 실제 화면에서 하세요
- 왼쪽 맨 위 탐색기 아이콘 : 사이드바를 접고 폅니다
- 제목 줄의 화살표 : 인스타그램 화면의 뒤로/앞으로

## 설치

- macOS : `Visual-Stagram-Code-mac-arm64.dmg` 를 열어 Applications로 끌어다 놓습니다 (Apple Silicon 맥).
  처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기"
- Windows : `Visual-Stagram-Code-Setup.exe` 를 실행합니다.
  "Windows의 PC 보호" 창이 뜨면 추가 정보 > 실행

## 개발

- `npm install` 후 `npm start` : 실행
- `npm test` : 자체 점검
- `npm run dist` : 설치 파일 만들기 (`dist/` 에 macOS `.dmg`, Windows `.exe`)
