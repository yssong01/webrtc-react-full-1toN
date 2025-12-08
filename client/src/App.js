// src/App.js
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// const SOCKET_URL = "http://localhost:5000";
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;

const pcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function App() {
  // ─────────────────────────────────────
  // 공통 상태
  // ─────────────────────────────────────
  const [roomId, setRoomId] = useState("room-1");
  const [username, setUsername] = useState(
    "user-" + Math.floor(Math.random() * 1000)
  );
  const [isJoined, setIsJoined] = useState(false);

  // 내 마이크 on/off + 소켓ID
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false); // 현재 음소거 상태
  const [mySocketId, setMySocketId] = useState(null);

  // 전체 스피커 상태
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(1); // 0~1

  // 마이크 볼륨 & 레벨
  const [micVolume, setMicVolume] = useState(1); // 0~2 정도
  const [micLevel, setMicLevel] = useState(0); // 0~1 (레벨바)

  // Socket, PeerConnection, 스트림 관리
  const socketRef = useRef(null);

  // 원본 로컬 스트림 (가공 전)
  const rawLocalStreamRef = useRef(null);

  // 마이크 게인 처리 후 로컬 스트림
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenSenderRef = useRef({}); // { peerId: RTCRtpSender }

  // 마이크 볼륨 조절용 Web Audio
  const audioCtxRef = useRef(null);
  const micGainNodeRef = useRef(null);

  // 1:N 피어 관리용  { [socketId]: { pc, username, hasCam } }
  const peersRef = useRef({});

  // 원격 비디오 DOM (전역 스피커 볼륨 적용용)
  const remoteVideoRefs = useRef({}); // { socketId: HTMLVideoElement }

  // 원격 화면 상태
  const [remoteStreams, setRemoteStreams] = useState([]); // [{id, username, stream}]
  const [speakerId, setSpeakerId] = useState(null);
  const [boardUserId, setBoardUserId] = useState(null);

  // DOM refs
  const localVideoRef = useRef(null);
  const screenVideoRef = useRef(null);

  // 채팅
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatColor, setChatColor] = useState("#000000");
  const [chatFontSize, setChatFontSize] = useState(14); // 채팅 글자 크기(px)

  // 보드
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [penColor, setPenColor] = useState("#ff0000");
  const [penWidth, setPenWidth] = useState(2);
  const [isBoardDrawMode, setIsBoardDrawMode] = useState(false);
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [isEraserDrag, setIsEraserDrag] = useState(false); // 추가
  const [eraserSize, setEraserSize] = useState(16);
  const dragPreviewImageRef = useRef(null); // 드래그 미리보기용

  // // 공유 메모 (리치 텍스트 HTML)
  const noteEditorRef = useRef(null);

  // 메모 서식(B/I/U/S) 활성 상태
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });

  const [noteFontSize, setNoteFontSize] = useState(14); // 기본 14px

  // ─────────────────────────────────────
  // Socket.IO 연결 및 이벤트
  // ─────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[client] socket connected:", socket.id);
      setMySocketId(socket.id);
    });

    // 서버에서 보내주는 방 참가자 전체 목록
    socket.on("room-users", async ({ users }) => {
      console.log("[client] room-users:", users);
      const myId = socket.id;
      setMySocketId(myId);

      const currentIds = users.map((u) => u.socketId);
      const others = users.filter((u) => u.socketId !== myId);

      // 1) 방에서 사라진 유저 정리 (PC close + remoteStreams 제거)
      Object.keys(peersRef.current).forEach((peerId) => {
        if (!currentIds.includes(peerId)) {
          const info = peersRef.current[peerId];

          if (info?.pc) {
            // 기존: 내 로컬 카메라/마이크 트랙까지 stop 해서 모두 까매짐
            // info.pc.getSenders().forEach((s) => s.track && s.track.stop());

            // 수정: 연결만 닫고, 트랙은 그대로 유지
            info.pc.close();
          }

          delete peersRef.current[peerId];
          delete remoteVideoRefs.current[peerId];

          // 말하던 사람/보드 필기자라면 상태도 초기화
          setSpeakerId((prev) => (prev === peerId ? null : prev));
          setBoardUserId((prev) => (prev === peerId ? null : prev));
        }
      });

      // 2) remoteStreams 목록에서도 나간 유저 제거
      setRemoteStreams((prev) => prev.filter((p) => currentIds.includes(p.id)));

      // 3) 새로 들어온 유저에 대해서만 PeerConnection 생성
      others.forEach((u) => {
        const peerId = u.socketId;
        const peerName = u.username;

        if (peersRef.current[peerId]?.pc) return;

        const isCaller = myId < peerId;
        createPeerConnection(peerId, peerName, isCaller);
      });
    });

    // ── WebRTC 시그널링 ──
    socket.on("webrtc-offer", async ({ from, sdp }) => {
      console.log("[client] webrtc-offer from", from);

      // await ensureLocalStream();
      const pc = createPeerConnection(
        from,
        peersRef.current[from]?.username,
        false
      );
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc-answer", { roomId, sdp: answer, to: from });
    });

    socket.on("webrtc-answer", async ({ from, sdp }) => {
      console.log("[client] webrtc-answer from", from);
      const pc = peersRef.current[from]?.pc;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socket.on("webrtc-ice-candidate", async ({ from, candidate }) => {
      const pc = peersRef.current[from]?.pc;
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("ICE 추가 에러:", err);
      }
    });

    // ── 채팅 (일반 + 시스템) ──
    socket.on("chat-message", (payload) => {
      console.log("[client] chat-message:", payload);
      setMessages((prev) => [...prev, payload]);
    });

    // 화이트보드 / 메모 / 화면공유
    socket.on("draw", ({ stroke }) => {
      drawStroke(stroke);
    });

    socket.on("note-update", ({ text }) => {
      const html = text || "";
      if (noteEditorRef.current && noteEditorRef.current.innerHTML !== html) {
        noteEditorRef.current.innerHTML = html;
      }
    });

    socket.on("screen-share-start", ({ socketId }) => {
      console.log("remote screen-share-start from", socketId);
    });

    socket.on("screen-share-stop", ({ socketId }) => {
      console.log("remote screen-share-stop from", socketId);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
    });

    socket.on("speaking", ({ socketId, isSpeaking }) => {
      setSpeakerId((prev) => {
        if (!isSpeaking && prev === socketId) return null;
        if (isSpeaking) return socketId;
        return prev;
      });
    });

    socket.on("board-active", ({ socketId, isActive }) => {
      setBoardUserId((prev) => {
        if (!isActive && prev === socketId) return null;
        if (isActive) return socketId;
        return prev;
      });
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line
  }, []);

  // ─────────────────────────────────────
  // 공유 메모 선택 변화 → B/I/U/S 버튼 상태 반영
  // ─────────────────────────────────────
  useEffect(() => {
    const onSelectionChange = () => {
      if (!noteEditorRef.current) return;
      // 메모 창이 포커스일 때만 상태 갱신
      if (document.activeElement !== noteEditorRef.current) return;
      refreshActiveFormats(); // 앞에서 만든 함수
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []); // <-- 이것이 두 번째 useEffect

  // ─────────────────────────────────────
  // 방 입장
  // ─────────────────────────────────────
  const handleJoinRoom = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("join-room", { roomId, username });
    setIsJoined(true);
  };

  // ─────────────────────────────────────
  // 로컬 카메라/마이크 (마이크 게인 포함)
  // ─────────────────────────────────────
  const ensureLocalStream = async () => {
    if (localStreamRef.current) return;

    try {
      // 1) 카메라 + 마이크 원본 스트림
      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      rawLocalStreamRef.current = rawStream;

      // 2) Web Audio로 마이크 볼륨 조절용 그래프 구성
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(rawStream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = micVolume; // 초기값
      micGainNodeRef.current = gainNode;

      const dest = audioCtx.createMediaStreamDestination();

      source.connect(gainNode);
      gainNode.connect(dest);

      // 3) 최종 송출용 스트림: 비디오(원본) + 오디오(게인 적용)
      const processedStream = new MediaStream();
      rawStream.getVideoTracks().forEach((track) => {
        processedStream.addTrack(track);
      });
      dest.stream.getAudioTracks().forEach((track) => {
        processedStream.addTrack(track);
      });

      localStreamRef.current = processedStream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = processedStream;
      }

      console.log("로컬 스트림(마이크 게인 포함) 획득");
      startVoiceDetection(); // 말하기 감지
    } catch (err) {
      console.error("getUserMedia 실패:", err);
      alert("카메라/마이크 접근 실패");
    }
  };

  // ─────────────────────────────────────
  // PeerConnection 생성
  // ─────────────────────────────────────
  const createPeerConnection = (peerId, peerName, isCaller) => {
    if (peersRef.current[peerId]?.pc) {
      return peersRef.current[peerId].pc;
    }

    const pc = new RTCPeerConnection(pcConfig);

    peersRef.current[peerId] = {
      ...(peersRef.current[peerId] || {}),
      pc,
      username: peerName || peersRef.current[peerId]?.username || "user",
      hasCam: false,
    };

    // 내 트랙 추가
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
          to: peerId,
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const peerInfo = peersRef.current[peerId];

      if (event.track.kind === "video") {
        if (!peerInfo.hasCam) {
          peersRef.current[peerId].hasCam = true;
          setRemoteStreams((prev) => {
            const exist = prev.find((p) => p.id === peerId);
            if (exist) {
              return prev.map((p) => (p.id === peerId ? { ...p, stream } : p));
            }
            return [
              ...prev,
              {
                id: peerId,
                username: peerInfo.username,
                stream,
              },
            ];
          });
        } else {
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = stream;
          }
        }
      } else if (event.track.kind === "audio") {
        console.log("원격 오디오 트랙 수신 from", peerId);
      }
    };

    // 내가 Caller 인 경우에만 Offer 생성
    if (isCaller && socketRef.current) {
      pc.createOffer()
        .then((offer) => {
          pc.setLocalDescription(offer);
          socketRef.current.emit("webrtc-offer", {
            roomId,
            sdp: offer,
            to: peerId,
          });
        })
        .catch(console.error);
    }

    return pc;
  };

  // 화상 시작 버튼
  const handleCallStart = async () => {
    if (!isJoined) {
      alert("먼저 방에 입장하세요.");
      return;
    }
    await ensureLocalStream();

    // 이미 존재하는 모든 PeerConnection에 내 트랙을 붙이고, 재협상(Offer) 보내기
    if (localStreamRef.current && socketRef.current) {
      const entries = Object.entries(peersRef.current);
      for (const [peerId, info] of entries) {
        const pc = info.pc;
        if (!pc) continue;

        // 같은 kind 트랙을 중복으로 addTrack 하지 않도록 방어
        const existingKinds = pc
          .getSenders()
          .map((s) => (s.track ? s.track.kind : null));

        localStreamRef.current.getTracks().forEach((track) => {
          if (!existingKinds.includes(track.kind)) {
            pc.addTrack(track, localStreamRef.current);
          }
        });

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current.emit("webrtc-offer", {
            roomId,
            sdp: offer,
            to: peerId,
          });
        } catch (err) {
          console.error("재협상 offer 실패:", err);
        }
      }
    }
  };

  // 마이크 음소거 토글 (게인 + 트랙 + 모든 PeerConnection 오디오 완전 차단)
  const toggleMute = () => {
    if (
      !micGainNodeRef.current &&
      !localStreamRef.current &&
      !rawLocalStreamRef.current
    ) {
      alert("먼저 화상 시작을 눌러주세요.");
      return;
    }

    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;

      // 1) Web Audio 게인 제어
      if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.value = next ? 0 : micVolume;
      }

      // 2) 로컬 가공 스트림 오디오 트랙 on/off
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
          console.log(
            "[mute] localStream track",
            track.id,
            "enabled:",
            track.enabled
          );
        });
      }

      // 3) 원본 스트림 오디오 트랙도 방어적으로 off
      if (rawLocalStreamRef.current) {
        rawLocalStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
          console.log(
            "[mute] rawLocalStream track",
            track.id,
            "enabled:",
            track.enabled
          );
        });
      }

      // 4) 이미 만들어진 모든 PeerConnection 의 audio sender 도 off
      Object.values(peersRef.current).forEach(({ pc }) => {
        if (!pc) return;
        pc.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === "audio") {
            sender.track.enabled = !next;
            console.log(
              "[mute] sender track",
              sender.track.id,
              "enabled:",
              sender.track.enabled
            );
          }
        });
      });

      return next;
    });
  };

  // ─────────────────────────────────────
  // 화면 공유
  // ─────────────────────────────────────
  const handleShareScreen = async () => {
    try {
      if (!Object.keys(peersRef.current).length) {
        alert("다른 참가자가 있을 때 화면 공유를 시작하세요.");
        return;
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const screenTrack = displayStream.getVideoTracks()[0];

      screenStreamRef.current = displayStream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = displayStream;
      }

      for (const peerId of Object.keys(peersRef.current)) {
        const pc = peersRef.current[peerId].pc;
        const sender = pc.addTrack(screenTrack, displayStream);
        screenSenderRef.current[peerId] = sender;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit("webrtc-offer", {
          roomId,
          sdp: offer,
          to: peerId,
        });
      }

      socketRef.current.emit("screen-share-start", { roomId });

      screenTrack.onended = () => {
        handleStopShare();
      };
    } catch (err) {
      console.error("화면 공유 실패:", err);
    }
  };

  const handleStopShare = async () => {
    try {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }

      for (const peerId of Object.keys(screenSenderRef.current)) {
        const pc = peersRef.current[peerId]?.pc;
        const sender = screenSenderRef.current[peerId];
        if (pc && sender) {
          pc.removeTrack(sender);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current.emit("webrtc-offer", {
            roomId,
            sdp: offer,
            to: peerId,
          });
        }
      }
      screenSenderRef.current = {};

      socketRef.current.emit("screen-share-stop", { roomId });
    } catch (err) {
      console.error("화면 공유 종료 오류:", err);
    }
  };

  // ─────────────────────────────────────
  // 통화 종료 + 방 나가기
  // ─────────────────────────────────────
  const handleHangup = () => {
    // 0) 방에 참가 중이면 먼저 서버에 알림
    if (socketRef.current && isJoined) {
      socketRef.current.emit("leave-room", { roomId });
    }

    // 1) 화면 공유 정리
    handleStopShare();

    // 2) 로컬 스트림 정리
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    // 3) 모든 PeerConnection 정리
    Object.values(peersRef.current).forEach(({ pc }) => {
      if (!pc) return;
      pc.getSenders().forEach((s) => {
        if (s.track) s.track.stop();
      });
      pc.close();
    });
    peersRef.current = {};
    setRemoteStreams([]);

    // 4) 비디오 요소 정리
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;

    // 5) 상태 리셋
    setIsJoined(false);
    setIsMuted(false);
    isMutedRef.current = false;
    setSpeakerId(null);
    setBoardUserId(null);
  };

  // ─────────────────────────────────────
  // 채팅 전송
  // ─────────────────────────────────────
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

  // ─────────────────────────────────────
  // 화이트보드
  // ─────────────────────────────────────
  const handleCanvasMouseDown = (e) => {
    if (!isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;

    // 🔹 지우개 + 드래그 ON  → 영역 지우개 시작 (사각형)
    if (isEraserMode && isEraserDrag) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      // 현재 화면 저장 (미리보기용)
      dragPreviewImageRef.current = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

      drawing.current = {
        x0: offsetX,
        y0: offsetY,
        x1: offsetX,
        y1: offsetY,
        rect: true, // 영역 지우개 플래그
      };
      return;
    }

    // 🔹 그 외(펜 / 일반 지우개) → 선 따라 그리기/지우기
    drawing.current = { x: offsetX, y: offsetY };
  };

  const handleCanvasMouseMove = (e) => {
    if (!drawing.current || !isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;

    // 🔹 지우개 + 드래그 ON  → 사각형 미리보기만 그림
    if (isEraserMode && isEraserDrag && drawing.current.rect) {
      drawing.current = {
        ...drawing.current,
        x1: offsetX,
        y1: offsetY,
      };

      const canvas = canvasRef.current;
      if (!canvas || !dragPreviewImageRef.current) return;
      const ctx = canvas.getContext("2d");

      // 저장해둔 원본 화면으로 되돌린 뒤
      ctx.putImageData(dragPreviewImageRef.current, 0, 0);

      // 미리보기용 흰색 사각형 테두리 그리기
      const { x0, y0, x1, y1 } = drawing.current;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const width = Math.abs(x1 - x0);
      const height = Math.abs(y1 - y0);

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]); // 점선 느낌 (원하면 삭제)
      ctx.strokeRect(left, top, width, height);
      ctx.restore();

      return; // 여기서는 실제 지우기는 하지 않음
    }

    // 🔹 펜 / 일반 지우개 (선 지우기) -------------------------
    const x0 = drawing.current.x;
    const y0 = drawing.current.y;
    const x1 = offsetX;
    const y1 = offsetY;

    const stroke = isEraserMode
      ? { x0, y0, x1, y1, mode: "erase", size: eraserSize }
      : { x0, y0, x1, y1, mode: "draw", color: penColor, width: penWidth };

    drawStroke(stroke);
    if (socketRef.current) {
      socketRef.current.emit("draw", { roomId, stroke });
    }

    drawing.current = { x: x1, y: y1 };
  };

  const handleCanvasMouseUp = () => {
    if (!drawing.current) {
      drawing.current = false;
      return;
    }

    // 🔹 영역 지우개 모드일 때 (지우개 ON + 드래그 ON)
    if (isEraserMode && isEraserDrag && drawing.current.rect) {
      const { x0, y0, x1, y1 } = drawing.current;

      // 미리보기 전에 저장해둔 원본 이미지로 복원
      const canvas = canvasRef.current;
      if (canvas && dragPreviewImageRef.current) {
        const ctx = canvas.getContext("2d");
        ctx.putImageData(dragPreviewImageRef.current, 0, 0);
      }

      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const right = Math.max(x0, x1);
      const bottom = Math.max(y0, y1);

      const stroke = {
        mode: "erase-rect",
        x0: left,
        y0: top,
        x1: right,
        y1: bottom,
      };

      drawStroke(stroke);
      if (socketRef.current) {
        socketRef.current.emit("draw", { roomId, stroke });
      }

      // 미리보기 이미지 초기화
      dragPreviewImageRef.current = null;
    }

    drawing.current = false;
  };

  // ======== 여기부터 새로 추가 ==========
  const drawStroke = (stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.save();

    // 🔹 1) 영역 지우개 (사각형 전체 지우기)
    if (stroke.mode === "erase-rect") {
      ctx.globalCompositeOperation = "destination-out";
      const width = stroke.x1 - stroke.x0;
      const height = stroke.y1 - stroke.y0;
      ctx.fillRect(stroke.x0, stroke.y0, width, height);
      ctx.restore();
      return;
    }

    // 🔹 2) 일반 지우개(선 지우기)
    if (stroke.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = stroke.size || 16;
      ctx.lineCap = "round";
    } else {
      // 🔹 3) 펜 그리기
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

  // ========= 여기까지 새로 추가 ==========

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // ─────────────────────────────────────
  // 공유 메모
  // ─────────────────────────────────────

  // execCommand 이후에 현재 B/I/U/S 상태를 읽어서 state로 반영
  const refreshActiveFormats = () => {
    try {
      setActiveFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"), // strike 키
      });
    } catch {
      // 에러가 나더라도 앱이 죽지 않도록 기본값
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        strike: false,
      });
    }
  };

  // 현재 텍스트 스타일(B/I/U/S)이 활성화되어 있는지 확인하는 함수
  // const isFormatActive = (command) => {
  //   try {
  //     return document.queryCommandState(command);
  //   } catch {
  //     return false;
  //   }
  // };

  // 현재 텍스트 스타일(B/I/U/S)이 활성화되어 있는지 확인 (state 사용)
  const isFormatActive = (key) => {
    return !!activeFormats[key];
  };

  const handleNoteInput = () => {
    if (!noteEditorRef.current) return;
    const html = noteEditorRef.current.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }
    // 타이핑으로 서식이 바뀌었을 수 있으므로 상태 갱신
    refreshActiveFormats();
  };

  const applyNoteFormat = (command, value = null) => {
    if (!noteEditorRef.current) return;
    noteEditorRef.current.focus();
    document.execCommand(command, false, value);

    const html = noteEditorRef.current.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }

    // 버튼 눌러서 서식을 바꿨으니 상태도 다시 읽어오기
    refreshActiveFormats();
  };

  // 메모 글자 크기 변경 (선택/커서 위치에 px 적용)
  const handleNoteFontSizeChange = (e) => {
    const px = Number(e.target.value); // 12, 14, 18, 22
    setNoteFontSize(px);

    if (!noteEditorRef.current) return;
    const editor = noteEditorRef.current;

    // 1) 먼저 에디터 포커스 복원 → selection 되살리기
    editor.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // 선택 영역이 에디터 안에 있을 때만
    if (!editor.contains(range.commonAncestorContainer)) return;

    // ─────────────────────────────
    // A. 드래그로 선택된 텍스트가 있는 경우
    //    → 모든 자손의 font-size 를 강제로 px 로 통일
    // ─────────────────────────────
    if (!sel.isCollapsed) {
      const fragment = range.extractContents();

      // 선택된 내용을 감쌀 wrapper
      const wrapper = document.createElement("span");
      wrapper.appendChild(fragment);

      // wrapper 및 모든 자손 element 의 font-size 를 통일
      wrapper.style.fontSize = `${px}px`;
      wrapper.querySelectorAll("*").forEach((el) => {
        // 기존 font-size 제거 후 새 크기로 설정
        el.style.fontSize = `${px}px`;
        if (el.tagName === "FONT") {
          el.removeAttribute("size");
        }
      });

      range.insertNode(wrapper);

      // 커서를 wrapper 뒤로 이동 (편의)
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStartAfter(wrapper);
      newRange.collapse(true);
      sel.addRange(newRange);
    } else {
      // ─────────────────────────────
      // B. 커서만 있는 경우
      //    → 이후 입력될 글자의 기본 크기를 지정
      // ─────────────────────────────
      const span = document.createElement("span");
      span.style.fontSize = `${px}px`;

      const placeholder = document.createTextNode("\u200B");
      span.appendChild(placeholder);

      range.insertNode(span);

      const newRange = document.createRange();
      newRange.setStart(placeholder, 0);
      newRange.setEnd(placeholder, 0);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    // 변경된 HTML을 서버에 공유
    const html = editor.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }

    // B/I/U/S 상태 갱신
    refreshActiveFormats();
  };

  // ─────────────────────────────────────
  // 보드 필기 상태
  // ─────────────────────────────────────
  const toggleBoardDrawMode = () => {
    setIsBoardDrawMode((prev) => {
      const next = !prev;

      if (socketRef.current && isJoined) {
        socketRef.current.emit("board-active", {
          roomId,
          isActive: next,
        });
      }
      setBoardUserId(next ? mySocketId : null);

      // 🔹 보드 필기 OFF가 되면 지우개 관련 모드도 모두 OFF
      if (!next) {
        setIsEraserMode(false);
        setIsEraserDrag(false);
      }

      return next;
    });
  };

  // 보드 필기 OFF면 아예 동작하지 않도록 가드 추가
  const toggleEraserMode = () => {
    if (!isBoardDrawMode) return; // 보드 OFF일 때는 무시

    setIsEraserMode((prev) => {
      const next = !prev;
      if (!next) {
        // 지우개를 끄면 드래그도 같이 OFF
        setIsEraserDrag(false);
      }
      return next;
    });
  };

  // 보드 OFF 이거나 지우개 OFF면 드래그 버튼도 동작 안 함
  const toggleEraserDragMode = () => {
    if (!isBoardDrawMode || !isEraserMode) return;
    setIsEraserDrag((prev) => !prev);
  };

  // 여기까지 새 코드

  const canvasClassName = [
    "screen-canvas",
    isBoardDrawMode && !isEraserMode ? "pen-cursor" : "",
    isBoardDrawMode && isEraserMode ? "eraser-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ─────────────────────────────────────
  // 말하는 사람 감지 + 마이크 레벨바
  // ─────────────────────────────────────
  const startVoiceDetection = () => {
    const baseStream = localStreamRef.current || rawLocalStreamRef.current;
    if (!baseStream || !socketRef.current || !roomId) return;

    const selfId = socketRef.current.id; // 항상 최신 소켓 ID 사용

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(baseStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSpeaking = false;

    const check = () => {
      // 마이크가 꺼져 있으면 항상 무음 처리
      const audioTracks = localStreamRef.current
        ? localStreamRef.current.getAudioTracks()
        : [];
      const micDisabled =
        isMutedRef.current ||
        (audioTracks.length > 0 &&
          audioTracks.every((t) => t.enabled === false));

      if (micDisabled) {
        if (lastSpeaking) {
          lastSpeaking = false;
          socketRef.current.emit("speaking", {
            roomId,
            isSpeaking: false,
          });
          // 내가 말하다가 멈춘 경우만 내 하이라이트 제거
          setSpeakerId((prev) => (prev === selfId ? null : prev));
        }
        setMicLevel(0); // 레벨바도 0으로
        requestAnimationFrame(check);
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let v of dataArray) sum += v;
      const volume = sum / dataArray.length;

      // 레벨바 (0~1로 정규화)
      const normalized = Math.min(volume / 80, 1);
      setMicLevel(normalized);

      const isSpeaking = volume > 40;
      if (isSpeaking !== lastSpeaking) {
        lastSpeaking = isSpeaking;
        socketRef.current.emit("speaking", {
          roomId,
          isSpeaking,
        });
        // 본인 브라우저에서도 내 타일에 speaking 하이라이트 적용
        setSpeakerId(isSpeaking ? selfId : null);
      }
      requestAnimationFrame(check);
    };

    check();
  };

  // ─────────────────────────────────────
  // 스피커 / 마이크 볼륨 핸들러
  // ─────────────────────────────────────

  // 전체 스피커 on/off
  const toggleSpeakerMute = () => {
    setIsSpeakerMuted((prev) => !prev);
  };

  // 전체 스피커 볼륨
  const handleSpeakerVolumeChange = (e) => {
    const vol = Number(e.target.value);
    setSpeakerVolume(vol);
    setIsSpeakerMuted(vol === 0);
  };

  // 마이크 볼륨 슬라이더
  const handleMicVolumeChange = (e) => {
    const v = Number(e.target.value);
    setMicVolume(v);

    // 음소거 상태가 아닐 때만 게인 반영
    if (!isMutedRef.current && micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = v;
    }
  };

  // 스피커 볼륨이 바뀔 때 실제 원격 비디오 음량 적용
  useEffect(() => {
    const vol = isSpeakerMuted ? 0 : speakerVolume;

    Object.values(remoteVideoRefs.current).forEach((el) => {
      if (!el) return;
      el.volume = vol; // 0~1
      el.muted = vol === 0;
    });
  }, [isSpeakerMuted, speakerVolume, remoteStreams]);

  // ─────────────────────────────────────
  // 상단 정렬 순서 (socketId 오름차순)
  // ─────────────────────────────────────
  const participantIds = [mySocketId, ...remoteStreams.map((p) => p.id)].filter(
    Boolean
  );
  const sortedIds = Array.from(new Set(participantIds)).sort();
  const orderMap = {};
  sortedIds.forEach((id, idx) => {
    orderMap[id] = idx;
  });

  // ─────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────
  return (
    <div className="app-root">
      {/* 상단 바 */}
      <div className="top-bar">
        <span className="top-bar-title">WebRTC 1:N (ver2.1) </span>

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

        {/* 스피커 버튼 + 볼륨 */}
        <div className="audio-control-group">
          <button
            className={`speaker-btn ${isSpeakerMuted ? "muted" : ""}`}
            onClick={toggleSpeakerMute}
            title={isSpeakerMuted ? "스피커 켜기" : "스피커 끄기"}
          >
            <span className="speaker-icon" />
          </button>
          <input
            type="range"
            className="speaker-volume"
            min="0"
            max="1"
            step="0.05"
            value={speakerVolume}
            onChange={handleSpeakerVolumeChange}
          />
          {/* 파란 레벨바는 사용하지 않으므로 CSS에서 숨김 처리됨 */}
          <div className="level-bar speaker-level">
            <div
              className="level-inner"
              style={{
                width: `${(isSpeakerMuted ? 0 : speakerVolume) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* 마이크 버튼 + 볼륨 + 레벨 */}
        <div className="audio-control-group">
          <button
            className={`mic-btn ${isMuted ? "muted" : ""}`}
            onClick={toggleMute}
            title={isMuted ? "마이크 켜기" : "마이크 끄기"}
          >
            <span className="mic-icon" />
          </button>
          <input
            type="range"
            className="mic-volume"
            min="0"
            max="2"
            step="0.05"
            value={micVolume}
            onChange={handleMicVolumeChange}
          />
          <div className="level-bar mic-level">
            <div
              className="level-inner"
              style={{ width: `${micLevel * 100}%` }}
            />
          </div>
        </div>

        <button onClick={handleShareScreen}>화면 공유</button>
        <button onClick={handleStopShare}>공유 종료</button>

        <button className="leave-btn" onClick={handleHangup}>
          나가기
        </button>
      </div>

      {/* 메인 레이아웃 */}
      <div className="main-layout">
        {/* 왼쪽: 영상 + 보드 */}
        <div className="left-side">
          <div className="video-strip">
            {/* 내 화면 */}
            <div
              className={
                "video-panel" +
                (speakerId === mySocketId ? " speaking" : "") +
                (boardUserId === mySocketId ? " boarding" : "")
              }
              style={{ order: orderMap[mySocketId] ?? 0 }}
            >
              <video ref={localVideoRef} autoPlay playsInline muted />
              <span className="video-label">
                {username}
                {mySocketId && " (나)"}
              </span>
            </div>

            {/* 원격 참가자들 */}
            {remoteStreams.map((p) => (
              <div
                key={p.id}
                className={
                  "video-panel" +
                  (speakerId === p.id ? " speaking" : "") +
                  (boardUserId === p.id ? " boarding" : "") +
                  (p.offline ? " offline" : "")
                }
                style={{ order: orderMap[p.id] ?? 0 }}
              >
                {p.stream ? (
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el) {
                        remoteVideoRefs.current[p.id] = el;
                        if (p.stream && el.srcObject !== p.stream) {
                          el.srcObject = p.stream;
                        }
                      }
                    }}
                  />
                ) : (
                  // 🔹 영상이 없으면 회색 배경 + 안내 텍스트
                  <div className="video-offline-text">연결 종료</div>
                )}

                <span className="video-label">
                  {p.username}
                  {p.offline ? " (퇴장)" : ""}
                </span>
              </div>
            ))}
          </div>

          {/* 하단: 화면 공유 + 보드 */}
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

              {/* 보드 OFF일 때는 지우개 버튼 비활성화 */}
              <button
                className={isEraserMode ? "toggle-on" : ""}
                onClick={toggleEraserMode}
                disabled={!isBoardDrawMode}
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
                disabled={!isBoardDrawMode}
              />
              <div
                className="eraser-preview"
                style={{ width: eraserSize, height: eraserSize }}
              />

              <button
                className={isEraserDrag ? "toggle-on" : ""}
                onClick={toggleEraserDragMode}
                disabled={!isBoardDrawMode || !isEraserMode}
                style={{ marginLeft: "12px" }}
              >
                지우개 드래그 {isEraserDrag ? "ON" : "OFF"}
              </button>

              <span style={{ marginLeft: "12px", fontSize: "0.8rem" }}>
                색상:
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
            <div className="chat-title">채팅 화면</div>

            <div
              className="chat-window"
              style={{ fontSize: `${chatFontSize}px` }}
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.isSystem ? "chat-message system" : "chat-message"
                  }
                >
                  {m.isSystem ? (
                    <span>{m.message}</span>
                  ) : (
                    <>
                      <strong style={{ color: "#333" }}>{m.user}</strong>
                      <span style={{ color: m.color || "#000" }}>
                        {" "}
                        {m.message}
                      </span>
                    </>
                  )}
                </div>
              ))}
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
                style={{ fontSize: `${chatFontSize}px` }}
              />

              <div className="chat-buttons">
                <input
                  type="color"
                  value={chatColor}
                  onChange={(e) => setChatColor(e.target.value)}
                  className="chat-color-picker"
                />

                {/* 글자크기 선택 (전송 버튼 위) */}
                <select
                  className="chat-font-size"
                  value={chatFontSize}
                  onChange={(e) => setChatFontSize(Number(e.target.value))}
                >
                  <option value={12}>작게</option>
                  <option value={14}>보통</option>
                  <option value={16}>크게</option>
                  <option value={20}>최대</option>
                </select>

                <button className="chat-send-btn" onClick={handleSendMessage}>
                  전송
                </button>
              </div>
            </div>
          </div>

          <div className="notes-panel">
            <div className="notes-title">공유 메모</div>

            {/* 리치 텍스트 메모 영역 */}
            <div
              className="notes-editor"
              ref={noteEditorRef}
              contentEditable
              suppressContentEditableWarning={true}
              onInput={handleNoteInput}
              style={{ fontSize: "14px" }} // 에디터 기본값
            />

            {/* 포맷 툴바 */}
            <div className="notes-toolbar">
              <button
                className={isFormatActive("bold") ? "active" : ""}
                onClick={() => applyNoteFormat("bold")}
              >
                <b>B</b>
              </button>

              <button
                className={isFormatActive("italic") ? "active" : ""}
                onClick={() => applyNoteFormat("italic")}
              >
                <i>I</i>
              </button>

              <button
                className={isFormatActive("underline") ? "active" : ""}
                onClick={() => applyNoteFormat("underline")}
              >
                <u>U</u>
              </button>

              <button
                className={isFormatActive("strike") ? "active" : ""}
                onClick={() => applyNoteFormat("strikeThrough")}
              >
                <s>S</s>
              </button>

              <label className="notes-color-label">
                색상
                <input
                  type="color"
                  onChange={(e) => applyNoteFormat("foreColor", e.target.value)}
                />
              </label>

              {/* 오른쪽: size + select (하단 우측) */}
              <div className="notes-toolbar-right">
                <label className="notes-size-label">size</label>
                <select
                  value={noteFontSize}
                  onChange={handleNoteFontSizeChange}
                >
                  <option value="12">작게</option>
                  <option value="14">보통</option>
                  <option value="18">크게</option>
                  <option value="22">최대</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
