import type { Dirent } from "node:fs";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { costOf } from "../../pricing";
import type { TraceAdapter, TraceFile } from "../adapter";
import {
  addUsage,
  emptyUsage,
  type ParsedTrace,
  type TokenUsage,
  type TraceSession,
  type TraceStep,
} from "../types";

const DEFAULT_SESSIONS_DIR =
  process.env.CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");

/** Codex가 세션마다 붙인 이름. 첫 프롬프트보다 훨씬 읽기 좋다 */
const SESSION_INDEX = join(DEFAULT_SESSIONS_DIR, "..", "session_index.jsonl");

/** IDE가 끼워 넣는 머리말. 사용자가 친 프롬프트가 아니다 */
const IDE_PROMPT_PREFIXES = ["# Context from my IDE setup", "<user_instructions>", "<environment_context>"];

function isIdePrompt(text: string): boolean {
  const head = text.trimStart();
  return IDE_PROMPT_PREFIXES.some((p) => head.startsWith(p));
}

/**
 * Codex는 세션을 `sessions/YYYY/MM/DD/rollout-<시각>-<id>.jsonl`에 남긴다.
 *
 * Claude Code와 두 가지가 크게 다르다.
 *  - 토큰이 `token_count` 이벤트로 따로 오고, 턴별(last)과 누적(total)이 함께 실린다
 *  - `cached_input_tokens`가 `input_tokens`의 부분집합이다.
 *    Anthropic은 캐시 읽기가 별도 항목이라, 그대로 옮기면 입력을 두 번 센다
 */
type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

function toTokenUsage(u: CodexUsage | undefined): TokenUsage {
  if (!u) return emptyUsage();
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const input = num(u.input_tokens);
  const cached = Math.min(num(u.cached_input_tokens), input);
  return {
    // 캐시분을 빼야 순수 입력이 된다
    input: input - cached,
    output: num(u.output_tokens),
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: cached,
  };
}

type Accumulator = {
  steps: TraceStep[];
  tokens: TokenUsage;
  costUsd: number;
  unpricedModels: Set<string>;
  models: Set<string>;
  toolCallCount: number;
  errorCount: number;
  timestamps: string[];
  title: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  sessionId: string | null;
};

const IDLE_GAP_MS = 5 * 60 * 1000;

function activeMsOf(steps: TraceStep[]): number {
  const times = steps
    .map((s) => Date.parse(s.timestamp))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap <= IDLE_GAP_MS) total += gap;
  }
  return total;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (typeof b === "string") return b;
      if (typeof b === "object" && b !== null) {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") return t;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export class CodexAdapter implements TraceAdapter {
  readonly source = "codex";
  /** 세션 id -> Codex가 붙인 이름. discover 때 한 번만 읽는다 */
  private threadNames = new Map<string, string>();

  constructor(
    private readonly rootDir: string = DEFAULT_SESSIONS_DIR,
    private readonly indexPath: string = SESSION_INDEX,
  ) {}

  private async loadThreadNames(): Promise<void> {
    this.threadNames.clear();
    try {
      const rl = createInterface({
        input: createReadStream(this.indexPath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as { id?: string; thread_name?: string };
          if (r.id && r.thread_name) this.threadNames.set(r.id, r.thread_name);
        } catch {
          // 잘린 줄
        }
      }
    } catch {
      // 인덱스가 없으면 첫 프롬프트로 대신한다
    }
  }

  async discover(): Promise<TraceFile[]> {
    await this.loadThreadNames();
    const out: TraceFile[] = [];
    await this.collect(this.rootDir, out);
    return out;
  }

  private async collect(dir: string, out: TraceFile[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Codex를 안 쓰는 환경
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collect(path, out);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const s = await stat(path);
        out.push({
          path,
          mtimeMs: s.mtimeMs,
          sizeBytes: s.size,
          // 날짜 디렉터리 구조라 프로젝트 개념이 없다. cwd에서 사후에 채운다
          projectSlug: "codex",
        });
      } catch {
        // 인덱싱 중 사라진 파일
      }
    }
  }

  async parse(file: TraceFile): Promise<ParsedTrace[]> {
    const acc: Accumulator = {
      steps: [],
      tokens: emptyUsage(),
      costUsd: 0,
      unpricedModels: new Set(),
      models: new Set(),
      toolCallCount: 0,
      errorCount: 0,
      timestamps: [],
      title: null,
      firstPrompt: null,
      cwd: null,
      sessionId: null,
    };

    let seq = 0;
    let model: string | null = null;
    /** 스텝이 생기기 전에 도착한 usage */
    let pendingUsage: TokenUsage | null = null;
    // 툴 호출 id -> 이름. 결과 레코드에는 이름이 없다
    const callNames = new Map<string, string>();

    /*
     * 한 롤아웃 파일이 270MB까지 나온다. 통째로 읽으면 문자열 하나로 수백 MB를 잡으므로
     * 줄 단위로 흘려 읽는다.
     */
    const rl = createInterface({
      input: createReadStream(file.path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 쓰는 도중 잘린 줄
      }

      const ts = typeof rec.timestamp === "string" ? rec.timestamp : "";
      if (ts) acc.timestamps.push(ts);
      const payload = rec.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      const push = (step: Omit<TraceStep, "uuid" | "seq" | "parentUuid" | "isSidechain">) => {
        const created: TraceStep = {
          uuid: `${basename(file.path)}#${seq}`,
          parentUuid: null,
          seq: seq++,
          isSidechain: false,
          ...step,
        };
        if (pendingUsage) {
          created.tokens = created.tokens ? addUsage(created.tokens, pendingUsage) : pendingUsage;
          pendingUsage = null;
        }
        acc.steps.push(created);
      };

      switch (rec.type) {
        case "session_meta": {
          if (typeof payload.id === "string") acc.sessionId = payload.id;
          if (typeof payload.cwd === "string") acc.cwd = payload.cwd;
          break;
        }
        case "turn_context": {
          if (typeof payload.model === "string") {
            model = payload.model;
            acc.models.add(payload.model);
          }
          break;
        }
        case "event_msg": {
          switch (payload.type) {
            case "user_message": {
              const text = textOf(payload.message ?? payload.text);
              if (!text) break;
              if (acc.firstPrompt === null && !isIdePrompt(text)) acc.firstPrompt = text;
              push({
                kind: "user_prompt",
                timestamp: ts,
                model: null,
                text,
                toolName: null,
                toolUseId: null,
                filePath: null,
                toolInput: null,
                toolResult: null,
                isError: false,
                tokens: null,
                durationMs: null,
              });
              break;
            }
            case "token_count": {
              // 턴별 사용량만 더한다. total은 누적이라 같이 더하면 중복이 된다
              const info = payload.info as Record<string, unknown> | undefined;
              const last = info?.last_token_usage as CodexUsage | undefined;
              if (!last) break;
              const usage = toTokenUsage(last);
              acc.tokens = addUsage(acc.tokens, usage);
              if (model) {
                const cost = costOf(model, usage, ts);
                if (cost === null) acc.unpricedModels.add(model);
                else acc.costUsd += cost;
              }
              /*
               * 직전 스텝에 붙여 타임라인에서 어느 턴이 비쌌는지 보이게 한다.
               * 이미 붙어 있으면 더한다 — 덮어쓰거나 건너뛰면 스텝 합계가 세션 합계와
               * 어긋난다. token_count가 스텝 없이 먼저 오는 경우도 있어 그때는 들고 있다가
               * 다음 스텝에 붙인다.
               */
              const target = acc.steps[acc.steps.length - 1];
              if (target) {
                target.tokens = target.tokens ? addUsage(target.tokens, usage) : usage;
              } else {
                pendingUsage = pendingUsage ? addUsage(pendingUsage, usage) : usage;
              }
              break;
            }
            default:
              break;
          }
          break;
        }
        case "response_item": {
          switch (payload.type) {
            case "reasoning": {
              push({
                kind: "thinking",
                timestamp: ts,
                model,
                text: textOf(payload.summary ?? payload.content),
                toolName: null,
                toolUseId: null,
                filePath: null,
                toolInput: null,
                toolResult: null,
                isError: false,
                tokens: null,
                durationMs: null,
              });
              break;
            }
            case "message": {
              const role = payload.role;
              const text = textOf(payload.content);
              if (!text) break;
              push({
                kind: role === "user" ? "user_prompt" : "assistant_text",
                timestamp: ts,
                model: role === "user" ? null : model,
                text,
                toolName: null,
                toolUseId: null,
                filePath: null,
                toolInput: null,
                toolResult: null,
                isError: false,
                tokens: null,
                durationMs: null,
              });
              break;
            }
            case "function_call":
            case "custom_tool_call": {
              const name = typeof payload.name === "string" ? payload.name : "unknown";
              const callId =
                typeof payload.call_id === "string"
                  ? payload.call_id
                  : typeof payload.id === "string"
                    ? payload.id
                    : null;
              if (callId) callNames.set(callId, name);
              acc.toolCallCount += 1;
              const args = payload.arguments ?? payload.input;
              push({
                kind: "tool_call",
                timestamp: ts,
                model,
                text: null,
                toolName: name,
                toolUseId: callId,
                filePath: filePathOfArgs(args),
                toolInput: typeof args === "string" ? args : JSON.stringify(args ?? null),
                toolResult: null,
                isError: false,
                tokens: null,
                durationMs: null,
              });
              break;
            }
            case "function_call_output":
            case "custom_tool_call_output": {
              const callId = typeof payload.call_id === "string" ? payload.call_id : null;
              const { text, isError } = outputOf(payload.output);
              if (isError) acc.errorCount += 1;
              push({
                kind: "tool_result",
                timestamp: ts,
                model: null,
                text: null,
                toolName: callId ? (callNames.get(callId) ?? null) : null,
                toolUseId: callId,
                filePath: null,
                toolInput: null,
                toolResult: text,
                isError,
                tokens: null,
                durationMs: null,
              });
              break;
            }
            default:
              break;
          }
          break;
        }
        default:
          break;
      }
    }

    if (acc.steps.length === 0) return [];

    const sorted = [...acc.timestamps].sort();
    const startedAt = sorted[0] ?? "";
    const endedAt = sorted[sorted.length - 1] ?? "";
    const id = acc.sessionId ?? basename(file.path, ".jsonl");

    const session: TraceSession = {
      id: `codex:${id}`,
      parentSessionId: null,
      agentId: null,
      source: this.source,
      // Codex는 날짜로만 나눠 저장하므로 cwd를 프로젝트 구분자로 쓴다
      projectSlug: acc.cwd ? `codex:${acc.cwd}` : "codex",
      projectName: acc.cwd ? basename(acc.cwd) : "codex",
      filePath: file.path,
      cwd: acc.cwd,
      gitBranch: null,
      // Codex가 붙인 이름을 우선하고, 없으면 사용자의 첫 프롬프트 한 줄
      title:
        this.threadNames.get(id) ??
        (acc.firstPrompt ? acc.firstPrompt.split("\n")[0].slice(0, 80) : null),
      firstPrompt: acc.firstPrompt,
      startedAt,
      endedAt,
      durationMs:
        startedAt && endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : 0,
      activeMs: activeMsOf(acc.steps),
      models: [...acc.models].sort(),
      tokens: acc.tokens,
      costUsd: acc.costUsd,
      unpricedModels: [...acc.unpricedModels].sort(),
      toolCallCount: acc.toolCallCount,
      errorCount: acc.errorCount,
      stepCount: acc.steps.length,
    };

    return [{ session, steps: acc.steps, prLinks: [] }];
  }
}

/** 툴 인자에서 대상 파일을 뽑는다. Codex는 인자를 JSON 문자열로 넣는다 */
function filePathOfArgs(args: unknown): string | null {
  let obj: unknown = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  for (const key of ["file_path", "path", "filename"]) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/**
 * 툴 실패 판정.
 * Codex는 실패 플래그를 따로 주지 않고 출력 머리에 종료 코드를 적는다
 * ("Process exited with code 1"). 0이 아니면 실패로 본다.
 */
const EXIT_CODE = /Process exited with code (\d+)/;

function isFailure(text: string, o?: Record<string, unknown>): boolean {
  if (o?.success === false) return true;
  const m = EXIT_CODE.exec(text);
  return m ? m[1] !== "0" : false;
}

/** 툴 출력은 문자열이거나 {output, success} 꼴로 온다 */
function outputOf(raw: unknown): { text: string; isError: boolean } {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) return outputOf(parsed);
    } catch {
      // 평범한 문자열 출력
    }
    return { text: raw, isError: isFailure(raw) };
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    const text =
      typeof o.output === "string" ? o.output : typeof o.content === "string" ? o.content : "";
    return { text: text || JSON.stringify(raw), isError: isFailure(text, o) };
  }
  return { text: JSON.stringify(raw ?? null), isError: false };
}
