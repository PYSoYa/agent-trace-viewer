import { getDb } from "./client";
import { projectKey } from "../redact";
import { cacheHitRate, type TokenUsage } from "../trace/types";

export type SessionRow = {
  id: string;
  agentId: string | null;
  source: string;
  projectSlug: string;
  projectName: string;
  gitBranch: string | null;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string;
  durationMs: number;
  activeMs: number;
  models: string[];
  /** 이 세션 자체의 사용량 (서브에이전트 제외) */
  tokens: TokenUsage;
  cacheHitRate: number;
  costUsd: number;
  unpricedModels: string[];
  toolCallCount: number;
  errorCount: number;
  stepCount: number;
  /** 딸린 서브에이전트 수와 그 합계 */
  subagentCount: number;
  subagentCostUsd: number;
  subagentOutputTokens: number;
  /** 서브에이전트까지 포함한 실제 세션 비용 */
  totalCostUsd: number;
};

type RawSession = {
  id: string;
  agent_id: string | null;
  source: string;
  project_slug: string;
  project_name: string;
  git_branch: string | null;
  title: string | null;
  first_prompt: string | null;
  started_at: string;
  duration_ms: number;
  active_ms: number;
  models: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  cost_usd: number;
  unpriced_models: string;
  tool_call_count: number;
  error_count: number;
  step_count: number;
  subagent_count: number;
  subagent_cost: number;
  subagent_output: number;
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function toRow(r: RawSession): SessionRow {
  const tokens: TokenUsage = {
    input: r.input_tokens,
    output: r.output_tokens,
    cacheWrite5m: r.cache_write_5m,
    cacheWrite1h: r.cache_write_1h,
    cacheRead: r.cache_read,
  };
  const models = parseJsonArray(r.models);
  return {
    id: r.id,
    agentId: r.agent_id,
    source: r.source,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    gitBranch: r.git_branch,
    title: r.title,
    firstPrompt: r.first_prompt,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    activeMs: r.active_ms,
    models,
    tokens,
    cacheHitRate: cacheHitRate(tokens),
    costUsd: r.cost_usd,
    unpricedModels: parseJsonArray(r.unpriced_models),
    toolCallCount: r.tool_call_count,
    errorCount: r.error_count,
    stepCount: r.step_count,
    subagentCount: r.subagent_count ?? 0,
    subagentCostUsd: r.subagent_cost ?? 0,
    subagentOutputTokens: r.subagent_output ?? 0,
    totalCostUsd: r.cost_usd + (r.subagent_cost ?? 0),
  };
}

/** 서브에이전트 합계를 부모 행에 붙인 공통 SELECT. WHERE는 호출부에서 만든다 */
const SELECT_BASE = `
  SELECT s.id, s.agent_id, s.source, s.project_slug, s.project_name, s.git_branch, s.title, s.first_prompt,
         s.started_at, s.duration_ms, s.active_ms, s.models,
         s.input_tokens, s.output_tokens, s.cache_write_5m, s.cache_write_1h, s.cache_read,
         s.cost_usd, s.unpriced_models, s.tool_call_count, s.error_count, s.step_count,
         COALESCE(sub.n, 0)    AS subagent_count,
         COALESCE(sub.cost, 0) AS subagent_cost,
         COALESCE(sub.out, 0)  AS subagent_output
  FROM sessions s
  LEFT JOIN (
    SELECT parent_session_id AS p, COUNT(*) AS n,
           SUM(cost_usd) AS cost, SUM(output_tokens) AS out
    FROM sessions WHERE parent_session_id IS NOT NULL
    GROUP BY parent_session_id
  ) sub ON sub.p = s.id
`;

/**
 * 목록에 세울 세션 조건.
 * 부모가 인덱싱되지 않은 고아 서브에이전트는 숨기지 않고 최상위로 올려 데이터 유실을 막는다.
 * 괄호가 없으면 뒤에 AND가 붙을 때 OR보다 먼저 묶여 필터가 무력화된다.
 */
const TOP_LEVEL = `(s.parent_session_id IS NULL
   OR s.parent_session_id NOT IN (SELECT id FROM sessions))`;

/**
 * 프로젝트는 이름으로 묶는다.
 * 같은 저장소라도 Claude Code는 경로 슬러그를, Codex는 cwd를 쓰기 때문에
 * 슬러그로 나누면 한 프로젝트가 소스별로 쪼개져 보인다.
 */
export function listSessions(projectName?: string): SessionRow[] {
  const db = getDb();
  const rows = projectName
    ? db
        .prepare(
          `${SELECT_BASE} WHERE ${TOP_LEVEL} AND s.project_name = ? ORDER BY s.started_at DESC`,
        )
        .all(projectName)
    : db.prepare(`${SELECT_BASE} WHERE ${TOP_LEVEL} ORDER BY s.started_at DESC`).all();
  return (rows as unknown as RawSession[]).map(toRow);
}

/**
 * URL에 실린 불투명 키를 실제 슬러그로 되돌린다.
 * 프로젝트 수가 많지 않아 전부 훑어도 된다.
 */
export function resolveProjectKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const db = getDb();
  const rows = db.prepare("SELECT DISTINCT project_name FROM sessions").all() as unknown as {
    project_name: string;
  }[];
  return rows.find((r) => projectKey(r.project_name) === key)?.project_name;
}

export type StepRow = {
  uuid: string;
  seq: number;
  kind: string;
  timestamp: string;
  model: string | null;
  text: string | null;
  toolName: string | null;
  filePath: string | null;
  toolInput: string | null;
  toolResult: string | null;
  isError: boolean;
  outputTokens: number | null;
  /** 다음 스텝까지의 간격. 마지막 스텝은 null */
  gapMs: number | null;
};

/**
 * tool_result 하나가 49만 자까지 나온다. 통째로 내려보내면 HTML이 수 MB가 되므로
 * DB에서 읽는 시점에 자른다. 원문 전체는 파일에 그대로 있고 여기서는 미리보기만 다룬다.
 */
const MAX_TEXT = 4000;

export function countSteps(sessionId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM steps WHERE session_id = ?")
    .get(sessionId) as unknown as { n: number };
  return row.n;
}

export function getSession(id: string): SessionRow | null {
  const db = getDb();
  const row = db.prepare(`${SELECT_BASE} WHERE s.id = ?`).get(id);
  return row ? toRow(row as unknown as RawSession) : null;
}

export function listSteps(sessionId: string, offset: number, limit: number): StepRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT uuid, seq, kind, timestamp, model,
              substr(text, 1, ${MAX_TEXT})        AS text,
              tool_name, file_path,
              substr(tool_input, 1, ${MAX_TEXT})  AS tool_input,
              substr(tool_result, 1, ${MAX_TEXT}) AS tool_result,
              LENGTH(text)        AS text_len,
              LENGTH(tool_input)  AS tool_input_len,
              LENGTH(tool_result) AS tool_result_len,
              is_error, output_tokens
       FROM steps WHERE session_id = ? ORDER BY seq LIMIT ? OFFSET ?`,
    )
    .all(sessionId, limit, offset) as unknown as {
    uuid: string;
    seq: number;
    kind: string;
    timestamp: string;
    model: string | null;
    text: string | null;
    tool_name: string | null;
    file_path: string | null;
    tool_input: string | null;
    tool_result: string | null;
    text_len: number | null;
    tool_input_len: number | null;
    tool_result_len: number | null;
    is_error: number;
    output_tokens: number | null;
  }[];

  return rows.map((r, i) => {
    const next = rows[i + 1];
    const gapMs =
      next && r.timestamp && next.timestamp
        ? Math.max(0, Date.parse(next.timestamp) - Date.parse(r.timestamp))
        : null;
    return {
      uuid: r.uuid,
      seq: r.seq,
      kind: r.kind,
      timestamp: r.timestamp,
      model: r.model,
      text: withTruncationNote(r.text, r.text_len),
      toolName: r.tool_name,
      filePath: r.file_path,
      toolInput: withTruncationNote(r.tool_input, r.tool_input_len),
      toolResult: withTruncationNote(r.tool_result, r.tool_result_len),
      isError: r.is_error === 1,
      outputTokens: r.output_tokens,
      gapMs: Number.isFinite(gapMs) ? gapMs : null,
    };
  });
}

function withTruncationNote(value: string | null, fullLength: number | null): string | null {
  if (value === null) return null;
  if (fullLength !== null && fullLength > MAX_TEXT) {
    return `${value}\n\n… showing ${MAX_TEXT.toLocaleString()} of ${fullLength.toLocaleString()} characters`;
  }
  return value;
}

export type SubagentRow = {
  id: string;
  agentId: string | null;
  outputTokens: number;
  costUsd: number;
  stepCount: number;
  toolCallCount: number;
};

export function listSubagents(parentId: string): SubagentRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, agent_id, output_tokens, cost_usd, step_count, tool_call_count
       FROM sessions WHERE parent_session_id = ? ORDER BY cost_usd DESC`,
    )
    .all(parentId) as unknown as {
    id: string;
    agent_id: string | null;
    output_tokens: number;
    cost_usd: number;
    step_count: number;
    tool_call_count: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    stepCount: r.step_count,
    toolCallCount: r.tool_call_count,
  }));
}

export type SearchHit = {
  sessionId: string;
  sessionTitle: string | null;
  projectSlug: string;
  projectName: string;
  startedAt: string;
  uuid: string;
  seq: number;
  kind: string;
  toolName: string | null;
  /** 일치 부분에 «»가 둘러진 발췌 */
  snippet: string;
  /** 타임라인에서 이 스텝이 있는 쪽 번호를 계산하기 위한 순번 */
  rowIndex: number;
};

/**
 * 사용자 입력을 FTS5 질의로 바꾼다.
 * 날것으로 넘기면 `AND`, `*`, `"` 같은 문자가 문법으로 해석돼 구문 오류가 나거나
 * 의도하지 않은 검색이 된다. 각 낱말을 따옴표로 감싸 리터럴로 만들고 AND로 잇는다.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // FTS5 문자열 리터럴에서 "는 ""로 이스케이프한다
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.length ? terms.join(" AND ") : null;
}

export function searchSteps(input: string, limit = 60): SearchHit[] {
  const match = toFtsQuery(input);
  if (!match) return [];
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT f.session_id, f.uuid, f.seq, f.kind, f.tool_name,
                snippet(steps_fts, 0, '«', '»', '…', 12) AS snippet,
                (SELECT COUNT(*) FROM steps st
                  WHERE st.session_id = f.session_id AND st.seq < f.seq) AS row_index,
                s.title, s.project_slug, s.project_name, s.started_at
         FROM steps_fts f
         JOIN sessions s ON s.id = f.session_id
         WHERE steps_fts MATCH ?
         ORDER BY bm25(steps_fts), s.started_at DESC
         LIMIT ?`,
      )
      .all(match, limit) as unknown as {
      session_id: string;
      uuid: string;
      seq: number;
      kind: string;
      tool_name: string | null;
      snippet: string;
      row_index: number;
      title: string | null;
      project_slug: string;
      project_name: string;
      started_at: string;
    }[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      sessionTitle: r.title,
      projectSlug: r.project_slug,
      projectName: r.project_name,
      startedAt: r.started_at,
      uuid: r.uuid,
      seq: r.seq,
      kind: r.kind,
      toolName: r.tool_name,
      snippet: r.snippet,
      rowIndex: r.row_index,
    }));
  } catch {
    // 문법상 인정되지 않는 입력은 결과 없음으로 다룬다
    return [];
  }
}

export function countSearchHits(input: string): number {
  const match = toFtsQuery(input);
  if (!match) return 0;
  const db = getDb();
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM steps_fts WHERE steps_fts MATCH ?")
      .get(match) as unknown as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

export type SessionPr = {
  number: number;
  url: string;
  repository: string;
};

export function listSessionPrs(sessionId: string): SessionPr[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pr_number, pr_url, pr_repository FROM session_prs
       WHERE session_id = ? ORDER BY first_seen_at`,
    )
    .all(sessionId) as unknown as {
    pr_number: number;
    pr_url: string;
    pr_repository: string;
  }[];
  return rows.map((r) => ({
    number: r.pr_number,
    url: r.pr_url,
    repository: r.pr_repository,
  }));
}

/** 목록에서 세션마다 개별 조회하지 않도록 한 번에 가져온다 */
export function prCountsBySession(): Map<string, number> {
  const db = getDb();
  const rows = db
    .prepare("SELECT session_id, COUNT(*) AS n FROM session_prs GROUP BY session_id")
    .all() as unknown as { session_id: string; n: number }[];
  return new Map(rows.map((r) => [r.session_id, r.n]));
}

export type TouchedFile = {
  path: string;
  writes: number;
  reads: number;
};

/**
 * 세션이 건드린 파일. file-history 레코드 대신 이미 파싱된 툴 인자에서 뽑는다.
 * Edit/Write는 변경, Read는 열람으로 센다.
 */
export function listTouchedFiles(sessionId: string, limit = 200): TouchedFile[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT file_path,
              SUM(CASE WHEN tool_name IN ('Edit','Write','MultiEdit','NotebookEdit') THEN 1 ELSE 0 END) AS writes,
              SUM(CASE WHEN tool_name = 'Read' THEN 1 ELSE 0 END) AS reads
       FROM steps
       WHERE session_id = ? AND kind = 'tool_call' AND file_path IS NOT NULL
       GROUP BY file_path
       ORDER BY writes DESC, reads DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as unknown as {
    file_path: string;
    writes: number;
    reads: number;
  }[];
  return rows.map((r) => ({ path: r.file_path, writes: r.writes, reads: r.reads }));
}

export type ToolStat = {
  toolName: string;
  calls: number;
  errors: number;
  errorRate: number;
  sessions: number;
};

/**
 * 툴 호출을 같은 세션 안의 tool_use_id로 결과와 이어 실패율을 낸다.
 * 결과가 없는 호출(세션이 중간에 끊긴 경우)은 실패로 세지 않는다.
 */
export function listToolStats(): ToolStat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.tool_name AS tool_name,
              COUNT(*) AS calls,
              SUM(CASE WHEN r.is_error = 1 THEN 1 ELSE 0 END) AS errors,
              COUNT(DISTINCT c.session_id) AS sessions
       FROM steps c
       LEFT JOIN steps r
         ON r.session_id = c.session_id
        AND r.tool_use_id = c.tool_use_id
        AND r.kind = 'tool_result'
       WHERE c.kind = 'tool_call' AND c.tool_use_id IS NOT NULL
       GROUP BY c.tool_name
       ORDER BY calls DESC`,
    )
    .all() as unknown as {
    tool_name: string;
    calls: number;
    errors: number;
    sessions: number;
  }[];
  return rows.map((r) => ({
    toolName: r.tool_name,
    calls: r.calls,
    errors: r.errors ?? 0,
    errorRate: r.calls ? (r.errors ?? 0) / r.calls : 0,
    sessions: r.sessions,
  }));
}

export type ModelStat = {
  model: string;
  steps: number;
  outputTokens: number;
};

export function listModelStats(): ModelStat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT model, COUNT(*) AS steps, COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM steps WHERE model IS NOT NULL AND model != '<synthetic>'
       GROUP BY model ORDER BY output_tokens DESC`,
    )
    .all() as unknown as { model: string; steps: number; output_tokens: number }[];
  return rows.map((r) => ({
    model: r.model,
    steps: r.steps,
    outputTokens: r.output_tokens,
  }));
}

export type ProjectStat = {
  name: string;
  sessions: number;
  costUsd: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCalls: number;
  errors: number;
};

/** 서브에이전트 비용까지 포함한 프로젝트별 합계 */
export function listProjectStats(): ProjectStat[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_name,
              SUM(CASE WHEN parent_session_id IS NULL THEN 1 ELSE 0 END) AS sessions,
              SUM(cost_usd)        AS cost_usd,
              SUM(output_tokens)   AS output_tokens,
              SUM(cache_read)      AS cache_read,
              SUM(tool_call_count) AS tool_calls,
              SUM(error_count)     AS errors
       FROM sessions GROUP BY project_name ORDER BY cost_usd DESC`,
    )
    .all() as unknown as {
    project_slug: string;
    project_name: string;
    sessions: number;
    cost_usd: number;
    output_tokens: number;
    cache_read: number;
    tool_calls: number;
    errors: number;
  }[];
  return rows.map((r) => ({
    name: r.project_name,
    sessions: r.sessions,
    costUsd: r.cost_usd ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheReadTokens: r.cache_read ?? 0,
    toolCalls: r.tool_calls ?? 0,
    errors: r.errors ?? 0,
  }));
}

export type SourceSummary = { source: string; sessions: number };

export function listSources(): SourceSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT source, COUNT(*) AS n FROM sessions
       WHERE parent_session_id IS NULL GROUP BY source ORDER BY n DESC`,
    )
    .all() as unknown as { source: string; n: number }[];
  return rows.map((r) => ({ source: r.source, sessions: r.n }));
}

export type ProjectSummary = {
  name: string;
  sessionCount: number;
  costUsd: number;
};

export function listProjects(): ProjectSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_name,
              SUM(CASE WHEN parent_session_id IS NULL THEN 1 ELSE 0 END) AS session_count,
              SUM(cost_usd) AS cost_usd
       FROM sessions GROUP BY project_name ORDER BY cost_usd DESC`,
    )
    .all() as unknown as {
    project_name: string;
    session_count: number;
    cost_usd: number;
  }[];
  return rows.map((r) => ({
    name: r.project_name,
    sessionCount: r.session_count,
    costUsd: r.cost_usd ?? 0,
  }));
}
