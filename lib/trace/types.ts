/** 어댑터 중립 트레이스 모델. Claude Code 외의 소스도 이 모양으로 정규화한다. */

export type TokenUsage = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/** 이 턴이 실제로 모델에 태운 프롬프트 크기 (캐시 히트율 분모) */
export function promptTokens(u: TokenUsage): number {
  return u.input + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;
}

export function cacheHitRate(u: TokenUsage): number {
  const total = promptTokens(u);
  return total === 0 ? 0 : u.cacheRead / total;
}

export type StepKind =
  | "user_prompt"
  | "assistant_text"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "system";

export type TraceStep = {
  uuid: string;
  parentUuid: string | null;
  /** 파일 내 등장 순서. 타임스탬프가 같은 스텝의 정렬을 위해 필요 */
  seq: number;
  kind: StepKind;
  timestamp: string;
  model: string | null;
  text: string | null;
  toolName: string | null;
  toolUseId: string | null;
  /** 툴 인자에서 뽑아낸 대상 파일. 세션이 건드린 파일을 모으는 데 쓴다 */
  filePath: string | null;
  /** JSON 문자열. 원문 그대로 보관해 상세 화면에서 펼친다 */
  toolInput: string | null;
  toolResult: string | null;
  isError: boolean;
  isSidechain: boolean;
  /** 이 스텝이 속한 assistant 메시지의 usage. 중복 계상 방지를 위해 대표 스텝에만 채운다 */
  tokens: TokenUsage | null;
  durationMs: number | null;
};

export type TraceSession = {
  /** 서브에이전트는 `${sessionId}:${agentId}` 형태의 합성 ID를 쓴다 */
  id: string;
  /** 서브에이전트일 때 부모 세션 ID. 최상위 세션은 null */
  parentSessionId: string | null;
  agentId: string | null;
  source: string;
  /** ~/.claude/projects 아래 디렉터리명 (원문 유지) */
  projectSlug: string;
  /** 표시용 이름. cwd가 있으면 그 basename */
  projectName: string;
  filePath: string;
  cwd: string | null;
  gitBranch: string | null;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string;
  endedAt: string;
  /** 첫 기록과 마지막 기록 사이의 벽시계 간격. 며칠 뒤 이어가면 그만큼 커진다 */
  durationMs: number;
  /** 유휴를 뺀 실제 작업 시간 */
  activeMs: number;
  models: string[];
  tokens: TokenUsage;
  costUsd: number;
  toolCallCount: number;
  errorCount: number;
  stepCount: number;
};

/** 세션이 만들어낸 PR. Claude Code가 pr-link 레코드로 남긴다 */
export type PrLink = {
  number: number;
  url: string;
  repository: string;
  firstSeenAt: string;
};

export type ParsedTrace = {
  session: TraceSession;
  steps: TraceStep[];
  prLinks: PrLink[];
};

/** 파일을 실제로 바꾸는 툴. 나머지(Read 등)는 열람으로 본다 */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function isWriteTool(toolName: string | null): boolean {
  return toolName !== null && WRITE_TOOLS.has(toolName);
}
