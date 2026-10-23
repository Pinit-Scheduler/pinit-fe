import { buildClaudeCodeCommand, buildMcpJsonConfig } from '../utils/mcpConnection'
import { MCP_SERVER_URL } from '../utils/mcpServerUrl'
import CopyableCode from './CopyableCode'
import './McpConnectionGuide.css'

const McpConnectionGuide = () => (
  <section className="settings__card mcp-guide" aria-label="MCP 연결 가이드">
    <h2>AI 클라이언트 연결 (MCP)</h2>
    <p className="settings__description">
      AI 클라이언트에 Pinit 서버 주소만 등록하면 돼요. 처음 연결할 때 브라우저에서 Pinit 로그인과 동의 화면이 열리고, 허용하면
      연결이 끝나요.
    </p>

    <div className="mcp-guide__step">
      <p className="settings__label">서버 URL</p>
      <CopyableCode label="MCP 서버 URL" value={MCP_SERVER_URL} />
    </div>

    <div className="mcp-guide__step">
      <p className="settings__label">Claude Code</p>
      <p className="settings__description">
        터미널에서 아래 명령을 실행한 뒤, Claude Code에서 <code>/mcp</code>로 pinit을 골라 인증하세요.
      </p>
      <CopyableCode label="Claude Code 명령" value={buildClaudeCodeCommand(MCP_SERVER_URL)} multiline rows={3} />
    </div>

    <div className="mcp-guide__step">
      <p className="settings__label">Claude.ai</p>
      <ol className="mcp-guide__steps">
        <li>설정 &gt; 커넥터에서 커스텀 커넥터를 추가하고 위 서버 URL을 입력해요.</li>
        <li>연결을 누르면 열리는 Pinit 화면에서 로그인해요.</li>
        <li>동의 화면에서 권한을 확인하고 허용해요.</li>
      </ol>
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
        동의 화면에서 <strong>일정·작업 보기</strong>는 항상 허용되고, <strong>만들기·수정·상태 변경</strong>은 체크를 해제해 뺄 수
        있어요.
      </li>
      <li>AI 클라이언트는 Pinit MCP로 작업이나 일정을 삭제할 수 없어요. 삭제는 앱에서 직접 해주세요.</li>
      <li>연결한 앱은 아래 연결된 앱에서 확인하고 언제든 끊을 수 있어요.</li>
    </ul>
  </section>
)

export default McpConnectionGuide
