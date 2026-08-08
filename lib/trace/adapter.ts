import type { ParsedTrace } from "./types";

export type TraceFile = {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  /** 프로젝트 구분자. Claude Code는 ~/.claude/projects 아래 디렉터리명 */
  projectSlug: string;
  /**
   * 서브에이전트 트레이스일 때만 채워진다.
   * Claude Code는 서브에이전트 로그를 <프로젝트>/<세션ID>/subagents/agent-*.jsonl에 두고
   * 그 안의 sessionId는 부모와 동일하다 — 부모 행을 덮어쓰지 않도록 반드시 분리해야 한다.
   */
  agentId?: string;
};

/**
 * 트레이스 소스 어댑터.
 * Claude Code jsonl이 첫 구현이고, Codex나 자작 에이전트 로그는 이 인터페이스만 맞추면 붙는다.
 */
export interface TraceAdapter {
  readonly source: string;
  /** 인덱싱 대상 파일 목록. 내용은 읽지 않고 메타데이터만 반환한다 */
  discover(): Promise<TraceFile[]>;
  /** 한 파일에 여러 세션이 섞여 있을 수 있어 배열을 반환한다 */
  parse(file: TraceFile): Promise<ParsedTrace[]>;
}
