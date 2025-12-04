import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

//const SOCKET_URL = "http://localhost:5000";
const SOCKET_URL = "http://192.168.162.56:5000";

const pcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function App() {
  // 공통 상태
  const [roomId, setRoomId] = useState("room-1");
  const [username, setUsername] = useState(
    "user-" + Math.floor(Math.random() * 1000)
  );
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // 🔊 음소거 상태

  const socketRef = useRef(null);
  const pcRef = useRef(null);

  // 로컬 / 원격 스트림
  const localStreamRef = useRef(null); // 카메라+마이크
  const remoteCamStreamRef = useRef(null); // 상대 카메라 스트림

  // 화면 공유 관련
  const screenStreamRef = useRef(null); // 내가 공유 중인 화면 스트림
  const screenSenderRef = useRef(null); // PeerConnection에 추가된 화면 트랙 sender

  // 비디오 DOM
  const localVideoRef = useRef(null); // 상단 "내 화면"
  const remoteVideoRef = useRef(null); // 상단 "상대 화면"
  const screenVideoRef = useRef(null); // 아래 "화면 공유" 큰 화면

  // 채팅
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatColor, setChatColor] = useState("#000000");

  // 화이트보드
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [penColor, setPenColor] = useState("#ff0000");
  const [penWidth, setPenWidth] = useState(2);
  const [isBoardDrawMode, setIsBoardDrawMode] = useState(false);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [eraserSize, setEraserSize] = useState(16);

  // 메모
  const [note, setNote] = useState("");

  // 1) Socket.IO 연결
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on("room-created", (rid) => console.log("방 생성:", rid));
    socket.on("room-joined", (rid) => console.log("방 참가 완료:", rid));
    socket.on("peer-joined", (peerId) => console.log("상대 입장:", peerId));
    socket.on("room-full", () => alert("이 방은 1:1만 허용합니다."));

    // 시그널링
    socket.on("webrtc-offer", async ({ sdp }) => {
      console.log("Offer 수신");
      await ensureLocalStream();
      if (!pcRef.current) {
        createPeerConnection();
      }
      await pcRef.current.setRemoteDescription(sdp);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit("webrtc-answer", { roomId, sdp: answer });
    });

    socket.on("webrtc-answer", async ({ sdp }) => {
      console.log("Answer 수신");
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(sdp);
    });

    socket.on("webrtc-ice-candidate", async ({ candidate }) => {
      try {
        if (!pcRef.current) return;
        await pcRef.current.addIceCandidate(candidate);
      } catch (err) {
        console.error("ICE 추가 에러:", err);
      }
    });

    // 채팅 (색상 포함)
    socket.on("chat-message", ({ message, user, time, color }) => {
      setMessages((prev) => [...prev, { message, user, time, color }]);
    });

    // 화이트보드
    socket.on("draw", ({ stroke }) => {
      drawStroke(stroke);
    });

    // 메모
    socket.on("note-update", ({ text }) => {
      setNote(text);
    });

    // 화면 공유 알림
    socket.on("screen-share-start", () => {
      console.log("remote screen-share-start");
    });

    socket.on("screen-share-stop", () => {
      console.log("remote screen-share-stop");
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line
  }, []);

  // 2) 방 입장
  const handleJoinRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("join-room", roomId);
    setIsJoined(true);
  };

  // 3) 로컬 카메라+마이크 스트림 확보
  const ensureLocalStream = async () => {
    if (localStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log("로컬 스트림 획득");
    } catch (err) {
      console.error("getUserMedia 실패:", err);
      alert("카메라/마이크 접근 실패");
    }
  };

  // 4) PeerConnection 생성
  const createPeerConnection = () => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection(pcConfig);
    pcRef.current = pc;

    // 카메라/마이크 트랙 추가
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", {
          roomId,
          candidate: event.candidate,
        });
      }
    };

    // 원격 스트림 처리 (1번째 비디오 = 카메라, 2번째 이후 비디오 = 화면 공유)
    pc.ontrack = (event) => {
      const [stream] = event.streams;

      if (event.track.kind === "video") {
        if (!remoteCamStreamRef.current) {
          console.log("원격 카메라 트랙 수신");
          remoteCamStreamRef.current = stream;
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
          }
        } else {
          console.log("원격 화면 공유 트랙 수신");
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = stream;
          }
        }
      } else if (event.track.kind === "audio") {
        console.log("원격 오디오 트랙 수신");
      }
    };
  };

  // 5) 발신자: 화상 시작
  const handleCallStart = async () => {
    if (!isJoined) {
      alert("먼저 방에 입장하세요.");
      return;
    }
    await ensureLocalStream();
    createPeerConnection();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    socketRef.current.emit("webrtc-offer", { roomId, sdp: offer });
  };

  // 🔊 5-1) 음소거 토글
  const toggleMute = () => {
    if (!localStreamRef.current) {
      alert("먼저 화상 시작을 눌러주세요.");
      return;
    }

    setIsMuted((prev) => {
      const next = !prev;
      localStreamRef.current
        .getAudioTracks()
        .forEach((track) => (track.enabled = !next)); // next가 true(음소거)면 track.enabled = false
      return next;
    });
  };

  // 6) 화면 공유 시작 (재협상 포함)
  const handleShareScreen = async () => {
    try {
      if (!pcRef.current) {
        alert("먼저 화상 시작을 눌러 PeerConnection을 만들어주세요.");
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const screenTrack = displayStream.getVideoTracks()[0];

      const sender = pcRef.current.addTrack(screenTrack, displayStream);

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = displayStream;
      }

      screenStreamRef.current = displayStream;
      screenSenderRef.current = sender;

      socketRef.current.emit("screen-share-start", { roomId });

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      socketRef.current.emit("webrtc-offer", { roomId, sdp: offer });

      screenTrack.onended = () => {
        handleStopShare();
      };
    } catch (err) {
      console.error("화면 공유 실패:", err);
    }
  };

  // 7) 화면 공유 종료
  const handleStopShare = () => {
    try {
      if (pcRef.current && screenSenderRef.current) {
        pcRef.current.removeTrack(screenSenderRef.current);
        screenSenderRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }

      if (socketRef.current) {
        socketRef.current.emit("screen-share-stop", { roomId });
      }
    } catch (err) {
      console.error("화면 공유 종료 오류:", err);
    }
  };

  // 8) 통화 종료 + 완전 나가기
  const handleHangup = () => {
    handleStopShare();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.getSenders().forEach((s) => {
        if (s.track) s.track.stop();
      });
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;

    remoteCamStreamRef.current = null;

    setIsJoined(false);
    setIsMuted(false);
  };

  // 9) 채팅 전송
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    if (!socketRef.current) return;

    const payload = {
      roomId,
      message: chatInput,
      user: username,
      color: chatColor,
    };
    socketRef.current.emit("chat-message", payload);
    setChatInput("");
  };

  // 10) 화이트보드 드로잉
  const handleCanvasMouseDown = (e) => {
    if (!isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;
    drawing.current = { x: offsetX, y: offsetY };
  };

  const handleCanvasMouseMove = (e) => {
    if (!drawing.current || !isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;
    const x0 = drawing.current.x;
    const y0 = drawing.current.y;
    const x1 = offsetX;
    const y1 = offsetY;

    const stroke = isEraserMode
      ? {
          x0,
          y0,
          x1,
          y1,
          mode: "erase",
          size: eraserSize,
        }
      : {
          x0,
          y0,
          x1,
          y1,
          mode: "draw",
          color: penColor,
          width: penWidth,
        };

    drawStroke(stroke);
    if (socketRef.current) {
      socketRef.current.emit("draw", { roomId, stroke });
    }
    drawing.current = { x: x1, y: y1 };
  };

  const handleCanvasMouseUp = () => {
    drawing.current = false;
  };

  const drawStroke = (stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.save();

    if (stroke.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = stroke.size || 16;
      ctx.lineCap = "round";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color || "#ff0000";
      ctx.lineWidth = stroke.width || 2;
      ctx.lineCap = "round";
    }

    ctx.beginPath();
    ctx.moveTo(stroke.x0, stroke.y0);
    ctx.lineTo(stroke.x1, stroke.y1);
    ctx.stroke();
    ctx.closePath();

    ctx.restore();
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // 11) 메모 공유
  const handleNoteChange = (text) => {
    setNote(text);
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text });
    }
  };

  // 12) 보드 필기 / 지우개 토글
  const toggleBoardDrawMode = () => setIsBoardDrawMode((prev) => !prev);
  const toggleEraserMode = () => setIsEraserMode((prev) => !prev);

  // 캔버스 커서
  const canvasClassName = [
    "screen-canvas",
    isBoardDrawMode && !isEraserMode ? "pen-cursor" : "",
    isBoardDrawMode && isEraserMode ? "eraser-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 렌더링
  return (
    <div className="app-root">
      {/* 상단 바 */}
      <div className="top-bar">
        <span className="top-bar-title">WebRTC 화상 + 화면 공유</span>

        <label>
          방 ID:
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
        </label>

        <label>
          이름:
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <button onClick={handleJoinRoom}>
          {isJoined ? "참가중" : "방입장"}
        </button>

        <button onClick={handleCallStart}>화상 시작</button>

        {/* 🔊 마이크 아이콘 버튼 */}
        <button
          className={`mic-btn ${isMuted ? "muted" : ""}`}
          onClick={toggleMute}
          title={isMuted ? "음소거 해제" : "음소거"}
        >
          <span className="mic-icon" />
        </button>

        <button onClick={handleShareScreen}>화면 공유</button>
        <button onClick={handleStopShare}>공유 종료</button>

        {/* 🔴 나가기 (빨간색) */}
        <button className="leave-btn" onClick={handleHangup}>
          나가기
        </button>
      </div>

      {/* 메인 레이아웃 */}
      <div className="main-layout">
        {/* 왼쪽: 영상 + 보드 */}
        <div className="left-side">
          <div className="video-strip">
            <div className="video-panel">
              <video ref={localVideoRef} autoPlay playsInline muted />
              <span className="video-label">내 화면</span>
            </div>
            <div className="video-panel">
              <video ref={remoteVideoRef} autoPlay playsInline />
              <span className="video-label">상대 화면</span>
            </div>
          </div>

          <div className="board-wrapper">
            <div className="board-header">
              ✍️ 화면 공유 창에서 그림/메모를 입력하면 실시간으로 공유됩니다.📝
              [전체지우기] 버튼은 본인의 화면에서만 동작합니다.
            </div>

            <div className="board-body">
              <div className="screen-share-container">
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  className="screen-video"
                />
                <canvas
                  ref={canvasRef}
                  width={848}
                  height={480}
                  className={canvasClassName}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                />
              </div>
            </div>

            <div className="board-controls">
              <button
                className={isBoardDrawMode ? "toggle-on" : ""}
                onClick={toggleBoardDrawMode}
              >
                보드 필기 {isBoardDrawMode ? "ON" : "OFF"}
              </button>

              <button
                className={isEraserMode ? "toggle-on" : ""}
                onClick={toggleEraserMode}
              >
                지우개 {isEraserMode ? "ON" : "OFF"}
              </button>

              <span style={{ fontSize: "0.8rem" }}>지우개 크기:</span>
              <input
                type="range"
                min="4"
                max="40"
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
              />
              <div
                className="eraser-preview"
                style={{ width: eraserSize, height: eraserSize }}
              />

              <span style={{ marginLeft: "12px", fontSize: "0.8rem" }}>
                펜 색상:
              </span>
              <input
                type="color"
                value={penColor}
                onChange={(e) => setPenColor(e.target.value)}
              />

              <span style={{ marginLeft: "12px", fontSize: "0.8rem" }}>
                펜 굵기:
              </span>
              <input
                type="range"
                min="1"
                max="15"
                value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value))}
              />

              <button onClick={handleClearCanvas}>전체 지우기</button>
            </div>
          </div>
        </div>

        {/* 오른쪽: 채팅 + 공유 메모 */}
        <div className="right-side">
          <div className="chat-panel">
            <div className="chat-title">채팅 화면 창</div>

            <div className="chat-window">
              {messages.map((m, i) => (
                <div key={i} className="chat-message">
                  <strong style={{ color: "#333" }}>{m.user}</strong>
                  <span style={{ color: m.color || "#000" }}> {m.message}</span>
                </div>
              ))}
            </div>

            <div className="chat-color-row">
              <input
                type="color"
                value={chatColor}
                onChange={(e) => setChatColor(e.target.value)}
                className="chat-color-picker"
              />
            </div>

            <div className="chat-input-row">
              <textarea
                className="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  (e.preventDefault(), handleSendMessage())
                }
                placeholder="채팅 내용을 입력하세요 (Shift+Enter 줄바꿈)"
              />

              <div className="chat-buttons">
                <input
                  type="color"
                  value={chatColor}
                  onChange={(e) => setChatColor(e.target.value)}
                  className="chat-color-picker"
                />
                <button className="chat-send-btn" onClick={handleSendMessage}>
                  전송
                </button>
              </div>
            </div>
          </div>

          <div className="notes-panel">
            <div className="notes-title">공유 메모</div>
            <textarea
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
