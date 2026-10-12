# 홀덤 온라인 (친구와 함께)

방 코드를 만들어 친구를 부르는 텍사스 홀덤. 사람 1~4명, 빈자리는 AI가 앉아요.
외부 패키지가 없어서 `npm install`이 필요 없어요. (Node 18 이상)

## 1. 맥북에서 먼저 돌려보기
```
cd holdem-online
node server.js
```
브라우저에서 http://localhost:3000 → "친구와 온라인" → 방 만들기.
같은 와이파이의 친구는 맥북의 내부 주소(예: http://192.168.0.12:3000)로 들어오면 돼요.
(주소는 시스템 설정 → 네트워크에서 확인)

## 2. 클라우드에 올리기 (Render, 무료)
1. GitHub에 새 저장소를 만들고 이 폴더 내용을 올려요.
   ```
   cd holdem-online
   git init && git add . && git commit -m "holdem online"
   git branch -M main
   git remote add origin https://github.com/내아이디/holdem-online.git
   git push -u origin main
   ```
2. https://render.com 에 GitHub 계정으로 가입 → New + → **Web Service** → 그 저장소 선택.
3. Runtime `Node`, Build Command 는 비워두거나 `echo no build`, Start Command `node server.js`, Instance Type `Free`.
   (저장소에 `render.yaml`이 있어서 New + → Blueprint 로 올려도 같은 설정이 적용돼요.)
4. 배포가 끝나면 `https://○○.onrender.com` 주소가 생겨요. 그 주소를 친구와 공유하면 끝.

## 알아둘 점
- 무료 서버는 15분 동안 아무도 안 쓰면 잠들어요. 다시 열면 첫 접속이 30초~1분 걸릴 수 있어요.
- 방은 서버 메모리에만 있어서, 서버가 재시작되거나 잠들었다 깨면 진행 중이던 방은 사라져요. 게임 중에는 괜찮아요.
- 내 차례에 45초 안에 행동하지 않으면 자동으로 체크(공짜일 때) 또는 폴드돼요.
- 접속이 끊겨도 같은 브라우저로 다시 열면 같은 자리로 돌아와요. 방을 떠난 사람의 자리는 계속 자동 폴드돼요.
- 방 화면의 **AI 상대** 스위치(방장만 조작)로 AI를 켜고 끌 수 있어요. 끄면 모인 사람들(2~4명)끼리만 하고, 1대1도 돼요.
- 방 코드는 4글자이고, 게임이 시작된 뒤에는 새로 들어올 수 없어요.
- 채팅: 방 화면과 게임 중 모두 위쪽의 "채팅" 버튼으로 열 수 있어요. 안 읽은 메시지는 숫자로 표시돼요.
- 혼자 연습하기는 같은 페이지의 "혼자 연습" 버튼으로 그대로 할 수 있어요.

## 파일
- `server.js` 서버 (방, 실시간 전달, 타이머)
- `engine.js` 게임 규칙 + AI (혼자 하기와 같은 코드)
- `public/index.html` 화면
