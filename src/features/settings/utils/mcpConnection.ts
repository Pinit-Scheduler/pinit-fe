export const MCP_SERVER_NAME = 'pinit'
export const PAT_PLACEHOLDER = '<PAT>'

// 기본 경로: 서버 주소만 등록하면 클라이언트가 OAuth로 브라우저 로그인·동의를 띄운다.
export const buildClaudeCodeCommand = (serverUrl: string) =>
  `claude mcp add --transport http ${MCP_SERVER_NAME} ${serverUrl}`

// Claude Code의 .mcp.json 등 mcpServers 설정 파일을 읽는 클라이언트용
export const buildMcpJsonConfig = (serverUrl: string) =>
  JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: serverUrl } } }, null, 2)

// 고급: OAuth를 지원하지 않는 클라이언트·자동화는 개인 액세스 토큰을 헤더로 보낸다.
export const buildClaudeCodeCommandWithToken = (serverUrl: string, token: string = PAT_PLACEHOLDER) =>
  `${buildClaudeCodeCommand(serverUrl)} --header "Authorization: Bearer ${token}"`

export const buildMcpJsonConfigWithToken = (serverUrl: string, token: string = PAT_PLACEHOLDER) =>
  JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: serverUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
