// WebView에 넣는 스크립트 문자열을 만든다. 의존성이 없어 node 테스트에서 그대로 불러 쓴다.
// localStorage 키는 웹의 src/shared/api/authTokens.ts와 같아야 한다.

import type { RefreshReply } from './protocol'

const ACCESS_TOKEN_KEY = 'pinit.accessToken'
const LOGOUT_MARKER_KEY = 'pinit.logoutMarker'

/**
 * 페이지 스크립트가 돌기 전에 실행한다. 웹이 첫 화면부터 앱과 같은 회원으로 뜨게,
 * 앱의 access token을 웹의 저장소에 넣는다. 앱이 로그아웃 상태면 웹에 남은 토큰을 지운다.
 * 이전 회원의 토큰이 WebView 저장소에 남아 다른 회원의 화면이 보이는 일을 막는다.
 * 웹 앱의 출처가 아니면 아무것도 하지 않는다. 토큰이 다른 사이트의 저장소에 들어가면 안 된다.
 */
export const bootScript = (accessToken: string | null, webOrigin: string) => `(function () {
  try {
    if (window.location.origin !== ${JSON.stringify(webOrigin)}) return;
    var token = ${JSON.stringify(accessToken)};
    if (token) {
      window.localStorage.setItem(${JSON.stringify(ACCESS_TOKEN_KEY)}, token);
      window.localStorage.removeItem(${JSON.stringify(LOGOUT_MARKER_KEY)});
    } else {
      window.localStorage.removeItem(${JSON.stringify(ACCESS_TOKEN_KEY)});
    }
  } catch (error) {}
})();
true;`

/** 웹이 등록해 둔 window.__pinitNativeReply로 갱신 결과를 돌려준다. */
export const refreshReplyScript = (reply: RefreshReply, webOrigin: string) => `(function () {
  if (window.location.origin !== ${JSON.stringify(webOrigin)}) return;
  if (typeof window.__pinitNativeReply === 'function') window.__pinitNativeReply(${JSON.stringify(reply)});
})();
true;`
