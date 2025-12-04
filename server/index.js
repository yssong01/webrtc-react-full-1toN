// server/index.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("새 클라이언트 접속:", socket.id);

  // 1) 방 입장
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`socket ${socket.id} join room ${roomId}`);

    const room = io.sockets.adapter.rooms.get(roomId) || new Set();
    const userCount = room.size;

    if (userCount === 1) {
      socket.emit("room-created", roomId);
    } else if (userCount === 2) {
      socket.to(roomId).emit("peer-joined", socket.id);
      socket.emit("room-joined", roomId);
    } else {
      socket.emit("room-full");
    }
  });

  // 1-1) 방 나가기
  socket.on("leave-room", ({ roomId }) => {
    console.log(`socket ${socket.id} leave room ${roomId}`);
    socket.leave(roomId);
  });

  // 2) WebRTC 시그널링
  socket.on("webrtc-offer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc-offer", { sdp, from: socket.id });
  });

  socket.on("webrtc-answer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc-answer", { sdp, from: socket.id });
  });

  socket.on("webrtc-ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc-ice-candidate", {
      candidate,
      from: socket.id,
    });
  });

  // 3) 텍스트 채팅
  socket.on("chat-message", ({ roomId, message, user, color }) => {
    io.to(roomId).emit("chat-message", {
      message,
      user,
      color,
      time: new Date().toISOString(),
    });
  });

  // 화면 공유 시작/종료 알림
  socket.on("screen-share-start", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-start");
  });

  socket.on("screen-share-stop", ({ roomId }) => {
    socket.to(roomId).emit("screen-share-stop");
  });

  // 4) 화이트보드
  socket.on("draw", ({ roomId, stroke }) => {
    socket.to(roomId).emit("draw", { stroke });
  });

  // 5) 메모 공유
  socket.on("note-update", ({ roomId, text }) => {
    socket.to(roomId).emit("note-update", { text });
  });

  socket.on("disconnect", () => {
    console.log("클라이언트 연결 종료:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Signal & collab server listening on http://localhost:${PORT}`);
});
