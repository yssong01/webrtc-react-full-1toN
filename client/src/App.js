// src/App.js
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// WebSocket 서버 주소는 .env 에서 주입
// 예: REACT_APP_SOCKET_URL=http://localhost:5000
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;

// WebRTC 연결 시 사용할 ICE 서버 설정
// - 여기선 Google STUN 서버만 사용 (TURN 미구현)
const pcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function App() {
  // ─────────────────────────────────────
  // 1. 공통 상태 (방 정보 / 사용자 정보 / 음성 관련)
  // ─────────────────────────────────────
  const [roomId, setRoomId] = useState("room-1"); // 기본 방 ID
  const [username, setUsername] = useState(
    "user-" + Math.floor(Math.random() * 1000) // 랜덤 닉네임
  );
  const [isJoined, setIsJoined] = useState(false); // 방 입장 여부

  // 내 마이크 ON/OFF 상태
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false); // 오디오 분석 함수에서 사용할 현재 음소거 상태
  const [mySocketId, setMySocketId] = useState(null); // 내 소켓 ID

  // 전체 스피커 상태 (모든 remote 비디오에 공통 적용)
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(1); // 0~1

  // 마이크 볼륨(게인) & 말하기 레벨바(0~1)
  const [micVolume, setMicVolume] = useState(1); // 0~2 정도, 게인값
  const [micLevel, setMicLevel] = useState(0);   // 시각화용 레벨바 값

  // ─────────────────────────────────────
  // 2. 소켓 / WebRTC / 스트림 관련 ref
  // ─────────────────────────────────────
  const socketRef = useRef(null);             // Socket.IO 인스턴스
  const rawLocalStreamRef = useRef(null);     // getUserMedia로 얻은 원본 스트림
  const localStreamRef = useRef(null);        // 마이크 게인 처리 등 후 최종 송출 스트림
  const screenStreamRef = useRef(null);       // 화면 공유용 스트림
  const screenSenderRef = useRef({});         // { peerId: RTCRtpSender } (화면 트랙 관리)

  // Web Audio용: 마이크 볼륨 조절을 위한 오디오 그래프
  const audioCtxRef = useRef(null);
  const micGainNodeRef = useRef(null);

  // 1:N 피어 연결 상태 관리용: { [socketId]: { pc, username, hasCam } }
  const peersRef = useRef({});

  // 원격 비디오 DOM 참조 (스피커 볼륨/뮤트 한 번에 적용하기 위함)
  const remoteVideoRefs = useRef({}); // { socketId: HTMLVideoElement }

  // remoteStreams: 현재 참가자의 화면 목록 (UI 렌더링용)
  // - id: 각 피어의 소켓ID
  // - username: 표시용 이름
  // - stream: 실제 MediaStream (비디오 + 오디오)
  const [remoteStreams, setRemoteStreams] = useState([]);

  // "말하는 사람" / "보드 필기 중인 사람" 하이라이트용
  const [speakerId, setSpeakerId] = useState(null);
  const [boardUserId, setBoardUserId] = useState(null);

  // DOM refs
  const localVideoRef = useRef(null);   // 내 카메라 영상
  const screenVideoRef = useRef(null);  // 화면 공유 영상

  // ─────────────────────────────────────
  // 3. 채팅 상태
  // ─────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatColor, setChatColor] = useState("#000000");
  const [chatFontSize, setChatFontSize] = useState(14); // 채팅 글자 크기(px)

  // ─────────────────────────────────────
  // 4. 화이트보드(캔버스) 상태
  // ─────────────────────────────────────
  const canvasRef = useRef(null);
  const drawing = useRef(false);           // 현재 그리고 있는 중인지 여부
  const [penColor, setPenColor] = useState("#ff0000");
  const [penWidth, setPenWidth] = useState(2);
  const [isBoardDrawMode, setIsBoardDrawMode] = useState(false); // 보드 필기 ON/OFF
  const [isEraserMode, setIsEraserMode] = useState(false);       // 지우개 ON/OFF
  const [isEraserDrag, setIsEraserDrag] = useState(false);       // 드래그 영역 지우기
  const [eraserSize, setEraserSize] = useState(16);
  const dragPreviewImageRef = useRef(null); // 드래그 지우기 미리보기용 이미지 저장

  // ─────────────────────────────────────
  // 5. 공유 메모 (리치 텍스트)의 DOM & 상태
  // ─────────────────────────────────────
  const noteEditorRef = useRef(null);

  // B/I/U/S 버튼 활성 상태 (현재 선택 영역 기준)
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });

  const [noteFontSize, setNoteFontSize] = useState(14); // 메모 기본 글자 크기(px)

  // ─────────────────────────────────────
  // 6. Socket.IO 연결 및 각종 이벤트 등록
  // ─────────────────────────────────────
  useEffect(() => {
    // 서버와 웹소켓 연결 생성
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    // 연결 성공 시 내 socket.id 확보
    socket.on("connect", () => {
      console.log("[client] socket connected:", socket.id);
      setMySocketId(socket.id);
    });

    // -------------------------------
    // 서버에서 보내주는 "현재 방의 참가자 목록"
    //   → 여기서 1:N WebRTC 피어 연결을 관리
    // -------------------------------
    socket.on("room-users", async ({ users }) => {
      console.log("[client] room-users:", users);
      const myId = socket.id;
      setMySocketId(myId);

      const currentIds = users.map((u) => u.socketId);
      const others = users.filter((u) => u.socketId !== myId);

      // 1) 방에서 나간 유저 정리: PeerConnection 닫기 + remoteStreams 제거
      Object.keys(peersRef.current).forEach((peerId) => {
        if (!currentIds.includes(peerId)) {
          const info = peersRef.current[peerId];

          if (info?.pc) {
            // 이전 버전: 여기서 track.stop()까지 해서 내 카메라까지 꺼지는 문제가 있었음
            // info.pc.getSenders().forEach((s) => s.track && s.track.stop());

            // 수정 버전: 연결만 닫고, 내 로컬 트랙은 그대로 유지
            info.pc.close();
          }

          delete peersRef.current[peerId];
          delete remoteVideoRefs.current[peerId];

          // 스피킹/보드 하이라이트에서 제거
          setSpeakerId((prev) => (prev === peerId ? null : prev));
          setBoardUserId((prev) => (prev === peerId ? null : prev));
        }
      });

      // 2) remoteStreams 상태에서도 나간 유저 제거
      setRemoteStreams((prev) => prev.filter((p) => currentIds.includes(p.id)));

      // 3) 새로 들어온 유저에 대해서만 PeerConnection 생성
      others.forEach((u) => {
        const peerId = u.socketId;
        const peerName = u.username;

        // 이미 PC가 있다면 스킵
        if (peersRef.current[peerId]?.pc) return;

        // 소켓ID 문자열 기준으로 "누가 먼저 Offer를 보낼지" 결정
        const isCaller = myId < peerId;
        createPeerConnection(peerId, peerName, isCaller);
      });
    });

    // -------------------------------
    // WebRTC 시그널링 핸들링: Offer/Answer/ICE
    // -------------------------------
    socket.on("webrtc-offer", async ({ from, sdp }) => {
      console.log("[client] webrtc-offer from", from);

      // offer 를 받으면 피어 연결을 만들고, remote SDP를 적용 후 answer 생성
      const pc = createPeerConnection(
        from,
        peersRef.current[from]?.username,
        false // 받은 쪽은 Caller가 아님
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

    // -------------------------------
    // 채팅 메시지 수신 (일반 + 시스템 메시지)
    // -------------------------------
    socket.on("chat-message", (payload) => {
      console.log("[client] chat-message:", payload);
      setMessages((prev) => [...prev, payload]);
    });

    // -------------------------------
    // 화이트보드 / 메모 / 화면공유 시그널링 수신
    // -------------------------------
    socket.on("draw", ({ stroke }) => {
      drawStroke(stroke);
    });

    socket.on("note-update", ({ text }) => {
      const html = text || "";
      // 내가 가진 메모 내용과 다를 때만 업데이트
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

    // "말하는 사람" 표시용 이벤트
    socket.on("speaking", ({ socketId, isSpeaking }) => {
      setSpeakerId((prev) => {
        if (!isSpeaking && prev === socketId) return null;
        if (isSpeaking) return socketId;
        return prev;
      });
    });

    // "보드 필기 중인 사람" 표시용 이벤트
    socket.on("board-active", ({ socketId, isActive }) => {
      setBoardUserId((prev) => {
        if (!isActive && prev === socketId) return null;
        if (isActive) return socketId;
        return prev;
      });
    });

    // 컴포넌트 언마운트 시 소켓 연결 해제
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line
  }, []);

  // ─────────────────────────────────────
  // 7. 공유 메모 선택 변경 감지 → B/I/U/S 버튼 활성 상태 동기화
  // ─────────────────────────────────────
  useEffect(() => {
    const onSelectionChange = () => {
      if (!noteEditorRef.current) return;
      // 메모 에디터에 포커스가 있을 때만 포맷 상태를 읽음
      if (document.activeElement !== noteEditorRef.current) return;
      refreshActiveFormats();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []); // noteEditorRef는 ref이므로 deps에 넣지 않아도 됨

  // ─────────────────────────────────────
  // 8. 방 입장 버튼
  // ─────────────────────────────────────
  const handleJoinRoom = () => {
    if (!socketRef.current) return;
    // 서버에 방ID + username 전달 → room-users 브로드캐스트
    socketRef.current.emit("join-room", { roomId, username });
    setIsJoined(true);
  };

  // ─────────────────────────────────────
  // 9. 로컬 카메라/마이크 획득 (마이크 게인 포함)
  // ─────────────────────────────────────
  const ensureLocalStream = async () => {
    // 이미 스트림이 있으면 재요청하지 않음
    if (localStreamRef.current) return;

    try {
      // 1) 카메라 + 마이크 원본 스트림 요청
      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      rawLocalStreamRef.current = rawStream;

      // 2) Web Audio API 구성: 마이크 볼륨 조절을 위한 그래프
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(rawStream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = micVolume; // 초기 게인 = 현재 슬라이더 값
      micGainNodeRef.current = gainNode;

      const dest = audioCtx.createMediaStreamDestination();

      source.connect(gainNode);
      gainNode.connect(dest);

      // 3) 최종 WebRTC 송출용 스트림: 비디오(원본) + 오디오(게인 적용)
      const processedStream = new MediaStream();
      rawStream.getVideoTracks().forEach((track) => {
        processedStream.addTrack(track);
      });
      dest.stream.getAudioTracks().forEach((track) => {
        processedStream.addTrack(track);
      });

      localStreamRef.current = processedStream;

      // 내 비디오 DOM에 스트림 연결
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = processedStream;
      }

      console.log("로컬 스트림(마이크 게인 포함) 획득");
      startVoiceDetection(); // 내 마이크 레벨 분석 + speaking 이벤트 시작
    } catch (err) {
      console.error("getUserMedia 실패:", err);
      alert("카메라/마이크 접근 실패");
    }
  };

  // ─────────────────────────────────────
  // 10. PeerConnection 생성 함수 (1:N 구조의 핵심)
  // ─────────────────────────────────────
  const createPeerConnection = (peerId, peerName, isCaller) => {
    // 이미 존재하는 PC가 있다면 재사용
    if (peersRef.current[peerId]?.pc) {
      return peersRef.current[peerId].pc;
    }

    // RTCPeerConnection 생성
    const pc = new RTCPeerConnection(pcConfig);

    // peersRef에 PC 및 메타정보 저장
    peersRef.current[peerId] = {
      ...(peersRef.current[peerId] || {}),
      pc,
      username: peerName || peersRef.current[peerId]?.username || "user",
      hasCam: false, // 아직 상대 영상이 도착하지 않았다는 의미
    };

    // 1) 내 로컬 트랙들을 이 PC에 추가 (카메라/마이크, 화면 공유 등)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // 2) ICE 후보가 생길 때마다 서버로 전송 → 상대에게 전달
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("webrtc-ice-candidate", {
          roomId,
          candidate: event.candidate,
          to: peerId,
        });
      }
    };

    // 3) 상대방의 트랙(비디오/오디오)이 들어올 때 처리
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      const peerInfo = peersRef.current[peerId];

      if (event.track.kind === "video") {
        // 첫 비디오 트랙: "카메라" 라고 간주
        if (!peerInfo.hasCam) {
          peersRef.current[peerId].hasCam = true;
          setRemoteStreams((prev) => {
            const exist = prev.find((p) => p.id === peerId);
            if (exist) {
              // 기존 객체가 있으면 stream만 교체
              return prev.map((p) => (p.id === peerId ? { ...p, stream } : p));
            }
            // 처음 들어온 유저면 새로 추가
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
          // 두 번째 이후 비디오 트랙은 화면 공유로 간주하여 screenVideoRef에 연결
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = stream;
          }
        }
      } else if (event.track.kind === "audio") {
        console.log("원격 오디오 트랙 수신 from", peerId);
      }
    };

    // 4) Caller일 때만 Offer 생성해서 전송
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

  // ─────────────────────────────────────
  // 11. "화상 시작" 버튼 클릭 시
  //  - 로컬 스트림 확보 후, 모든 피어와 재협상(Offer) 진행
  // ─────────────────────────────────────
  const handleCallStart = async () => {
    if (!isJoined) {
      alert("먼저 방에 입장하세요.");
      return;
    }
    await ensureLocalStream();

    // 이미 존재하는 모든 PeerConnection에 내 트랙을 붙이고 재협상
    if (localStreamRef.current && socketRef.current) {
      const entries = Object.entries(peersRef.current);
      for (const [peerId, info] of entries) {
        const pc = info.pc;
        if (!pc) continue;

        // 같은 kind 트랙을 중복 추가하지 않도록 방어
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

  // ─────────────────────────────────────
  // 12. 마이크 음소거 토글
  //  - Web Audio 게인 + track.enabled + 모든 PeerConnection 오디오 동기 OFF
  // ─────────────────────────────────────
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

      // 1) Web Audio 게인으로 음량 0 / 복구
      if (micGainNodeRef.current) {
        micGainNodeRef.current.gain.value = next ? 0 : micVolume;
      }

      // 2) 로컬(가공 후) 스트림 오디오 트랙 ON/OFF
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

      // 3) 원본 스트림도 방어적으로 동일하게 처리
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

      // 4) 이미 만들어진 모든 PeerConnection 의 오디오 sender track도 OFF
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
  // 13. 화면 공유 시작
  //  - getDisplayMedia → 각 PeerConnection에 화면 트랙 추가
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

      // 모든 참가자에게 화면 트랙 추가 후 재협상
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

      // "누가 화면 공유를 시작했다"는 신호만 서버를 통해 전파
      socketRef.current.emit("screen-share-start", { roomId });

      // 사용자가 OS 창에서 "공유 중지" 눌렀을 때 처리
      screenTrack.onended = () => {
        handleStopShare();
      };
    } catch (err) {
      console.error("화면 공유 실패:", err);
    }
  };

  // ─────────────────────────────────────
  // 14. 화면 공유 종료
  // ─────────────────────────────────────
  const handleStopShare = async () => {
    try {
      // 1) 내 화면 공유 스트림 정리
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }

      // 2) 각 PeerConnection에서 화면 트랙 제거 후 재협상
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

      // 3) 서버에 공유 종료 이벤트 전파
      if (socketRef.current) {
        socketRef.current.emit("screen-share-stop", { roomId });
      }
    } catch (err) {
      console.error("화면 공유 종료 오류:", err);
    }
  };

  // ─────────────────────────────────────
  // 15. 통화 종료 + 방 나가기 (나가기 버튼)
  // ─────────────────────────────────────
  const handleHangup = () => {
    // 0) 서버에 "이 방에서 나간다"는 이벤트 알림
    if (socketRef.current && isJoined) {
      socketRef.current.emit("leave-room", { roomId });
    }

    // 1) 화면 공유 정리
    handleStopShare();

    // 2) 내 로컬 스트림 트랙 stop
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    // 3) 모든 PeerConnection 닫기
    Object.values(peersRef.current).forEach(({ pc }) => {
      if (!pc) return;
      pc.getSenders().forEach((s) => {
        if (s.track) s.track.stop();
      });
      pc.close();
    });
    peersRef.current = {};
    setRemoteStreams([]);

    // 4) 화면에 연결된 비디오 srcObject 초기화
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;

    // 5) 상태 초기화
    setIsJoined(false);
    setIsMuted(false);
    isMutedRef.current = false;
    setSpeakerId(null);
    setBoardUserId(null);
  };

  // ─────────────────────────────────────
  // 16. 채팅 전송
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
  // 17. 화이트보드: 마우스 이벤트 (그리기/지우기)
  // ─────────────────────────────────────
  const handleCanvasMouseDown = (e) => {
    if (!isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;

    // 🔹 지우개 + 드래그 ON → 영역 지우기 시작 (사각형 지정 시작점)
    if (isEraserMode && isEraserDrag) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      // 현재 화면 전체를 저장해 두었다가 드래그 미리보기용으로 사용
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
        rect: true, // 영역 지우개 모드 플래그
      };
      return;
    }

    // 🔹 일반 펜 / 일반 지우개 → 선을 따라가며 그리기/지우기
    drawing.current = { x: offsetX, y: offsetY };
  };

  const handleCanvasMouseMove = (e) => {
    if (!drawing.current || !isBoardDrawMode) return;
    const { offsetX, offsetY } = e.nativeEvent;

    // 🔹 영역 지우개 모드: 마우스를 움직이는 동안 "미리보기 사각형"만 그림
    if (isEraserMode && isEraserDrag && drawing.current.rect) {
      drawing.current = {
        ...drawing.current,
        x1: offsetX,
        y1: offsetY,
      };

      const canvas = canvasRef.current;
      if (!canvas || !dragPreviewImageRef.current) return;
      const ctx = canvas.getContext("2d");

      // 저장해둔 원래 화면으로 되돌린 뒤
      ctx.putImageData(dragPreviewImageRef.current, 0, 0);

      // 그 위에 흰색 점선 사각형으로 "지울 영역"만 표시
      const { x0, y0, x1, y1 } = drawing.current;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const width = Math.abs(x1 - x0);
      const height = Math.abs(y1 - y0);

      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(left, top, width, height);
      ctx.restore();

      return; // 아직 실제로는 지우지 않음
    }

    // 🔹 일반 펜 / 일반 지우개 모드: 선을 따라 그리기 or 지우기
    const x0 = drawing.current.x;
    const y0 = drawing.current.y;
    const x1 = offsetX;
    const y1 = offsetY;

    const stroke = isEraserMode
      ? { x0, y0, x1, y1, mode: "erase", size: eraserSize }
      : { x0, y0, x1, y1, mode: "draw", color: penColor, width: penWidth };

    // 내 화면에 즉시 반영
    drawStroke(stroke);
    // 다른 사람들에게도 stroke 정보 전송
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

    // 🔹 마우스 떼는 시점: 영역 지우개 모드라면 실제로 해당 영역을 지움
    if (isEraserMode && isEraserDrag && drawing.current.rect) {
      const { x0, y0, x1, y1 } = drawing.current;

      const canvas = canvasRef.current;
      if (canvas && dragPreviewImageRef.current) {
        const ctx = canvas.getContext("2d");
        // 미리보기 사각형을 지우고, 저장해둔 원래 그림으로 복원
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

      // 미리보기 이미지 메모리 해제
      dragPreviewImageRef.current = null;
    }

    drawing.current = false;
  };

  // ─────────────────────────────────────
  // 18. 실제 선 그리기/지우기 구현 (내 화면 기준)
  //     - draw 이벤트를 받았을 때도 이 함수를 그대로 사용
  // ─────────────────────────────────────
  const drawStroke = (stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.save();

    // 1) 영역 지우개: 사각형 전체를 지움
    if (stroke.mode === "erase-rect") {
      ctx.globalCompositeOperation = "destination-out";
      const width = stroke.x1 - stroke.x0;
      const height = stroke.y1 - stroke.y0;
      ctx.fillRect(stroke.x0, stroke.y0, width, height);
      ctx.restore();
      return;
    }

    // 2) 일반 지우개 (선 지우기)
    if (stroke.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = stroke.size || 16;
      ctx.lineCap = "round";
    } else {
      // 3) 펜으로 그리기
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

  // 화이트보드 전체 지우기 (내 화면에서만)
  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // ─────────────────────────────────────
  // 19. 공유 메모 포맷 상태(B/I/U/S) 갱신
  // ─────────────────────────────────────
  const refreshActiveFormats = () => {
    try {
      setActiveFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
      });
    } catch {
      // execCommand가 에러를 내더라도 앱이 죽지 않도록 방어
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        strike: false,
      });
    }
  };

  // 현재 스타일이 켜져있는지 여부를 state로 확인
  const isFormatActive = (key) => {
    return !!activeFormats[key];
  };

  // 메모 내용이 바뀔 때마다 서버에 HTML 전체 전송
  const handleNoteInput = () => {
    if (!noteEditorRef.current) return;
    const html = noteEditorRef.current.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }
    // 입력으로 인해 포맷 상태가 변했을 수 있으니 다시 읽어오기
    refreshActiveFormats();
  };

  // B/I/U/S 버튼 클릭 시 execCommand로 스타일 적용
  const applyNoteFormat = (command, value = null) => {
    if (!noteEditorRef.current) return;
    noteEditorRef.current.focus();
    document.execCommand(command, false, value);

    const html = noteEditorRef.current.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }
    refreshActiveFormats();
  };

  // 메모 글자 크기 변경: 선택 영역 또는 커서 위치에 px 단위 스타일 적용
  const handleNoteFontSizeChange = (e) => {
    const px = Number(e.target.value); // 12, 14, 18, 22
    setNoteFontSize(px);

    if (!noteEditorRef.current) return;
    const editor = noteEditorRef.current;

    editor.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // 선택 영역이 메모 에디터 내부에 있는 경우에만 처리
    if (!editor.contains(range.commonAncestorContainer)) return;

    // A. 텍스트를 드래그해서 선택한 경우 → 선택 영역 전체에 font-size 적용
    if (!sel.isCollapsed) {
      const fragment = range.extractContents();

      const wrapper = document.createElement("span");
      wrapper.appendChild(fragment);

      wrapper.style.fontSize = `${px}px`;
      wrapper.querySelectorAll("*").forEach((el) => {
        el.style.fontSize = `${px}px`;
        if (el.tagName === "FONT") {
          el.removeAttribute("size");
        }
      });

      range.insertNode(wrapper);

      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStartAfter(wrapper);
      newRange.collapse(true);
      sel.addRange(newRange);
    } else {
      // B. 커서만 있는 경우 → 이후 입력될 글자의 기본 크기를 변경
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

    const html = editor.innerHTML;
    if (socketRef.current) {
      socketRef.current.emit("note-update", { roomId, text: html });
    }

    refreshActiveFormats();
  };

  // ─────────────────────────────────────
  // 20. 보드 필기/지우개 모드 토글
  // ─────────────────────────────────────
  const toggleBoardDrawMode = () => {
    setIsBoardDrawMode((prev) => {
      const next = !prev;

      // 자신의 보드 필기 상태를 서버에 전파 → 다른 클라이언트에서 하이라이트 표시
      if (socketRef.current && isJoined) {
        socketRef.current.emit("board-active", {
          roomId,
          isActive: next,
        });
      }
      setBoardUserId(next ? mySocketId : null);

      // 보드 OFF가 되면 지우개 관련 모드도 모두 OFF
      if (!next) {
        setIsEraserMode(false);
        setIsEraserDrag(false);
      }

      return next;
    });
  };

  // 보드 OFF일 때는 지우개 버튼 자체가 동작하지 않도록 가드
  const toggleEraserMode = () => {
    if (!isBoardDrawMode) return;

    setIsEraserMode((prev) => {
      const next = !prev;
      if (!next) {
        // 지우개를 끄면 드래그 영역 지우기도 함께 OFF
        setIsEraserDrag(false);
      }
      return next;
    });
  };

  // 지우개가 켜져 있을 때만 드래그 지우기 허용
  const toggleEraserDragMode = () => {
    if (!isBoardDrawMode || !isEraserMode) return;
    setIsEraserDrag((prev) => !prev);
  };

  // 캔버스 CSS 클래스 (마우스 커서 모양 변경용)
  const canvasClassName = [
    "screen-canvas",
    isBoardDrawMode && !isEraserMode ? "pen-cursor" : "",
    isBoardDrawMode && isEraserMode ? "eraser-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ─────────────────────────────────────
  // 21. 말하는 사람 감지 + 마이크 레벨바 갱신
  // ─────────────────────────────────────
  const startVoiceDetection = () => {
    const baseStream = localStreamRef.current || rawLocalStreamRef.current;
    if (!baseStream || !socketRef.current || !roomId) return;

    const selfId = socketRef.current.id; // speaking 이벤트에 사용할 내 소켓 ID

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
          // 내가 말하다가 멈춘 경우 내 스피킹 하이라이트 제거
          setSpeakerId((prev) => (prev === selfId ? null : prev));
        }
        setMicLevel(0);
        requestAnimationFrame(check);
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let v of dataArray) sum += v;
      const volume = sum / dataArray.length;

      // 0~1 로 정규화한 값으로 레벨바에 표시
      const normalized = Math.min(volume / 80, 1);
      setMicLevel(normalized);

      const isSpeaking = volume > 40; // 임계값 기준으로 말하는지 판단
      if (isSpeaking !== lastSpeaking) {
        lastSpeaking = isSpeaking;
        socketRef.current.emit("speaking", {
          roomId,
          isSpeaking,
        });
        // 내 화면에서도 내 타일에 speaking 하이라이트 적용
        setSpeakerId(isSpeaking ? selfId : null);
      }
      requestAnimationFrame(check);
    };

    check();
  };

  // ─────────────────────────────────────
  // 22. 스피커/마이크 볼륨 제어
  // ─────────────────────────────────────
  const toggleSpeakerMute = () => {
    setIsSpeakerMuted((prev) => !prev);
  };

  const handleSpeakerVolumeChange = (e) => {
    const vol = Number(e.target.value);
    setSpeakerVolume(vol);
    setIsSpeakerMuted(vol === 0);
  };

  const handleMicVolumeChange = (e) => {
    const v = Number(e.target.value);
    setMicVolume(v);

    // 음소거 상태가 아닐 때만 게인 값 반영
    if (!isMutedRef.current && micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = v;
    }
  };

  // 스피커 볼륨이 바뀌면 모든 원격 비디오의 volume/muted 반영
  useEffect(() => {
    const vol = isSpeakerMuted ? 0 : speakerVolume;

    Object.values(remoteVideoRefs.current).forEach((el) => {
      if (!el) return;
      el.volume = vol; // 0~1
      el.muted = vol === 0;
    });
  }, [isSpeakerMuted, speakerVolume, remoteStreams]);

  // ─────────────────────────────────────
  // 23. 상단 영상 스트립 정렬 순서 (socketId 오름차순)
  // ─────────────────────────────────────
  const participantIds = [mySocketId, ...remoteStreams.map((p) => p.id)].filter(
    Boolean
  );
  const sortedIds = Array.from(new Set(participantIds)).sort();
  const orderMap = {};
  sortedIds.forEach((id, idx) => {
    orderMap[id] = idx; // CSS flex order 값으로 사용
  });

  // ─────────────────────────────────────
  // 24. 렌더링: 전체 레이아웃
  // ─────────────────────────────────────
  return (
    <div className="app-root">
      {/* 상단 컨트롤 바: 방ID, 이름, 화상 시작, 오디오/화면 컨트롤 */}
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

        {/* 스피커 버튼 + 볼륨 슬라이더 */}
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
          {/* 스피커 레벨바는 디자인상 숨김 처리 */}
          <div className="level-bar speaker-level">
            <div
              className="level-inner"
              style={{
                width: `${(isSpeakerMuted ? 0 : speakerVolume) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* 마이크 버튼 + 볼륨 슬라이더 + 레벨바 */}
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

      {/* 메인 레이아웃: 왼쪽(영상+보드) / 오른쪽(채팅+메모) */}
      <div className="main-layout">
        {/* 왼쪽: 참가자 영상 스트립 + 하단 보드 */}
        <div className="left-side">
          <div className="video-strip">
            {/* 내 화면 타일 */}
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

            {/* 원격 참가자 영상 타일 */}
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
                  // p.offline 표시용 기본 UI
                  <div className="video-offline-text">연결 종료</div>
                )}

                <span className="video-label">
                  {p.username}
                  {p.offline ? " (퇴장)" : ""}
                </span>
              </div>
            ))}
          </div>

          {/* 하단: 화면 공유 + 보드 캔버스 */}
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

            {/* 보드 컨트롤 버튼들 */}
            <div className="board-controls">
              <button
                className={isBoardDrawMode ? "toggle-on" : ""}
                onClick={toggleBoardDrawMode}
              >
                보드 필기 {isBoardDrawMode ? "ON" : "OFF"}
              </button>

              {/* 보드 OFF이면 지우개는 비활성화 */}
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

        {/* 오른쪽: 채팅 패널 + 공유 메모 패널 */}
        <div className="right-side">
          {/* 채팅 */}
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
                    // 시스템 메시지는 이탤릭/회색
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

                {/* 채팅 글씨 크기 선택 */}
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

          {/* 공유 메모 */}
          <div className="notes-panel">
            <div className="notes-title">공유 메모</div>

            {/* contentEditable 리치 텍스트 영역 */}
            <div
              className="notes-editor"
              ref={noteEditorRef}
              contentEditable
              suppressContentEditableWarning={true}
              onInput={handleNoteInput}
              style={{ fontSize: "14px" }} // 에디터 기본 폰트 크기
            />

            {/* 메모 포맷 툴바 (B/I/U/S/색상/크기) */}
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

              {/* 오른쪽: 글자 크기 선택 */}
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
