// src/App.test.js

// React 컴포넌트를 테스트하기 위한 도구 불러오기
import { render, screen } from "@testing-library/react";
import App from "./App";

/*
  이 테스트의 의미:
  1. <App /> 컴포넌트를 화면에 렌더링한다.
  2. 화면에 "WebRTC 1:N 화상" 이라는 글자가 존재하는지 검사한다.
  3. 존재하면 테스트 통과, 없으면 실패.
  
  !!! 주의:
  - getByText(...) 안의 문자열은 실제 화면에 보이는 제목과 같아야 합니다.
  - 만약 App.jsx 상단 제목이 "WebRTC 1:N (ver2.1)" 이라면
    여기 테스트 문자열도 그에 맞게 수정해야 테스트가 통과합니다.
*/
test("renders webrtc title", () => {
  // 1. App 컴포넌트 렌더링
  render(<App />);

  // 2. "WebRTC 1:N 화상" 이라는 텍스트가 포함된 요소 찾기
  const titleElement = screen.getByText(/WebRTC 1:N 화상/i);

  // 3. 그 요소가 실제로 문서 안에 있는지(expect...toBeInTheDocument) 확인
  expect(titleElement).toBeInTheDocument();
});
