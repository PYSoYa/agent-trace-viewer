import { getDb } from "./client";
import { cacheHitRate, type TokenUsage } from "../trace/types";

export type SessionRow = {
  id: string;
  agentId: string | null;
  projectSlug: string;
  projectName: string;
  gitBranch: string | null;
  title: string | null;
  firstPrompt: string | null;
  startedAt: string;
  durationMs: number;
  models: string[];
  /** 이 세션 자체의 사용량 (서브에이전트 제외) */
  tokens: TokenUsage;
  cacheHitRate: number;
  costUsd: number;
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
  project_slug: string;
  project_name: string;
  git_branch: string | null;
  title: string | null;
  first_prompt: string | null;
  started_at: string;
  duration_ms: number;
  models: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  cost_usd: number;
  tool_call_count: number;
  error_count: number;
  step_count: number;
  subagent_count: number;
  subagent_cost: number;
  subagent_output: number;
};

function toRow(r: RawSession): SessionRow {
  const tokens: TokenUsage = {
    input: r.input_tokens,
    output: r.output_tokens,
    cacheWrite5m: r.cache_write_5m,
    cacheWrite1h: r.cache_write_1h,
    cacheRead: r.cache_read,
  };
  let models: string[] = [];
  try {
    models = JSON.parse(r.models) as string[];
  } catch {
    models = [];
  }
  return {
    id: r.id,
    agentId: r.agent_id,
    projectSlug: r.project_slug,
    projectName: r.project_name,
    gitBranch: r.git_branch,
    title: r.title,
    firstPrompt: r.first_prompt,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    models,
    tokens,
    cacheHitRate: cacheHitRate(tokens),
    costUsd: r.cost_usd,
    toolCallCount: r.tool_call_count,
    errorCount: r.error_count,
    stepCount: r.step_count,
    subagentCount: r.subagent_count ?? 0,
    subagentCostUsd: r.subagent_cost ?? 0,
    subagentOutputTokens: r.subagent_output ?? 0,
    totalCostUsd: r.cost_usd + (r.subagent_cost ?? 0),
  };
}

/**
 * 서브에이전트를 부모에 롤업한다.
 * 부모가 인덱싱되지 않은 고아 서브에이전트는 숨기지 않고 최상위로 올려 데이터 유실을 막는다.
 */
const SELECT_TOP_LEVEL = `
  SELECT s.id, s.agent_id, s.project_slug, s.project_name, s.git_branch, s.title, s.first_prompt,
         s.started_at, s.duration_ms, s.models,
         s.input_tokens, s.output_tokens, s.cache_write_5m, s.cache_write_1h, s.cache_read,
         s.cost_usd, s.tool_call_count, s.error_count, s.step_count,
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
  WHERE s.parent_session_id IS NULL
     OR s.parent_session_id NOT IN (SELECT id FROM sessions)
`;

export function listSessions(projectSlug?: string): SessionRow[] {
  const db = getDb();
  const rows = projectSlug
    ? db
        .prepare(`${SELECT_TOP_LEVEL} AND s.project_slug = ? ORDER BY s.started_at DESC`)
        .all(projectSlug)
    : db.prepare(`${SELECT_TOP_LEVEL} ORDER BY s.started_at DESC`).all();
  return (rows as unknown as RawSession[]).map(toRow);
}

export type ProjectSummary = {
  slug: string;
  name: string;
  sessionCount: number;
  costUsd: number;
};

export function listProjects(): ProjectSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT project_slug,
              MIN(project_name) AS project_name,
              SUM(CASE WHEN parent_session_id IS NULL THEN 1 ELSE 0 END) AS session_count,
              SUM(cost_usd) AS cost_usd
       FROM sessions GROUP BY project_slug ORDER BY cost_usd DESC`,
    )
    .all() as unknown as {
    project_slug: string;
    project_name: string;
    session_count: number;
    cost_usd: number;
  }[];
  return rows.map((r) => ({
    slug: r.project_slug,
    name: r.project_name,
    sessionCount: r.session_count,
    costUsd: r.cost_usd ?? 0,
  }));
}
