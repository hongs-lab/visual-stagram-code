# Visual Stagram Code

VS Code처럼 보이는 인스타그램(과 텔레그램) DM 앱. 대화가 코드처럼 보입니다.

## 1. 로그인

탭 줄 오른쪽 끝의 미리보기 아이콘을 누르면 인스타그램 로그인 화면이 나옵니다.
로그인이 끝나면 자동으로 이 화면으로 돌아오고, 다음부터는 로그인된 채로 열립니다.
비밀번호는 instagram.com 페이지에 직접 입력되며 이 앱은 저장하지 않습니다.
텔레그램은 탐색기의 `telegram` 폴더를 펼치면 web.telegram.org 로그인 화면(QR)이 나옵니다.

## 2. 대화 열기

왼쪽 EXPLORER의 `direct` 폴더 안 파일 하나가 대화방 하나입니다. 이름은 영어로 바뀌어 보입니다 (`김민수` → `kim_minsu.py`).
파일을 누르면 대화가 탭으로 열립니다. 이 설명서는 `README.md`를 누르면 다시 볼 수 있습니다.

처음 실행하면 대화 파일의 확장자를 고르는 창이 뜹니다. VS Code가 아는 확장자와 Material Icon Theme에 아이콘이 있는 확장자를 모두 고를 수 있습니다
(`.py` `.js` `.kt` `.swift` `.sql` `.html` `.md` ...). 확장자에 맞는 언어의 코드로 보입니다. 이름이나 언어를 모르면 `kot`, `Kotlin` 처럼 쳐서 찾으면 됩니다.
나중에 바꾸려면 `Cmd+Shift+P` > `Direct: Change File Type of Conversations...` 를 쓰세요

- 안 읽은 대화는 git의 새 파일처럼 초록색 `U`, 안 읽은 대화가 든 폴더는 `●` 로 표시됩니다.
  안 읽은 수는 왼쪽 소스 제어 아이콘과 Dock(Windows는 작업 표시줄)에 숫자로 뜹니다
- 목록 아래쪽에 묻힌 단체방: 탐색기를 맨 아래까지 내리면 이전 대화를 더 불러옵니다.
  `Cmd+P` 로 이름(한글 이름도 됨)을 찾다가 없으면 `Search older conversations...` 를 고르세요
- 새 대화: `Cmd+Shift+P` > `Direct: New Message...` 또는 파일 오른쪽 클릭 > `New Message...`

## 3. 읽기

- 받은 메시지는 줄 번호 옆에 파란 막대, 보낸 메시지는 초록 막대가 붙습니다
- 받은 메시지는 `print(...)`, `logger.info(...)` 같은 출력, 보낸 메시지는 `reply = input(...)` 같은 입력 줄입니다.
  연달아 온 메시지는 리스트나 딕셔너리 하나로 묶이기도 합니다
- 그 사이의 함수, 반복문 같은 코드는 진짜처럼 보이게 섞어 넣은 위장 코드입니다
- 맨 위 주석에 상대 이름, 단체방이면 참여자(`Members:`), 마지막으로 확인한 시간이 있습니다
- `# 오후 9:03` 같은 주석 : 시간, 읽음 표시, 단체방의 보낸 사람 이름
- `print(open("photo.jpg"))` : 사진, 스토리, GIF. 마우스를 올리면 미리보기가 뜹니다
- 긴 메시지는 줄바꿈되어 보입니다 (`Alt+Z` 로 끄고 켭니다)
- 맨 위에서 더 위로 스크롤하면 이전 메시지를 불러옵니다

## 4. 보내기

마지막의 `reply = input()` 같은 줄이 입력 줄입니다. 괄호 안에 쓰면 따옴표가 자동으로 붙고, Enter를 누르면 전송됩니다.
보내는 동안에도 계속 칠 수 있고, 안 나간 메시지는 입력 줄로 돌아옵니다. `Shift+Enter` 는 줄바꿈.

- 멘션: `@` 를 치면 참여자 목록이 위에 뜹니다 (화살표, Enter). 주석의 보낸 사람 이름이나 `Members:` 의 `@이름` 을 눌러도 됩니다

## 5. 사진 보내기

- 복사한 이미지를 마지막 줄에 붙여넣기 (`Cmd+V`, Windows는 `Ctrl+V`)
- 파일을 에디터 위로 끌어다 놓기
- `Cmd+O` (Windows는 `Ctrl+O`) 로 파일 고르기

`# 1 attachment(s) ready, Enter sends` 줄이 뜨면 Enter로 보냅니다.

## 6. 파일처럼 다루기

- 이름 바꾸기 : `F2` 또는 오른쪽 클릭 > Rename. 확장자를 바꾸면 그 파일만 언어가 바뀝니다 (VS Code가 아는 언어 전부).
  상태 줄의 언어 이름을 누르면 언어 목록에서 고를 수 있습니다
- 새 파일/폴더 : 탐색기 위 아이콘, `Cmd+N`. 직접 만든 파일에는 진짜 코드를 쓸 수 있고 (`Tab`, 자동 들여쓰기, `Cmd+/` 주석),
  `.py`/`.js` 파일은 `F5` 로 아래 터미널에서 실행됩니다
- 끌어다 놓기 : 대화 파일을 폴더로 옮겨 정리합니다 (예: `groups` 폴더에 단체방)
- 지우기 : `Cmd+Backspace`. 대화 파일은 목록에서만 사라지고, 새 메시지가 오면 다시 나타납니다
- 탭 : `Cmd+W` 닫기, `Cmd+Shift+T` 닫은 탭 다시 열기, `Ctrl+Tab` 다음 탭

## 7. 들킬 것 같을 때

- `Esc` (설정 `workbench.panicKey` 로 바꿀 수 있음) : 바로 `main.py` 로 바뀝니다. 실제 인스타 화면을 보고 있을 때도 됩니다
- `main.py` 에서는 아무 키나 누르면 진짜 코드가 몇 글자씩 쳐집니다. Enter는 줄 끝까지, Backspace는 지우기
- `activity.log` : 인스타 알림(좋아요, 팔로우, 댓글). 마지막으로 확인한 지점에 `---- last checked ----` 줄이 생깁니다

## 8. 설정

`Cmd+,` 로 `.vscode/settings.json` 이 열립니다.

- `editor.tabSize` : 위장 코드 양 (0, 2, 4, 8). 상태 줄의 `Spaces: 2` 를 눌러도 바뀝니다. `0` 이면 메시지 줄만 보입니다
- `editor.wordWrap` : 긴 줄 줄바꿈 (`"on"`/`"off"`)
- `files.defaultLanguage` : 대화 파일의 확장자 (예: `"py"`, `"kt"`, `"sql"`). 바꾸면 이전 확장자였던 대화 파일이 모두 새 확장자로 바뀝니다
- `workbench.panicKey` : 바로 `main.py` 로 가는 키 (예: `"Escape"`, `"F12"`, `"Ctrl+Shift+Space"`)
- `notifications.enabled`, `notifications.showPreview` : 새 메시지 알림. 이미 띄운 알림은 껐다 켜도 다시 뜨지 않습니다
- `window.title` : 창 제목

## 9. 그 밖에

- 미리보기 아이콘 : 실제 인스타그램 화면과 코드 화면을 전환합니다.
  GIF·스티커 검색, 통화, 메시지 삭제처럼 코드 화면에 없는 기능은 실제 화면에서 하세요
- 왼쪽 아이콘 : 탐색기, 검색(대화 내용 검색), 소스 제어(안 읽은 대화), 실행, 확장
- `Cmd+J` (터미널만은 Ctrl+백틱) : 아래 패널. 터미널은 진짜 셸이라 명령이 실제로 실행됩니다
- `Cmd+P` 파일 찾기, `Cmd+Shift+P` 명령 팔레트, `Cmd+B` 사이드바 접기
- 카카오톡은 웹 버전이 없어서 이 방식으로 넣을 수 없습니다
- 파일·폴더 아이콘은 [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT, `icons/LICENSE`) 의 것입니다

## 10. 쓰던 VS Code에서 쓰기 (확장)

이 앱을 설치하고 한 번 로그인해 두면, 진짜 VS Code 안에서도 DM을 볼 수 있습니다.

- VS Code의 확장 보기에서 `Visual Stagram Code` 를 검색해 설치합니다
- 검색에 나오지 않는 에디터(Cursor 등)는 `visual-stagram-code.vsix` 를 받아 확장 보기 > `...` > "VSIX에서 설치" 로 설치합니다
- 탐색기 아래 `DIRECT` 목록에서 `kim_minsu.py` 같은 파일을 누르면 대화가 열립니다. 안 읽은 대화는 `U` 로 표시됩니다
- 대화 파일 마지막의 `reply = input("")` 같은 줄에 바로 쓰고 Enter를 누르면 전송됩니다
- 설정 `visualStagram.fileType` (또는 명령 `Visual Stagram: 대화 파일 형식 바꾸기`) 로 확장자를 바꿉니다. 아이콘은 쓰고 있는 아이콘 테마를 따릅니다
- 확장은 이 앱을 창 없이 뒤에서 실행해 씁니다. 따로 켜 둘 필요는 없습니다

## 설치

- macOS : `Visual-Stagram-Code-mac-arm64.dmg` 를 열어 Applications로 끌어다 놓습니다 (Apple Silicon 맥).
  처음 열 때 막히면 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기"
- Windows : `Visual-Stagram-Code-Setup.exe` 를 실행합니다.
  "Windows의 PC 보호" 창이 뜨면 추가 정보 > 실행

## 개발

- `npm install` 후 `npm start` : 실행
- `npm test` : 자체 점검
- `npm run dist` : 설치 파일 만들기 (`dist/` 에 macOS `.dmg`, Windows `.exe`)
- `cd vscode-extension && npm run package` : VS Code 확장 만들기 (`dist/visual-stagram-code.vsix`)
