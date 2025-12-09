# 📡 WebRTC 1:N 실시간 공유 시스템 ver1.1

## 🎞️ 시연 영상 (🌏팀 : KDT 경수오빠못해조)

<img src="./WebRTC_1toN.gif">

**[팀 프로젝트 과제]** 

✍️ React와 Node.js를 결합한 실시간 웹 서비스 WebRTC 구현하기

- WebRTC의 구조와 실전 적용을 연습하고 구현 과정을 연습하기 위한 팀 프로젝트입니다.
- **React + Node.js + WebRTC + Socket.IO** 기반으로, 우선 동일한 IP망 내에서 접속/구현되도록 했습니다.

🔀 공유 기능 : 화상(영상), 음성, 필기 보드(화면 공유), 채팅, 메모 창

---

## 📑 목차

1. [프로젝트 소개](#-프로젝트-소개)
2. [WebRTC 핵심 개념](#-webrtc-핵심-개념)
3. [시스템 아키텍처](#-시스템-아키텍처)
4. [WebRTC 연결 흐름](#-webrtc-연결-흐름)
5. [1:1 vs 1:N 구현 비교](#-11-vs-1n-구현-비교)
6. [주요 기능](#-주요-기능)
7. [구현 구조](#-폴더-구조)
8. [실행 방법](#-실행-방법)
9. [시연 영상](#-시연-영상)

---

## 🎯 1. 프로젝트 소개

### 개발 배경

WebRTC(Web Real-Time Communication) 기술을 활용하여 브라우저만으로 실시간 화상 회의, 화면 공유, 협업 도구를 구현한 연습 과제용 프로젝트입니다.

플러그인 없이 순수 웹 기술로 다자간 통신을 구현하며, WebRTC의 핵심 개념과 실전 활용법을 학습합니다.

### 핵심 특징

- ✅ **플러그인 불필요**: 브라우저만으로 실시간 통신
- ✅ **1:N 화상 회의**: 여러 참가자(N명) 동시 연결
- ✅ **P2P 암호화**: 종단 간 보안 통신
- ✅ **실시간 통신**: 화상/화면 공유, 보드 필기, 채팅 공유
- ✅ **네트워크**: STUN 서버로 네트워크 환경 지원

---

## 🔍 2. WebRTC 핵심 개념

### WebRTC의 개념

**WebRTC**는 브라우저와 모바일 앱 간에 **실시간 오디오·비디오·데이터**를 P2P 방식으로 주고받을 수 있게 해주는 오픈 표준 기술입니다.

#### 핵심 키워드
- **MediaStream**: 카메라/마이크/화면 등의 미디어 데이터
- **RTCPeerConnection**: P2P 연결 관리 및 암호화
- **ICE**: 네트워크 경로 탐색
- **STUN/TURN**: NAT 환경에서 연결 지원
- **Signaling**: 연결 설정을 위한 메시지 교환
- **RTCDataChannel**: 임의 데이터 전송

### WebRTC 구성 요소

| 구성 요소 | 역할 |
|----------|------|
| **MediaStream** | `getUserMedia`, `getDisplayMedia`로 가져온 영상/음성/화면 데이터 |
| **RTCPeerConnection** | P2P 연결 관리, 암호화, 패킷 전송, ICE 후보 관리 |
| **ICE** | 가능한 네트워크 경로 후보(공인 IP, 로컬 IP, 릴레이 등) |
| **STUN 서버** | NAT 뒤 클라이언트의 공인 IP/포트 탐색 |
| **TURN 서버** | 직접 연결이 안 될 때 릴레이 서버를 통해 미디어 중계 |
| **RTCDataChannel** | 텍스트/이벤트 등 임의 데이터 전송 |
| **Signaling 서버** | SDP(Offer/Answer), ICE 후보를 교환시키는 메시지 중계 서버 |

💡 **중요**

- 이 프로젝트에서 Signaling 서버는 **Node.js + Socket.IO**로 구현되어, 브라우저 간의 WebRTC 관련 제어 메시지를 전달합니다.
- 이 프로젝트에서는 STUN 서버만 구현했습니다.

---

✅ **앞으로 주요 개선 사항**

- 사용자 인증 시스템 : 회원가입/로그인, 방 입장시 비밀번호 요구 기능
- 보드필기 기능 개선 : 필기 내용 저장/복원, 공유 화면의 스크롤시 필기 위치 동기화
- 네트워크 안정성 : 다른 IP 서버 간 연결 지원 가능 (TURN 서버 활용)
- 배포 환경 개선 : Docker Compose 활용, 실행 단계 간소화

---

## 🏗️ 3. 시스템 아키텍처

### 전체 구조 다이어그램

```
┌────────────────────────────────────────────────────────────────┐
│ 1) 클라이언트 (브라우저, React)                                  
├────────────────────────────────────────────────────────────────┤
│  • UI (카메라 ON/OFF, 채팅, 화면공유, 보드필기)                      
│  • MediaStream (getUserMedia / getDisplayMedia)                
│  • RTCPeerConnection ←─ ICE 후보 요청 ─→ STUN 서버              
│    └─ 암호화된 미디어 전송 (P2P)                                   
│  • RTCDataChannel (채팅, 그림, 메모 등)                          
└────────────────────────────────────────────────────────────────┘
              │
              │ ① Offer / Answer / ICE (신호 메시지)
              ▼
┌────────────────────────────────────────────────────────────────┐
│ 2) 신호 서버 (Node.js + Socket.IO)                               
├────────────────────────────────────────────────────────────────┤
│  • 방 관리 (room-1 등)                                            
│  • 참가자 목록 관리 (1:1, 1:N)                                    
│  • Offer / Answer 교환 중계                                       
│  • ICE Candidate 중계                                            
└────────────────────────────────────────────────────────────────┘
              │
              │ ② 동일한 방의 다른 참가자에게 전달
              ▼
┌────────────────────────────────────────────────────────────────┐
│ 3) 네트워크 계층                                                   
├────────────────────────────────────────────────────────────────┤
│  • STUN 서버: 공인 IP/포트 조회 (NAT 환경에서 필요한 정보 제공)      
│  • TURN 서버: P2P 불가 시 미디어 릴레이(중계) 서버 역할             
└────────────────────────────────────────────────────────────────┘
              │
              │ ③ STUN/TURN의 결과를 기반으로
              │    최종 P2P WebRTC 경로 확정
              ▼
┌────────────────────────────────────────────────────────────────┐
│ 4) 최종 P2P 연결 (브라우저 ↔ 브라우저)                             
├────────────────────────────────────────────────────────────────┤
│  • 비디오 / 오디오 스트림 실시간 전송                               
│  • 데이터 채널 (메모/보드/채팅) 실시간 전송                          
└────────────────────────────────────────────────────────────────┘
```

### 계층별 역할

1. **클라이언트**: WebRTC 엔진 (미디어 처리 + P2P 연결)
2. **신호 서버**: 연결 설정을 위한 메시지 중계만 담당
3. **네트워크**: STUN/TURN으로 네트워크 경로 탐색
4. **P2P 연결**: 실제 미디어/데이터 전송

---

## 🔄 4. WebRTC 연결 흐름

### 단계별 연결 프로세스

```
1️⃣ 방 입장
   ├─ 클라이언트: Socket.IO로 서버 연결
   ├─ join-room(roomId, username) 이벤트 전송
   └─ 서버: 방 참가자 정보 브로드캐스트

2️⃣ PeerConnection 생성
   ├─ 각 클라이언트: new RTCPeerConnection(pcConfig)
   └─ 로컬 MediaStream을 addTrack으로 연결

3️⃣ Offer / Answer 교환
   ├─ Caller: createOffer → setLocalDescription(offer)
   │          └─ 서버로 webrtc-offer 전송
   ├─ Callee: setRemoteDescription(offer)
   │          └─ createAnswer → setLocalDescription(answer)
   │          └─ 서버로 webrtc-answer 전송
   └─ Caller: setRemoteDescription(answer)

4️⃣ ICE Candidate 교환
   ├─ onicecandidate 이벤트 발생 시
   ├─ 서버를 통해 webrtc-ice-candidate 전송
   └─ 상대는 addIceCandidate로 후보 추가

5️⃣ P2P 경로 확정
   ├─ 비디오/오디오: ontrack으로 수신 스트림 등록
   └─ 데이터: Socket.IO 또는 DataChannel 이용
```

### 상세 흐름도

```
[클라이언트 A]                [Signaling Server]           [클라이언트 B]
     │                               │                           │
     │───── join-room ──────────────→│                           │
     │                               │──── user-joined ─────────→│
     │                               │                           │
     │                               │                           │
     │←─── createOffer ─────────────→│                           │
     │                               │                           │
     │──── webrtc-offer ────────────→│                           │
     │                               │──── webrtc-offer ────────→│
     │                               │                           │
     │                               │      createAnswer         │
     │                               │                           │
     │                               │←──── webrtc-answer ───────│
     │←──── webrtc-answer ───────────│                           │
     │                               │                           │
     │──── ice-candidate ───────────→│──── ice-candidate ───────→│
     │←──── ice-candidate ───────────│←──── ice-candidate ───────│
     │                               │                           │
     │═══════════════════ P2P Connection Established ════════════│
     │                                                           │
     │←─────────────── MediaStream / DataChannel ───────────────→│
```

---

## 🔀 5. 1:1 vs 1:N 구현 비교

### 공통점

- 모두 **WebRTC 기본 구성**은 동일
  - MediaStream + RTCPeerConnection + ICE + Signaling
- **Offer → Answer → ICE** 순서로 P2P 연결 수립
- 브라우저는 "몇 명과 통신하는지"를 신경 쓰지 않음
- 단지 **PeerConnection 인스턴스 수**와 **스트림 관리 방식**만 다름

### 차이점 상세 비교

| 항목 | 1:1 화상 구현 | 1:N 화상 구현 (본 프로젝트) |
|------|-------------|---------------------------|
| **PeerConnection 개수** | 상대 1명 → pc 1개 | 내 기준으로 참가자 수만큼 pc 여러 개 |
| **Signaling 로직** | 두 클라이언트 간 Offer/Answer/ICE | 방 참가자 전체 목록 기반으로 쌍마다 교환 |
| **스트림 관리** | localStream, remoteStream 1개씩 | localStream + remoteStreams[] 배열 |
| **UI** | 화면 2개 (나/상대) | 그리드 형태의 다중 영상 타일 |
| **부가 기능** | 단순 화상/채팅 | 채팅, 화면 공유, 보드, 공유 메모, 말하는 사람 표시 |

### 1:N 확장 핵심 포인트

```javascript
// 1:1 구조
const peerConnection = new RTCPeerConnection(config);

// 1:N 구조
const peerConnections = {};
participants.forEach(participant => {
  peerConnections[participant.id] = new RTCPeerConnection(config);
});
```

💡 **핵심**: 이 프로젝트는 "PeerConnection 1개" → "참가자별 PeerConnection 객체를 딕셔너리로 관리"로 확장한 구조입니다.

---

## 🚀 6. 주요 기능

### ✔️ 실시간 영상/음성 (1:N)

#### 🎥 화상 회의
- 각 유저는 **[방 입장] → [화상 시작]** 클릭으로 참여
- 모든 참가자의 영상을 자동으로 **타일 형태**로 표시
- 새 유저 입장 시 영상 타일 자동 추가
- 유저 퇴장 시 모든 브라우저에서 해당 타일 자동 제거
- 참가자가 많아지면 **좌우 스크롤**로 영상 탐색 가능

#### 🎤 마이크 기능
- **발화 감지**: 말하는 사람의 영상 테두리가 **연두색**으로 강조
- 음소거 ON/OFF 토글
- 마이크 입력 게인(볼륨) 조절
- 실시간 **마이크 레벨바** 표시

#### 🔊 스피커 기능
- 전체 스피커 볼륨 슬라이더 (0~100%)
- 스피커 음소거 기능
- 상대 마이크가 꺼져 있으면 자동 무음 상태

### ✔️ 화면 공유 (Screen Sharing)

- 어떤 유저든 자신의 브라우저에서 화면 선택해 공유 가능
- 화면 공유는 **모든 사용자에게 실시간 전송**
- 공유 종료 시 공통 화면이 기본 블랙 화면으로 복귀
- `getDisplayMedia` API 활용

### ✔️ 화이트보드 (Board Drawing)

#### ✏️ 필기 기능
- 화면 공유 여부와 **상관없이** 동작
- 모든 유저가 동시에 실시간 필기 가능
- **펜 색상**, **두께** 조절
- Canvas 기반 실시간 stroke 브로드캐스트

#### 🧹 지우개 기능
- **일반 지우개**: 펜 대신 지우개로 선 지우기
- **지우개 크기 슬라이더**로 크기 조절
- **드래그 영역 지우개**: 직사각형 영역 선택해 한 번에 지우기
- **보드 필기 OFF** 시 지우개 버튼들도 자동 비활성화

### ✔️ 실시간 채팅

#### 💬 시스템 메시지
- 유저 입장/퇴장 시, 채팅 창에서 자동 알림
- `user-*** 입장했습니다.` / `user-*** 나갔습니다.`

#### 💬 일반 채팅
- 텍스트 입력 후 전송
- **글자 색상** 선택 가능
- **글자 크기** (작게/보통/크게/최대) 선택 가능
- Socket.IO 기반 실시간 브로드캐스트

### ✔️ 공유 메모 (리치 텍스트)

#### 📝 메모 기능
- 모든 유저가 **동시에 편집** 가능한 실시간 메모
- `contentEditable` + `execCommand` 활용

#### 📝 지원 포맷
- **굵게(B)**, **이탤릭체(I)**, **밑줄(U)**, **취소선(S)**
- **글자 색상** 선택
- **글자 크기** 변경 (px 단위)
- 선택 영역/커서 위치에 서식 적용
- 서로 다른 크기의 텍스트를 한번에 선택해도 일괄 변경 가능
- `note-update` 이벤트로 전체 참가자와 실시간 동기화

### ✔️ 새로고침 초기화

- 브라우저 **F5 새로고침** 시 WebRTC 연결 완전 초기화 됨.
- 다시 **[방 입장] → [화상 시작]**으로 재참여 가능.
- 테스트 및 디버깅 용이

---

## 📁 7. 구현 구조 (VScode)

```
WEBRTC_REACT_FULL_1TON/
│
├── client/                     # React 프론트엔드
│   ├── node_modules/
│   ├── public/
│   │   ├── favicon.ico
│   │   ├── index.html
│   │   ├── logo192.png
│   │   ├── logo512.png
│   │   ├── manifest.json
│   │   └── robots.txt
│   ├── src/
│   │   ├── App.css           # 스타일시트
│   │   ├── App.js            # 메인 WebRTC 로직 (1:N, 채팅, 보드, 메모)
│   │   ├── App.test.js
│   │   ├── index.css
│   │   ├── index.js
│   │   ├── logo.svg
│   │   ├── reportWebVitals.js
│   │   └── setupTests.js
│   ├── .env                  # REACT_APP_SOCKET_URL 설정
│   ├── package-lock.json
│   ├── package.json
│   └── README.md
│
├── server/                    # Node.js + Socket.IO 시그널링 서버
│   ├── node_modules/
│   ├── .env                  # PORT, CLIENT_ORIGIN 설정
│   ├── index.js              # Signaling 서버 메인 로직
│   ├── package-lock.json
│   └── package.json
│
├── .gitignore
├── WebRTC_1toN.gif           # 시연 영상
├── memo.txt
└── README.md                 # 본 문서
```

---

## 🔐 8. 환경 변수 (.env)

### client/.env

```env
REACT_APP_SOCKET_URL=http://<SERVER-IP>:5000
```

- `<SERVER-IP>`: Node.js 서버가 실행되는 IP 주소
- 로컬 테스트 시: `http://localhost:5000`
- 외부 접속 시: 실제 공인 IP 또는 도메인

### server/.env

```env
PORT=5000
CLIENT_ORIGIN=http://<CLIENT-IP>:3000
```

- `PORT`: Socket.IO 서버 포트
- `CLIENT_ORIGIN`: React 클라이언트 주소 (CORS 설정용)
- 여러 장치 테스트 시: `CLIENT_ORIGIN=*` (모든 Origin 허용)

⚠️ **보안 주의**: 프로덕션 환경에서는 `CLIENT_ORIGIN`을 명확히 지정하고, `.env` 파일은 절대 GitHub에 업로드하지 마세요!

---

## 🏃 9. 실행 방법

### 사전 준비

- **Node.js** (LTS 버전 권장)
- **npm** (Node.js와 함께 설치됨)
- **Git** (저장소 클론용)

### 저장소 클론

```bash
git clone <this-repo-url>
cd WEBRTC_REACT_FULL_1TON
```

### 1️⃣ Node.js Signaling 서버 실행

```bash
cd server

# 패키지 설치
npm install

# 환경 변수 설정 (.env 파일 생성)
# PORT=5000
# CLIENT_ORIGIN=http://localhost:3000

# 또는
node index.js
```

**서버 실행 확인**
```
✅ Socket.IO 서버가 http://localhost:5000 에서 동작 중
✅ CORS 설정으로 CLIENT_ORIGIN만 허용
```

### 2️⃣ React 프론트엔드 실행

```bash
cd client

# 패키지 설치
npm install

# 환경 변수 설정 (.env 파일 생성)
# REACT_APP_SOCKET_URL=http://localhost:5000

# 개발 서버 실행
npm start
```

**브라우저 자동 실행**
```
✅ http://localhost:3000 접속
```

### 3️⃣ 1:N 테스트 방법

1. **첫 번째 브라우저**
   - 이름 입력
   - [방 입장] 클릭
   - [화상 시작] 클릭

2. **두 번째 브라우저/탭/PC**
   - 동일한 방 ID로 접속(기본값 : room-1)
   - 필요시 이름 입력(기본값 : user-***)
   - [방 입장] → [화상 시작]
   - [화면 공유], [공유 종료]
   - 퇴장시, [나가기] 클릭

3. **다중 참가자 테스트**
   - 3명, 4명, 5명... 순차적으로 추가
   - 상단 영상 타일에서 모든 참가자 확인
   - 화면 공유, 보드필기, 실시간 채팅/메모 기능 테스트

---

## 🎞️ 시연 영상

🔎 맨위에 첨부

### 시연 주요 장면

| 기능 | 설명 |
|------|------|
| 🚪 **입장 흐름** | 방 번호, 이름 입력 → 공통 방 `room-1` 입장 ('임시로' 인증 절차 간소화)|
| 🎥 **화상 시작** | 카메라/마이크 권한 요청 (팝업 창으로 알림) → 영상 타일 표시 |
| 👥 **참가자 추가** | 새 유저 입장 시 자동으로 타일 추가, N명 입장시 좌우 스크롤 활성 |
| 🖥️ **화면 공유** | 어떤 참가자든 화면 공유 조정 가능, 전체 실시간 화면 공유 |
| ✏️ **보드 필기** | 실시간 펜/색상/지우개 조절 기능, 모든 브라우저에 실시간 동기화 |
| 💬 **채팅** | 입장/퇴장 시 시스템 메시지 + 일반 채팅에 표시됨, 색상/크기 조절 가능 |
| 🎤 **마이크** | 마이크ON에서 발화 시 영상 테두리가 연두색으로 강조됨, 레벨바 표시 |
| 📝 **공유 메모** | 리치 텍스트 실시간 편집 (굵기B/이텔릭I/밑줄U/수정선S, 색상, 크기) |

---

## 🎓 연습 포인트

### WebRTC 이해

- MediaStream, RTCPeerConnection, ICE의 역할
- Signaling 서버의 필요성과 구현 방법
- STUN/TURN 서버의 동작 원리

### 1:1 → 1:N 확장

- PeerConnection 여러 개 관리 전략
- 참가자 입장/퇴장 시 동적 연결/정리
- 스트림 배열 관리

### 실시간 협업

- 구현 및 구조에 대한 아이디어 취합 
- Socket.IO를 활용한 이벤트 브로드캐스트
- contentEditable 기반 리치 텍스트 동기화

---

## 🐛 디버깅 팁

### 브라우저 개발자 도구 활용

- **Console 탭**: offer/answer, ice-candidate, draw, note-update 이벤트 로그 확인
- **Network 탭**: Socket.IO 연결 상태 모니터링
- **WebRTC Internals** (`chrome://webrtc-internals`): ICE 후보, 연결 상태 상세 확인

### 일반적인 문제 해결

| 문제 | 원인 | 해결 방법 |
|------|------|----------|
| 영상이 안 보임 | 카메라 권한 미허용 | 브라우저 설정에서 카메라/마이크 권한 허용 |
| 연결이 안 됨 | STUN 서버 오류 | `pcConfig`의 STUN 서버 주소 확인 |
| 화면 공유 안 됨 | HTTPS 필요 | 로컬 테스트는 localhost 사용, 외부는 HTTPS 설정 |
| 채팅이 안 보임 | Socket.IO 연결 실패 | `REACT_APP_SOCKET_URL` 환경 변수 확인 |

---

**📌 주요 키워드**: WebRTC, React, Node.js, Socket.IO, 1:N 화상회의, 실시간 통신, P2P, Signaling Server, STUN/TURN
