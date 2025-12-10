// server/index.js
require("dotenv").config(); 
// .env 파일의 환경변수(포트, CORS 허용 도메인 등)를 process.env에 로드

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 5000;

// 브라우저(React)에서 접속할 수 있는 출처(origin)를 환경변수로 관리
// 실제 배포 시: http://내서버IP:포트  형태로 설정 가능
// 개발 중에는 "*" 로 풀어서 CORS를 신경쓰지 않도록 구성
// const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

// -----------------------------
//  HTTP CORS 설정 (REST API 용)
// -----------------------------
app.use(
  cors({
    origin: CLIENT_ORIGIN,          // 어느 출처에서 오는 요청을 허용할지
    methods: ["GET", "POST"],       // 허용할 HTTP 메서드
  })
);

const server = http.createServer(app);

// -----------------------------------
//  WebSocket CORS 설정 (Socket.IO 용)
//  - 실시간 이벤트(webrtc-offer 등) 통신에 사용
// -----------------------------------
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,          // 웹소켓도 동일 출처만 허용
    methods: ["GET", "POST"],
  },
});

// -----------------------------------
//  Socket.IO 메인 연결 이벤트
//  - 브라우저 1개 = 소켓 1개
// -----------------------------------
io.on("connection", (socket) => {
  console.log("새 클라이언트 접속:", socket.id);

  // ================================
  //  방 입장(join-room)
  //  - username 저장
  //  - roomId 기준으로 socket을 그룹에 묶기
  //  - 모든 사람에게 현재 방 참가자 목록 브로드캐스트
  //  - 시스템 입장 메시지 전송
  // ================================
  socket.on("join-room", ({ roomId, username }) => {
    // 소켓 객체에 사용자 이름을 저장 (나중에 퇴장 처리할 때 사용)
    socket.data.username = username;
    // Socket.IO의 "room" 개념: 같은 roomId로 묶이면 브로드캐스트하기 쉬움
    socket.join(roomId);

    console.log(`socket ${socket.id} join room ${roomId} (${username})`);

    // --- 현재 room 안에 있는 모든 소켓ID를 가져와서 users 배열 생성 ---
    const room = io.sockets.adapter.rooms.get(roomId) || new Set();
    const users = [...room].map((id) => {
      const s = io.sockets.sockets.get(id);
      return {
        socketId: id,
        username: s && s.data.username ? s.data.username : "unknown",
      };
    });

    // 이 방(roomId)에 있는 모든 클라이언트에게 동일한 참가자 목록 전달
    io.to(roomId).emit("room-users", {
      users,
    });

    // 채팅창 상단에 회색/이탤릭 "○○ 입장했습니다." 시스템 메시지 전송
    io.to(roomId).emit("chat-message", {
      user: username,
      message: `${username} 입장했습니다.`,
      color: "#666666",
      time: new Date().toISOString(),
      isSystem: true,
    });
  });

  // ================================
  //  WebRTC 시그널링 (Offer/Answer/ICE)
  //  - 실제 미디어 전송은 브라우저끼리 P2P
  //  - 서버는 "중간 전달(택배 기사)" 역할만 수행
  // ================================
  socket.on("webrtc-offer", ({ roomId, sdp, to }) => {
    // to(상대 소켓ID) 에게 offer를 전달
    io.to(to).emit("webrtc-offer", {
      from: socket.id,
      sdp,
    });
  });

  socket.on("webrtc-answer", ({ roomId, sdp, to }) => {
    // offer를 보냈던 사람에게 answer 전달
    io.to(to).emit("webrtc-answer", {
      from: socket.id,
      sdp,
    });
  });

  socket.on("webrtc-ice-candidate", ({ roomId, candidate, to }) => {
    // 양쪽 브라우저의 ICE 후보(네트워크 경로 정보)를 교환
    io.to(to).emit("webrtc-ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  // ================================
  //  텍스트 채팅
  //  - 특정 방(roomId) 안의 모든 사람에게 브로드캐스트
  // ================================
  socket.on("chat-message", ({ roomId, message, user, color }) => {
    io.to(roomId).emit("chat-message", {
      message,
      user,
      color,
      time: new Date().toISOString(),
      isSystem: false, // 시스템이 아닌 일반 채팅
    });
  });

  // ================================
  //  화면 공유 시작/종료 이벤트
  //  - 화면 자체는 WebRTC로 보내고
  //  - "누가 공유 시작/종료했는지" 알림만 소켓으로 전파
  // ================================
  socket.on("screen-share-start", ({ roomId }) => {
    // 나를 제외한 방 참가자에게만 알리기 때문에 socket.to 사용
    socket.to(roomId).emit("screen-share-start", { socketId: socket.id });
  });

  socket.on("screen-share-stop", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-stop", { socketId: socket.id });
  });

  // ================================
  //  화이트보드 필기 이벤트
  //  - stroke(선 정보: 좌표, 색, 굵기 등)를 다른 사람에게 전달
  // ================================
  socket.on("draw", ({ roomId, stroke }) => {
    socket.to(roomId).emit("draw", { stroke, socketId: socket.id });
  });

  // ================================
  //  공유 메모 (Rich Text) 동기화
  //  - 메모 HTML 전체(text)를 그대로 다른 사람에게 브로드캐스트
  // ================================
  socket.on("note-update", ({ roomId, text }) => {
    socket.to(roomId).emit("note-update", { text });
  });

  // ================================
  //  현재 "말하는 사람" 표시
  //  - 클라이언트에서 음성 감지 → speaking 이벤트 발행
  //  - 나를 제외한 다른 참가자들에게 isSpeaking 상태 전달
  // ================================
  socket.on("speaking", ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit("speaking", {
      socketId: socket.id,
      isSpeaking,
    });
  });

  // ================================
  //  보드 필기 중인 사람 표시
  //  - 누가 보드 ON 상태인지 하이라이트용
  // ================================
  socket.on("board-active", ({ roomId, isActive }) => {
    socket.to(roomId).emit("board-active", {
      socketId: socket.id,
      isActive,
    });
  });

  // ================================
  //  브라우저 창 닫기 직전(disconnecting)
  //  - 퇴장 시스템 메시지
  //  - 남은 인원 기준으로 room-users 목록 재계산
  // ================================
  socket.on("disconnecting", () => {
    const username = socket.data.username || "알 수 없음";

    // socket.rooms: 이 소켓이 속한 room 목록 (자기 자신의 ID도 포함)
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);

    rooms.forEach((roomId) => {
      // 1) 퇴장 시스템 메시지
      io.to(roomId).emit("chat-message", {
        user: username,
        message: `${username} 나갔습니다.`,
        color: "#666666",
        time: new Date().toISOString(),
        isSystem: true,
      });

      // 2) 현재 room 참가자 목록에서 "끊기는 소켓"을 제외
      const room = io.sockets.adapter.rooms.get(roomId) || new Set();
      const remainingIds = [...room].filter((id) => id !== socket.id);

      const users = remainingIds.map((id) => {
        const s = io.sockets.sockets.get(id);
        return {
          socketId: id,
          username: s && s.data.username ? s.data.username : "unknown",
        };
      });

      // 3) 최신 참가자 목록(room-users) 전파
      io.to(roomId).emit("room-users", { users });
    });
  });

  // ================================
  //  사용자가 "나가기" 버튼을 직접 눌렀을 때
  //  - disconnecting 과 유사하지만,
  //    이 경우에는 socket은 완전히 끊기지 않고 room만 나감
  // ================================
  socket.on("leave-room", ({ roomId }) => {
    const username = socket.data.username || "알 수 없음";

    console.log(`socket ${socket.id} leave room ${roomId} (${username})`);

    // 0) 해당 room에서만 제거
    socket.leave(roomId);

    // 1) 퇴장 시스템 메시지
    io.to(roomId).emit("chat-message", {
      user: username,
      message: `${username} 나갔습니다.`,
      color: "#666666",
      time: new Date().toISOString(),
      isSystem: true,
    });

    // 2) 남아 있는 사람 기준으로 room-users 재계산
    const room = io.sockets.adapter.rooms.get(roomId) || new Set();
    const users = [...room].map((id) => {
      const s = io.sockets.sockets.get(id);
      return {
        socketId: id,
        username: s && s.data.username ? s.data.username : "unknown",
      };
    });

    io.to(roomId).emit("room-users", { users });
  });
});

// -----------------------------
//  HTTP + WebSocket 서버 시작
// -----------------------------
server.listen(PORT, () => {
  console.log(`Signal & collab server listening on http://localhost:${PORT}`);
});
