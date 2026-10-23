import { buildApiUrl } from '@shared/api/config'
import { PAT_PLACEHOLDER, buildClaudeCodeCommand, buildMcpJsonConfig } from '../utils/mcpConnection'
import CopyableCode from './CopyableCode'
import './McpConnectionGuide.css'

// 운영 환경에서는 https://mono.pinit.go-gradually.me/mcp
const MCP_SERVER_URL = buildApiUrl('/mcp', '')

const McpConnectionGuide = () => (
  <section className="settings__card mcp-guide" aria-label="MCP 연결 가이드">
    <h2>AI 클라이언트 연결 (MCP)</h2>
    <p className="settings__description">
      위에서 발급한 토큰으로 Claude Code 같은 MCP 클라이언트를 연결하면 AI가 내 작업과 일정을 조회하고 관리할 수 있어요.
      아래 예시의 <code>{PAT_PLACEHOLDER}</code> 자리에 발급받은 토큰을 넣어주세요.
    </p>

    <div className="mcp-guide__step">
      <p className="settings__label">서버 URL</p>
      <CopyableCode label="MCP 서버 URL" value={MCP_SERVER_URL} />
    </div>

    <div className="mcp-guide__step">
      <p className="settings__label">Claude Code</p>
      <p className="settings__description">터미널에서 아래 명령을 실행하세요.</p>
      <CopyableCode label="Claude Code 명령" value={buildClaudeCodeCommand(MCP_SERVER_URL)} multiline rows={4} />
    </div>

    <div className="mcp-guide__step">
      <p className="settings__label">설정 파일을 쓰는 클라이언트</p>
      <p className="settings__description">
        <code>.mcp.json</code>처럼 <code>mcpServers</code> 설정을 읽는 클라이언트에는 아래 내용을 추가하세요.
      </p>
      <CopyableCode label="MCP 설정 JSON" value={buildMcpJsonConfig(MCP_SERVER_URL)} multiline />
    </div>

    <ul className="mcp-guide__notes">
      <li>
        <strong>읽기 전용</strong> 토큰은 작업·일정 목록과 상세 조회만 할 수 있고, 생성·수정·시작/완료 같은 변경에는{' '}
        <strong>읽기 + 쓰기</strong> 토큰이 필요해요.
      </li>
      <li>AI 클라이언트는 Pinit MCP로 작업이나 일정을 삭제할 수 없어요. 삭제는 앱에서 직접 해주세요.</li>
      <li>토큰이 유출됐다면 바로 위 목록에서 폐기하세요. 폐기한 토큰은 즉시 사용할 수 없어요.</li>
    </ul>
  </section>
)

export default McpConnectionGuide
