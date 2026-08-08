import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/** 사용자가 실제로 친 프롬프트가 아니라 CLI가 끼워 넣은 메타 텍스트 */
const META_PROMPT_PREFIXES = [
  "<local-command-caveat>",
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<system-reminder>",
  "Caveat: The messages below were generated",
];

function isMetaPrompt(text: string): boolean {
  const head = text.trimStart();
  return META_PROMPT_PREFIXES.some((p) => head.startsWith(p));
}

/** usage 객체는 캐시 TTL별로 쪼개져 있고, 필드가 없는 예전 로그도 있다 */
function readUsage(raw: Record<string, unknown> | undefined): TokenUsage {
  if (!raw) return emptyUsage();
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const creation = raw.cache_creation as Record<string, unknown> | undefined;

  const write5m = num(creation?.ephemeral_5m_input_tokens);
  const write1h = num(creation?.ephemeral_1h_input_tokens);
  const totalWrite = num(raw.cache_creation_input_tokens);

  // cache_creation 세부가 없으면 총합을 5m으로 간주한다 (보수적으로 1.25x 단가)
  const hasBreakdown = creation !== undefined && write5m + write1h > 0;

  return {
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheWrite5m: hasBreakdown ? write5m : totalWrite,
    cacheWrite1h: hasBreakdown ? write1h : 0,
    cacheRead: num(raw.cache_read_input_tokens),
  };
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter(
      (b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
    )
    .map((b) => b.text);
  return parts.length ? parts.join("\n") : null;
}

/** tool_result의 content는 문자열일 때도, 블록 배열일 때도 있다 */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return textOf(content) ?? JSON.stringify(content);
  return JSON.stringify(content ?? null);
}

type Accumulator = {
  sessionId: string;
  steps: TraceStep[];
  /** message.id -> 이미 계상했는지. assistant 한 메시지가 여러 줄로 쪼개져 들어온다 */
  countedMessageIds: Set<string>;
  tokens: TokenUsage;
  costUsd: number;
  models: Set<string>;
  toolCallCount: number;
  errorCount: number;
  timestamps: string[];
  title: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
};

function newAccumulator(sessionId: string): Accumulator {
  return {
    sessionId,
    steps: [],
    countedMessageIds: new Set(),
    tokens: emptyUsage(),
    costUsd: 0,
    models: new Set(),
    toolCallCount: 0,
    errorCount: 0,
    timestamps: [],
    title: null,
    firstPrompt: null,
    cwd: null,
    gitBranch: null,
  };
}

export class ClaudeCodeAdapter implements TraceAdapter {
  readonly source = "claude-code";

  async discover(): Promise<TraceFile[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(PROJECTS_DIR);
    } catch {
      return []; // Claude Code를 안 쓰는 환경
    }

    const files: TraceFile[] = [];
    for (const slug of projectDirs) {
      const dir = join(PROJECTS_DIR, slug);
      // 세션 jsonl은 프로젝트 바로 아래, 서브에이전트는 <세션ID>/subagents/ 아래에 있다
      await this.collect(dir, slug, files);
    }
    return files;
  }

  private async collect(dir: string, slug: string, out: TraceFile[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collect(path, slug, out);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const s = await stat(path);
        // .../<세션ID>/subagents/agent-xxx.jsonl → agentId = agent-xxx
        const agentId =
          basename(dir) === "subagents" ? entry.name.replace(/\.jsonl$/, "") : undefined;
        out.push({
          path,
          mtimeMs: s.mtimeMs,
          sizeBytes: s.size,
          projectSlug: slug,
          agentId,
        });
      } catch {
        // 인덱싱 중 삭제된 파일은 건너뛴다
      }
    }
  }

  async parse(file: TraceFile): Promise<ParsedTrace[]> {
    const raw = await readFile(file.path, "utf8");
    const sessions = new Map<string, Accumulator>();
    let seq = 0;

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;

      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 쓰는 도중 잘린 마지막 줄
      }

      const sessionId = (rec.sessionId ?? rec.session_id) as string | undefined;
      if (!sessionId) continue;

      let acc = sessions.get(sessionId);
      if (!acc) {
        acc = newAccumulator(sessionId);
        sessions.set(sessionId, acc);
      }

      const type = rec.type as string;
      const timestamp = rec.timestamp as string | undefined;
      if (timestamp) acc.timestamps.push(timestamp);
      if (typeof rec.cwd === "string" && rec.cwd) acc.cwd = rec.cwd;
      if (typeof rec.gitBranch === "string" && rec.gitBranch) acc.gitBranch = rec.gitBranch;

      if (type === "ai-title" && typeof rec.aiTitle === "string") {
        acc.title = rec.aiTitle;
        continue;
      }

      const uuid = (rec.uuid as string | undefined) ?? `${file.path}:${seq}`;
      const parentUuid = (rec.parentUuid as string | null | undefined) ?? null;
      const isSidechain = rec.isSidechain === true;
      const ts = timestamp ?? "";

      if (type === "assistant") {
        const message = rec.message as Record<string, unknown> | undefined;
        if (!message) continue;

        const model = (message.model as string | undefined) ?? null;
        // <synthetic>은 CLI가 만든 안내/에러 메시지(로그인 만료 등)로 토큰이 0이다. 모델 목록에서 뺀다
        if (model && model !== "<synthetic>") acc.models.add(model);

        // 같은 message.id가 여러 줄에 걸쳐 오므로 usage는 한 번만 계상한다
        const messageId = message.id as string | undefined;
        let usage: TokenUsage | null = null;
        if (messageId && !acc.countedMessageIds.has(messageId)) {
          acc.countedMessageIds.add(messageId);
          usage = readUsage(message.usage as Record<string, unknown> | undefined);
          acc.tokens = addUsage(acc.tokens, usage);
          if (model) acc.costUsd += costOf(model, usage, ts);
        }

        const content = message.content;
        if (!Array.isArray(content)) continue;

        let attachedUsage = usage;
        for (const block of content) {
          if (typeof block !== "object" || block === null) continue;
          const b = block as Record<string, unknown>;

          if (b.type === "text" && typeof b.text === "string") {
            acc.steps.push({
              uuid: `${uuid}#${seq}`,
              parentUuid,
              seq: seq++,
              kind: "assistant_text",
              timestamp: ts,
              model,
              text: b.text,
              toolName: null,
              toolUseId: null,
              toolInput: null,
              toolResult: null,
              isError: false,
              isSidechain,
              tokens: attachedUsage,
              durationMs: null,
            });
            attachedUsage = null; // usage는 메시지당 한 스텝에만 붙인다
          } else if (b.type === "tool_use") {
            acc.toolCallCount += 1;
            acc.steps.push({
              uuid: `${uuid}#${seq}`,
              parentUuid,
              seq: seq++,
              kind: "tool_call",
              timestamp: ts,
              model,
              text: null,
              toolName: (b.name as string | undefined) ?? "unknown",
              toolUseId: (b.id as string | undefined) ?? null,
              toolInput: JSON.stringify(b.input ?? null),
              toolResult: null,
              isError: false,
              isSidechain,
              tokens: attachedUsage,
              durationMs: null,
            });
            attachedUsage = null;
          }
        }
        continue;
      }

      if (type === "user") {
        const message = rec.message as Record<string, unknown> | undefined;
        if (!message) continue;
        const content = message.content;

        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block !== "object" || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type !== "tool_result") continue;
            const isError = b.is_error === true;
            if (isError) acc.errorCount += 1;
            acc.steps.push({
              uuid: `${uuid}#${seq}`,
              parentUuid,
              seq: seq++,
              kind: "tool_result",
              timestamp: ts,
              model: null,
              text: null,
              toolName: null,
              toolUseId: (b.tool_use_id as string | undefined) ?? null,
              toolInput: null,
              toolResult: toolResultText(b.content),
              isError,
              isSidechain,
              tokens: null,
              durationMs: null,
            });
          }
          continue;
        }

        const text = textOf(content);
        if (text === null) continue;
        const meta = rec.isMeta === true || isMetaPrompt(text);
        if (!meta && acc.firstPrompt === null) acc.firstPrompt = text;
        acc.steps.push({
          uuid: `${uuid}#${seq}`,
          parentUuid,
          seq: seq++,
          kind: "user_prompt",
          timestamp: ts,
          model: null,
          text,
          toolName: null,
          toolUseId: null,
          toolInput: null,
          toolResult: null,
          isError: false,
          isSidechain,
          tokens: null,
          durationMs: null,
        });
        continue;
      }

      if (type === "system") {
        const durationMs = typeof rec.durationMs === "number" ? rec.durationMs : null;
        const subtype = (rec.subtype as string | undefined) ?? "system";
        acc.steps.push({
          uuid: `${uuid}#${seq}`,
          parentUuid,
          seq: seq++,
          kind: "system",
          timestamp: ts,
          model: null,
          text: subtype,
          toolName: null,
          toolUseId: null,
          toolInput: null,
          toolResult: null,
          isError: false,
          isSidechain,
          tokens: null,
          durationMs,
        });
      }
    }

    const out: ParsedTrace[] = [];
    for (const acc of sessions.values()) {
      if (acc.steps.length === 0) continue;
      const sorted = [...acc.timestamps].sort();
      const startedAt = sorted[0] ?? "";
      const endedAt = sorted[sorted.length - 1] ?? "";
      const durationMs =
        startedAt && endedAt
          ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
          : 0;

      // 서브에이전트 파일은 부모와 같은 sessionId를 갖고 있어 그대로 쓰면 부모 행을 덮어쓴다
      const isSubagent = file.agentId !== undefined;
      const session: TraceSession = {
        id: isSubagent ? `${acc.sessionId}:${file.agentId}` : acc.sessionId,
        parentSessionId: isSubagent ? acc.sessionId : null,
        agentId: file.agentId ?? null,
        source: this.source,
        projectSlug: file.projectSlug,
        projectName: acc.cwd ? basename(acc.cwd) : file.projectSlug,
        filePath: file.path,
        cwd: acc.cwd,
        gitBranch: acc.gitBranch,
        title: acc.title,
        firstPrompt: acc.firstPrompt,
        startedAt,
        endedAt,
        durationMs,
        models: [...acc.models].sort(),
        tokens: acc.tokens,
        costUsd: acc.costUsd,
        toolCallCount: acc.toolCallCount,
        errorCount: acc.errorCount,
        stepCount: acc.steps.length,
      };
      out.push({ session, steps: acc.steps });
    }
    return out;
  }
}
