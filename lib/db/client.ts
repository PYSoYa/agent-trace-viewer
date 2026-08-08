import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data");
const DB_PATH = join(DATA_DIR, "traces.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS indexed_files (
  path       TEXT PRIMARY KEY,
  mtime_ms   REAL    NOT NULL,
  size_bytes INTEGER NOT NULL,
  indexed_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  parent_session_id TEXT,
  agent_id          TEXT,
  source          TEXT NOT NULL,
  project_slug    TEXT NOT NULL,
  project_name    TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  cwd             TEXT,
  git_branch      TEXT,
  title           TEXT,
  first_prompt    TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  models          TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cache_write_5m  INTEGER NOT NULL,
  cache_write_1h  INTEGER NOT NULL,
  cache_read      INTEGER NOT NULL,
  cost_usd        REAL    NOT NULL,
  tool_call_count INTEGER NOT NULL,
  error_count     INTEGER NOT NULL,
  step_count      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  session_id     TEXT NOT NULL,
  uuid           TEXT NOT NULL,
  parent_uuid    TEXT,
  seq            INTEGER NOT NULL,
  kind           TEXT NOT NULL,
  timestamp      TEXT NOT NULL,
  model          TEXT,
  text           TEXT,
  tool_name      TEXT,
  tool_use_id    TEXT,
  tool_input     TEXT,
  tool_result    TEXT,
  is_error       INTEGER NOT NULL,
  is_sidechain   INTEGER NOT NULL,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cache_write_5m INTEGER,
  cache_write_1h INTEGER,
  cache_read     INTEGER,
  duration_ms    INTEGER,
  PRIMARY KEY (session_id, uuid)
);

CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_parent   ON sessions (parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_file     ON sessions (file_path);
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions (project_slug);
CREATE INDEX IF NOT EXISTS idx_steps_session_seq ON steps (session_id, seq);
`;

let db: DatabaseSync | null = null;

/** 프로세스당 하나의 연결을 재사용한다. dev 서버의 HMR에도 살아남도록 모듈 스코프에 보관 */
export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  // 읽기 중 인덱싱이 겹쳐도 막히지 않도록
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA synchronous = NORMAL");
  conn.exec(SCHEMA);
  db = conn;
  return conn;
}
