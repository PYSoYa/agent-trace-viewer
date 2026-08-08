import Link from "next/link";
import { indexTraces } from "@/lib/db/indexer";
import {
  listProjects,
  listSessions,
  prCountsBySession,
  resolveProjectKey,
} from "@/lib/db/queries";
import { formatUsd } from "@/lib/pricing";
import { getRedactMode } from "@/lib/mode";
import {
  presentBranch,
  presentProject,
  presentText,
  presentTitle,
  projectKey,
} from "@/lib/present";
import { DemoToggle } from "./demo-toggle";
import { promptTokens } from "@/lib/trace/types";
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTokens,
  shortModel,
  truncate,
} from "@/lib/format";

// 로컬 파일을 매 요청 읽어야 하므로 프리렌더 대상에서 뺀다
export const dynamic = "force-dynamic";

export default async function SessionListPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;

  const index = await indexTraces();
  const projects = listProjects();
  // URL에는 불투명 키만 실린다. 실제 슬러그는 여기서만 안다
  const projectSlug = resolveProjectKey(project);
  const sessions = listSessions(projectSlug);
  const prCounts = prCountsBySession();
  const mode = await getRedactMode();

  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const totalOutput = sessions.reduce(
    (sum, s) => sum + s.tokens.output + s.subagentOutputTokens,
    0,
  );
  const totalPrompt = sessions.reduce((sum, s) => sum + promptTokens(s.tokens), 0);
  const totalCacheRead = sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0);
  const totalTools = sessions.reduce((sum, s) => sum + s.toolCallCount, 0);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent traces</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {index.scanned} files scanned · {index.reindexed} reindexed · {index.elapsedMs}ms
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DemoToggle mode={mode} />
          <Link
            href="/search"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-400 dark:border-neutral-700"
          >
            Search
          </Link>
          <Link
            href="/stats"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-400 dark:border-neutral-700"
          >
            Stats
          </Link>
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Sessions" value={String(sessions.length)} />
        <Stat label="API-rate cost" value={formatUsd(totalCost)} />
        <Stat label="Output tokens" value={formatTokens(totalOutput)} />
        <Stat
          label="Cache hit rate"
          value={totalPrompt ? formatPercent(totalCacheRead / totalPrompt) : "-"}
        />
        <Stat label="Tool calls" value={formatTokens(totalTools)} />
      </section>

      {/* 로그에는 결제 방식이 남지 않는다. 구독으로 썼다면 실제 지불액이 아니다 */}
      <p className="mb-6 text-xs text-neutral-500">
        Cost is what these tokens would bill at API list rates. If you use a subscription
        plan, this is not what you paid — read it as the value of what you consumed.
      </p>

      <nav className="mb-6 flex flex-wrap gap-2">
        <FilterChip href="/" active={!project} label="All" />
        {projects.map((p) => (
          <FilterChip
            key={projectKey(p.name)}
            href={`/?project=${projectKey(p.name)}`}
            active={projectSlug === p.name}
            label={`${presentProject(p.name, mode)} (${p.sessionCount})`}
          />
        ))}
      </nav>

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No sessions indexed yet. Check that JSONL logs exist under ~/.claude/projects.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 text-right font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Models</th>
                <th className="px-4 py-3 text-right font-medium">Output</th>
                <th className="px-4 py-3 text-right font-medium">Cache</th>
                <th className="px-4 py-3 text-right font-medium">Tools</th>
                <th className="px-4 py-3 text-right font-medium">Errors</th>
                <th className="px-4 py-3 text-right font-medium">API cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/50"
                >
                  <td className="max-w-md px-4 py-3">
                    <Link
                      href={`/sessions/${s.id}`}
                      className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                    >
                      {presentTitle(s.title, mode) ??
                        (s.firstPrompt
                          ? truncate(presentText(s.firstPrompt, mode) ?? "", 60)
                          : s.id.slice(0, 8))}
                    </Link>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {s.stepCount} steps
                      {s.gitBranch && s.gitBranch !== "HEAD" ? ` · ${presentBranch(s.gitBranch, mode)}` : ""}
                      {s.subagentCount > 0 ? ` · ${s.subagentCount} subagents` : ""}
                      <span className="ml-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        {s.source === "claude-code" ? "Claude Code" : "Codex"}
                      </span>
                      {prCounts.get(s.id) ? (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          PR {prCounts.get(s.id)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {presentProject(s.projectName, mode)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {formatDateTime(s.startedAt)}
                  </td>
                  {/* 벽시계 간격은 며칠 뒤 이어가면 수백 시간이 되어 오해를 부른다.
                      유휴를 뺀 작업 시간을 앞에 세우고 간격은 부제로 내린다 */}
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {formatDuration(s.activeMs)}
                    {s.durationMs > s.activeMs * 2 && (
                      <div className="text-xs text-neutral-400">
                        over {formatDuration(s.durationMs)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">
                    {s.models.map(shortModel).join(", ") || "-"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatTokens(s.tokens.output)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {formatPercent(s.cacheHitRate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {s.toolCallCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.errorCount > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{s.errorCount}</span>
                    ) : (
                      <span className="text-neutral-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {formatUsd(s.unpricedModels.length ? null : s.totalCostUsd)}
                    {s.unpricedModels.length > 0 && (
                      <div
                        className="text-xs font-normal text-neutral-400"
                        title={`No rate for ${s.unpricedModels.join(", ")}`}
                      >
                        no rate
                      </div>
                    )}
                    {s.subagentCount > 0 && (
                      <div className="text-xs font-normal text-neutral-500">
                        own {formatUsd(s.costUsd)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400"
      }
    >
      {label}
    </Link>
  );
}
