import { buildApiUrl } from '@shared/api/config'

// 운영 환경에서는 https://mono.pinit.go-gradually.me/mcp
export const MCP_SERVER_URL = buildApiUrl('/mcp', '')
