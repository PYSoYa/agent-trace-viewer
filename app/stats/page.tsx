import Link from "next/link";
import {
  listModelStats,
  listProjectStats,
  listSourceStats,
  listToolStats,
} from "@/lib/db/queries";
import { formatUsd } from "@/lib/pricing";
import { formatDuration, formatPercent, formatTokens, shortModel } from "@/lib/format";
import { getRedactMode } from "@/lib/mode";
import { presentProject, projectKey } from "@/lib/present";
import { DemoToggle } from "../demo-toggle";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const tools = listToolStats();
  const projects = listProjectStats();
  const models = listModelStats();
  const sources = listSourceStats();
  const mode = await getRedactMode();

  const maxToolCalls = Math.max(1, ...tools.map((t) => t.calls));
  const maxProjectCost = Math.max(0.0001, ...projects.map((p) => p.costUsd));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Sessions
        </Link>
        <DemoToggle mode={mode} />
      </div>
      <h1 className="mt-4 mb-2 text-xl font-semibold tracking-tight">Stats</h1>
      <p className="mb-8 text-xs text-neutral-500">
        All costs are API list-rate equivalents for the tokens consumed. The logs record no
        billing information, so this cannot tell you what you were actually charged.
      </p>

      {sources.length > 1 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium text-neutral-500">By agent</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {sources.map((s) => (
              <div
                key={s.source}
                className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800"
              >
                <div className="mb-2 text-sm font-medium">
                  {s.source === "claude-code" ? "Claude Code" : "Codex"}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <dt>Sessions</dt>
                  <dd className="text-right tabular-nums">{s.sessions}</dd>
                  <dt>API-rate cost</dt>
                  <dd className="text-right tabular-nums">{formatUsd(s.costUsd)}</dd>
                  {/* 세션 하나에 얼마를 쓰는지가 두 에이전트를 비교하는 가장 직접적인 값이다 */}
                  <dt>Per session</dt>
                  <dd className="text-right tabular-nums">
                    {formatUsd(s.sessions ? s.costUsd / s.sessions : 0)}
                  </dd>
                  <dt>Active time</dt>
                  <dd className="text-right tabular-nums">{formatDuration(s.activeMs)}</dd>
                  <dt>Output</dt>
                  <dd className="text-right tabular-nums">{formatTokens(s.outputTokens)}</dd>
                  <dt>Cache hit rate</dt>
                  <dd className="text-right tabular-nums">{formatPercent(s.cacheHitRate)}</dd>
                  <dt>Tool calls</dt>
                  <dd className="text-right tabular-nums">{s.toolCalls.toLocaleString()}</dd>
                  <dt>Errors</dt>
                  <dd className="text-right tabular-nums">{s.errors.toLocaleString()}</dd>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          Tool usage and failure rate
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-2.5 font-medium">Tool</th>
                <th className="px-4 py-2.5 font-medium">Share</th>
                <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                <th className="px-4 py-2.5 text-right font-medium">Sessions</th>
                <th className="px-4 py-2.5 text-right font-medium">Failures</th>
                <th className="px-4 py-2.5 text-right font-medium">Failure rate</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr
                  key={t.toolName}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  {/* 실패를 실제로 보려면 결국 원문을 찾아야 한다 */}
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <Link
                      href={`/search?q=${encodeURIComponent(t.toolName)}`}
                      className="hover:underline"
                    >
                      {t.toolName}
                    </Link>
                  </td>
                  <td className="w-56 px-4 py-2.5">
                    <Bar ratio={t.calls / maxToolCalls} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.calls}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {t.sessions}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.errors > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{t.errors}</span>
                    ) : (
                      <span className="text-neutral-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {formatPercent(t.errorRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Usage by project</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Cost share</th>
                <th className="px-4 py-2.5 text-right font-medium">Sessions</th>
                <th className="px-4 py-2.5 text-right font-medium">Output</th>
                <th className="px-4 py-2.5 text-right font-medium">Cache reads</th>
                <th className="px-4 py-2.5 text-right font-medium">Hit rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Tools</th>
                <th className="px-4 py-2.5 text-right font-medium">Errors</th>
                <th className="px-4 py-2.5 text-right font-medium">API cost</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={projectKey(p.name)}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/?project=${projectKey(p.name)}`}
                      className="hover:underline"
                    >
                      {presentProject(p.name, mode)}
                    </Link>
                  </td>
                  <td className="w-48 px-4 py-2.5">
                    <Bar ratio={p.costUsd / maxProjectCost} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.sessions}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatTokens(p.outputTokens)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {formatTokens(p.cacheReadTokens)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {formatPercent(p.cacheHitRate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {p.toolCalls}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {p.errors}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {formatUsd(p.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-neutral-500">Output by model</h2>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-900 dark:border-neutral-800">
          {models.map((m) => (
            <li key={m.model} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-mono text-xs">{shortModel(m.model)}</span>
              <span className="tabular-nums text-neutral-500">
                {m.steps.toLocaleString()} steps · {formatTokens(m.outputTokens)} output
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Bar({ ratio }: { ratio: number }) {
  const pct = Math.max(1, Math.round(ratio * 100));
  return (
    <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
      <div
        className="h-1.5 rounded-full bg-neutral-700 dark:bg-neutral-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
