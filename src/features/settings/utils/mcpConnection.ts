export const MCP_SERVER_NAME = 'pinit'
export const PAT_PLACEHOLDER = '<PAT>'

export const buildClaudeCodeCommand = (serverUrl: string, token: string = PAT_PLACEHOLDER) =>
  `claude mcp add --transport http ${MCP_SERVER_NAME} ${serverUrl} --header "Authorization: Bearer ${token}"`

// Claude Code의 .mcp.json 등 mcpServers 설정 파일을 읽는 클라이언트용
export const buildMcpJsonConfig = (serverUrl: string, token: string = PAT_PLACEHOLDER) =>
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
