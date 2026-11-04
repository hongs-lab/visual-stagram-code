# Visual Stagram Code (VS Code 확장)

쓰던 VS Code 안에서 인스타그램 DM을 코드처럼 봅니다. 기본은 파이썬이고, 확장자를 바꾸면 그 언어의 코드가 됩니다.

## 필요한 것

[Visual Stagram Code 데스크톱 앱](https://hongs-lab.github.io/visual-stagram-code/)이 설치되어 있고, 그 앱에서 인스타그램에 한 번 로그인되어 있어야 합니다.
확장은 그 앱을 창 없이 뒤에서 실행해 대화를 가져옵니다. 로그인과 비밀번호는 앱 안의 instagram.com 페이지에서만 다룹니다.

## 쓰는 법

- 탐색기 아래 `DIRECT` 목록의 `kim_minsu.py` 같은 파일(이름은 영어로 바뀌어 보입니다)을 누르면 대화가 파이썬 파일로 열립니다.
  안 읽은 대화는 새 파일처럼 초록색 `U` 로 표시됩니다
- `print(...)` 는 받은 메시지(왼쪽 파란 막대), `reply = input(...)` 같은 줄은 내가 보낸 메시지(초록 막대)입니다
- 마지막의 `reply = input("")` 같은 줄이 입력 줄입니다. 따옴표 안에 바로 쓰고 `Enter` 를 누르면 전송됩니다.
  다른 줄은 고쳐지지 않고, 거기에 친 글자는 입력 줄로 옮겨집니다
- `Cmd+O` (Windows는 `Ctrl+O`) : 파일 첨부. 그다음 `Enter` 로 전송
- `Alt+↑` 또는 맨 위로 스크롤 : 이전 메시지 불러오기
- 사진 줄에 마우스를 올리면 미리보기가 뜹니다
- 설정 `visualStagram.camouflage` (0, 2, 4, 8) : 메시지 사이에 섞는 위장 코드의 양
- 설정 `visualStagram.fileType` (`py`, `js`, `kt`, `swift`, `sql`, `html`, `md` ...) : 대화 파일의 확장자.
  명령 `Visual Stagram: 대화 파일 형식 바꾸기` 로 목록에서 골라도 됩니다. 아이콘은 쓰고 있는 아이콘 테마(예: Material Icon Theme)를 따릅니다
