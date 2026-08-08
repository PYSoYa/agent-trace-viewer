import { ClaudeCodeAdapter } from "../trace/adapters/claude-code";
import type { TraceAdapter, TraceFile } from "../trace/adapter";
import type { ParsedTrace, TraceStep } from "../trace/types";
import { getDb } from "./client";

const ADAPTERS: TraceAdapter[] = [new ClaudeCodeAdapter()];

export type IndexResult = {
  scanned: number;
  reindexed: number;
  removed: number;
  sessions: number;
  elapsedMs: number;
};

/** 동시 요청이 같은 파일을 두 번 파싱하지 않도록 직렬화한다 */
let inFlight: Promise<IndexResult> | null = null;

export function indexTraces(): Promise<IndexResult> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<IndexResult> {
  const startedAt = Date.now();
  const db = getDb();

  const known = new Map<string, { mtimeMs: number; sizeBytes: number }>();
  for (const row of db.prepare("SELECT path, mtime_ms, size_bytes FROM indexed_files").all()) {
    const r = row as { path: string; mtime_ms: number; size_bytes: number };
    known.set(r.path, { mtimeMs: r.mtime_ms, sizeBytes: r.size_bytes });
  }

  // 파일이 어느 어댑터에서 나왔는지 유지해야 파싱을 그 어댑터에 되돌려줄 수 있다
  const discovered: { adapter: TraceAdapter; file: TraceFile }[] = [];
  for (const adapter of ADAPTERS) {
    for (const file of await adapter.discover()) {
      discovered.push({ adapter, file });
    }
  }

  const seen = new Set(discovered.map((d) => d.file.path));
  let reindexed = 0;
  let sessionCount = 0;

  for (const { adapter, file } of discovered) {
    const prev = known.get(file.path);
    // mtime과 크기가 모두 같으면 내용이 바뀌지 않았다고 본다
    if (prev && prev.mtimeMs === file.mtimeMs && prev.sizeBytes === file.sizeBytes) {
      continue;
    }
    const traces = await adapter.parse(file);
    writeFile(file, traces);
    reindexed += 1;
    sessionCount += traces.length;
  }

  // 삭제된 파일의 세션은 목록에서 치운다
  let removed = 0;
  for (const path of known.keys()) {
    if (seen.has(path)) continue;
    deleteFile(path);
    removed += 1;
  }

  return {
    scanned: discovered.length,
    reindexed,
    removed,
    sessions: sessionCount,
    elapsedMs: Date.now() - startedAt,
  };
}

function deleteFile(path: string): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const staleSessions = "SELECT id FROM sessions WHERE file_path = ?";
    db.prepare(`DELETE FROM steps WHERE session_id IN (${staleSessions})`).run(path);
    db.prepare(`DELETE FROM steps_fts WHERE session_id IN (${staleSessions})`).run(path);
    db.prepare(`DELETE FROM session_prs WHERE session_id IN (${staleSessions})`).run(path);
    db.prepare("DELETE FROM sessions WHERE file_path = ?").run(path);
    db.prepare("DELETE FROM indexed_files WHERE path = ?").run(path);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * 검색 인덱스에 넣을 본문.
 * tool_result 하나가 49만 자까지 나오므로 잘라 넣는다 — 인덱스 크기를 통제하고,
 * 어차피 뒷부분까지 읽어야 하는 검색은 드물다.
 */
const MAX_INDEXED_CHARS = 20_000;

function searchBody(step: TraceStep): string | null {
  const parts = [step.text, step.toolInput, step.toolResult].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  if (parts.length === 0) return null;
  return parts.join("\n").slice(0, MAX_INDEXED_CHARS);
}

function writeFile(file: TraceFile, traces: ParsedTrace[]): void {
  const db = getDb();

  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, parent_session_id, agent_id, source, project_slug, project_name, file_path, cwd, git_branch,
      title, first_prompt, started_at, ended_at, duration_ms, active_ms, models,
      input_tokens, output_tokens, cache_write_5m, cache_write_1h, cache_read,
      cost_usd, tool_call_count, error_count, step_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertStep = db.prepare(`
    INSERT OR REPLACE INTO steps (
      session_id, uuid, parent_uuid, seq, kind, timestamp, model, text,
      tool_name, tool_use_id, file_path, tool_input, tool_result, is_error, is_sidechain,
      input_tokens, output_tokens, cache_write_5m, cache_write_1h, cache_read, duration_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertPr = db.prepare(`
    INSERT OR REPLACE INTO session_prs (session_id, pr_url, pr_number, pr_repository, first_seen_at)
    VALUES (?,?,?,?,?)
  `);

  const insertFts = db.prepare(`
    INSERT INTO steps_fts (body, session_id, uuid, seq, kind, tool_name)
    VALUES (?,?,?,?,?,?)
  `);

  db.exec("BEGIN");
  try {
    // 재인덱싱이므로 이 파일이 만들었던 이전 결과부터 지운다
    const staleSessions = "SELECT id FROM sessions WHERE file_path = ?";
    db.prepare(`DELETE FROM steps WHERE session_id IN (${staleSessions})`).run(file.path);
    db.prepare(`DELETE FROM steps_fts WHERE session_id IN (${staleSessions})`).run(file.path);
    db.prepare(`DELETE FROM session_prs WHERE session_id IN (${staleSessions})`).run(file.path);
    db.prepare("DELETE FROM sessions WHERE file_path = ?").run(file.path);

    for (const { session: s, steps, prLinks } of traces) {
      insertSession.run(
        s.id,
        s.parentSessionId,
        s.agentId,
        s.source,
        s.projectSlug,
        s.projectName,
        s.filePath,
        s.cwd,
        s.gitBranch,
        s.title,
        s.firstPrompt,
        s.startedAt,
        s.endedAt,
        s.durationMs,
        s.activeMs,
        JSON.stringify(s.models),
        s.tokens.input,
        s.tokens.output,
        s.tokens.cacheWrite5m,
        s.tokens.cacheWrite1h,
        s.tokens.cacheRead,
        s.costUsd,
        s.toolCallCount,
        s.errorCount,
        s.stepCount,
      );

      for (const step of steps) {
        insertStep.run(
          s.id,
          step.uuid,
          step.parentUuid,
          step.seq,
          step.kind,
          step.timestamp,
          step.model,
          step.text,
          step.toolName,
          step.toolUseId,
          step.filePath,
          step.toolInput,
          step.toolResult,
          step.isError ? 1 : 0,
          step.isSidechain ? 1 : 0,
          step.tokens?.input ?? null,
          step.tokens?.output ?? null,
          step.tokens?.cacheWrite5m ?? null,
          step.tokens?.cacheWrite1h ?? null,
          step.tokens?.cacheRead ?? null,
          step.durationMs,
        );

        const body = searchBody(step);
        if (body) {
          insertFts.run(body, s.id, step.uuid, step.seq, step.kind, step.toolName);
        }
      }

      for (const pr of prLinks) {
        insertPr.run(s.id, pr.url, pr.number, pr.repository, pr.firstSeenAt);
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO indexed_files (path, mtime_ms, size_bytes, indexed_at) VALUES (?,?,?,?)",
    ).run(file.path, file.mtimeMs, file.sizeBytes, new Date().toISOString());

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
