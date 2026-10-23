export const MCP_SERVER_NAME = 'pinit'

// 서버 주소만 등록하면 클라이언트가 OAuth로 브라우저 로그인·동의를 띄운다.
export const buildClaudeCodeCommand = (serverUrl: string) =>
  `claude mcp add --transport http ${MCP_SERVER_NAME} ${serverUrl}`

/** 연결된 앱의 기기 수 배지. 백엔드가 connectionCount를 주지 않거나 1 이하면 표시하지 않는다. */
export const formatConnectionCount = (connectionCount: unknown) =>
  typeof connectionCount === 'number' && Number.isInteger(connectionCount) && connectionCount > 1
    ? `기기 ${connectionCount}개`
    : null
