// src/index.js

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// index.html 안의 <div id="root"></div> 에
// React 앱(App 컴포넌트)을 마운트하는 진입점
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  // StrictMode:
  // 개발 모드에서만 몇 가지 안전성 체크를 더 해주는 모드.
  // 실제 렌더가 두 번 일어나는 것처럼 보일 수 있지만
  // 배포(build) 시에는 한 번만 렌더됨.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 성능 측정용 (필수 아님)
// 필요 없으면 reportWebVitals() 호출을 제거해도 무방
reportWebVitals();
