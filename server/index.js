// server/index.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 5000;
// 리액트 개발 서버는 3000이지만, 아래에서 origin:"*" 로 풀어서 상관 없음
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

// HTTP CORS (REST 요청용)
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

// WebSocket CORS (Socket.IO용)
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,      // "*” 대신
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("새 클라이언트 접속:", socket.id);

  // 방 입장
  socket.on("join-room", ({ roomId, username }) => {
    socket.data.username = username;
    socket.join(roomId);

    console.log(`socket ${socket.id} join room ${roomId} (${username})`);

    // ============= 방 참가자 전체 목록 만들기 =============
    const room = io.sockets.adapter.rooms.get(roomId) || new Set();
    const users = [...room].map((id) => {
      const s = io.sockets.sockets.get(id);
      return {
        socketId: id,
        username: s && s.data.username ? s.data.username : "unknown",
      };
    });

    // 방 안의 "모든 사람"에게 동일한 users 목록 브로드캐스트
    io.to(roomId).emit("room-users", {
      users,
    });

    // 회색/이탤릭 입장 시스템 메시지
    io.to(roomId).emit("chat-message", {
      user: username,
      message: `${username} 입장했습니다.`,
      color: "#666666",
      time: new Date().toISOString(),
      isSystem: true,
    });
  });

  // ============= WebRTC 시그널링 =============
  socket.on("webrtc-offer", ({ roomId, sdp, to }) => {
    io.to(to).emit("webrtc-offer", {
      from: socket.id,
      sdp,
    });
  });

  socket.on("webrtc-answer", ({ roomId, sdp, to }) => {
    io.to(to).emit("webrtc-answer", {
      from: socket.id,
      sdp,
    });
  });

  socket.on("webrtc-ice-candidate", ({ roomId, candidate, to }) => {
    io.to(to).emit("webrtc-ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  // ============= 텍스트 채팅 =============
  socket.on("chat-message", ({ roomId, message, user, color }) => {
    io.to(roomId).emit("chat-message", {
      message,
      user,
      color,
      time: new Date().toISOString(),
      isSystem: false,
    });
  });

  // ============= 화면 공유 =============
  socket.on("screen-share-start", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-start", { socketId: socket.id });
  });

  socket.on("screen-share-stop", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-stop", { socketId: socket.id });
  });

  // ============= 화이트보드 =============
  socket.on("draw", ({ roomId, stroke }) => {
    socket.to(roomId).emit("draw", { stroke, socketId: socket.id });
  });

  // ============= 메모 공유 =============
  socket.on("note-update", ({ roomId, text }) => {
    socket.to(roomId).emit("note-update", { text });
  });

  // ============= 현재 말하는 사람 =============
  socket.on("speaking", ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit("speaking", {
      socketId: socket.id,
      isSpeaking,
    });
  });

  // ============= 보드 필기 중인 사람 =============
  socket.on("board-active", ({ roomId, isActive }) => {
    socket.to(roomId).emit("board-active", {
      socketId: socket.id,
      isActive,
    });
  });

  // 끊기 직전에 퇴장 시스템 메시지
  // 끊기 직전에 퇴장 시스템 메시지 + room-users 갱신
  socket.on("disconnecting", () => {
    const username = socket.data.username || "알 수 없음";
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);

    rooms.forEach((roomId) => {
      // 1) 퇴장 시스템 메시지
      io.to(roomId).emit("chat-message", {
        user: username,
        message: `${username} 퇴장했습니다.`,
        color: "#666666",
        time: new Date().toISOString(),
        isSystem: true,
      });

      // 2) 최신 사용자 목록 다시 계산해서 room-users 브로드캐스트
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

});

server.listen(PORT, () => {
  console.log(`Signal & collab server listening on http://localhost:${PORT}`);
});
