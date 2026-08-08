import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** 인덱스 저장 위치. 컨테이너에서는 볼륨을 붙여 재시작해도 남게 한다 */
const DATA_DIR = process.env.TRACE_DATA_DIR || join(process.cwd(), ".data");
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
  active_ms       INTEGER NOT NULL,
  models          TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cache_write_5m  INTEGER NOT NULL,
  cache_write_1h  INTEGER NOT NULL,
  cache_read      INTEGER NOT NULL,
  cost_usd        REAL    NOT NULL,
  unpriced_models TEXT    NOT NULL,
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
  file_path      TEXT,
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

CREATE TABLE IF NOT EXISTS session_prs (
  session_id    TEXT NOT NULL,
  pr_url        TEXT NOT NULL,
  pr_number     INTEGER NOT NULL,
  pr_repository TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (session_id, pr_url)
);

/*
 * 스텝 본문 검색용 인덱스.
 * steps에서 파생되지만 external content 테이블로 묶지 않았다 — 본문을 그대로 넣지 않고
 * 길이를 잘라 넣기 때문이다(tool_result 하나가 49만 자까지 나온다).
 * unicode61은 공백과 구두점에서 끊으므로 한글 어절, 영문, 경로 조각이 모두 잡힌다.
 */
CREATE VIRTUAL TABLE IF NOT EXISTS steps_fts USING fts5(
  body,
  session_id UNINDEXED,
  uuid       UNINDEXED,
  seq        UNINDEXED,
  kind       UNINDEXED,
  tool_name  UNINDEXED,
  tokenize = 'unicode61'
);

CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_steps_file        ON steps (file_path);
CREATE INDEX IF NOT EXISTS idx_prs_url           ON session_prs (pr_url);
CREATE INDEX IF NOT EXISTS idx_sessions_parent   ON sessions (parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_file     ON sessions (file_path);
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions (project_slug);
CREATE INDEX IF NOT EXISTS idx_steps_session_seq ON steps (session_id, seq);
`;

/**
 * 스키마를 바꿀 때마다 올린다.
 * 이 DB는 jsonl에서 다시 만들 수 있는 캐시라, 버전이 다르면 조용히 어긋난 채로 두는 대신 버리고 새로 만든다.
 */
const SCHEMA_VERSION = 6;

const DROP_ALL = `
DROP TABLE IF EXISTS steps_fts;
DROP TABLE IF EXISTS session_prs;
DROP TABLE IF EXISTS steps;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS indexed_files;
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

  const found = (conn.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  if (found !== SCHEMA_VERSION) {
    // indexed_files까지 지우므로 다음 인덱싱에서 전체가 다시 파싱된다
    conn.exec(DROP_ALL);
    conn.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  conn.exec(SCHEMA);
  db = conn;
  return conn;
}
