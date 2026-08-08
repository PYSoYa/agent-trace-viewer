import Link from "next/link";
import { listModelStats, listProjectStats, listToolStats } from "@/lib/db/queries";
import { formatUsd } from "@/lib/pricing";
import { formatPercent, formatTokens, shortModel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const tools = listToolStats();
  const projects = listProjectStats();
  const models = listModelStats();

  const maxToolCalls = Math.max(1, ...tools.map((t) => t.calls));
  const maxProjectCost = Math.max(0.0001, ...projects.map((p) => p.costUsd));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← 세션 목록
      </Link>
      <h1 className="mt-4 mb-8 text-xl font-semibold tracking-tight">집계</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium text-neutral-500">
          툴별 사용량과 실패율
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-2.5 font-medium">툴</th>
                <th className="px-4 py-2.5 font-medium">비중</th>
                <th className="px-4 py-2.5 text-right font-medium">호출</th>
                <th className="px-4 py-2.5 text-right font-medium">세션</th>
                <th className="px-4 py-2.5 text-right font-medium">실패</th>
                <th className="px-4 py-2.5 text-right font-medium">실패율</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr
                  key={t.toolName}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">{t.toolName}</td>
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
        <h2 className="mb-3 text-sm font-medium text-neutral-500">프로젝트별 소비</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-2.5 font-medium">프로젝트</th>
                <th className="px-4 py-2.5 font-medium">비용 비중</th>
                <th className="px-4 py-2.5 text-right font-medium">세션</th>
                <th className="px-4 py-2.5 text-right font-medium">출력</th>
                <th className="px-4 py-2.5 text-right font-medium">캐시 읽기</th>
                <th className="px-4 py-2.5 text-right font-medium">툴</th>
                <th className="px-4 py-2.5 text-right font-medium">에러</th>
                <th className="px-4 py-2.5 text-right font-medium">비용</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.slug}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/?project=${encodeURIComponent(p.slug)}`}
                      className="hover:underline"
                    >
                      {p.name}
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
        <h2 className="mb-3 text-sm font-medium text-neutral-500">모델별 출력</h2>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-900 dark:border-neutral-800">
          {models.map((m) => (
            <li key={m.model} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-mono text-xs">{shortModel(m.model)}</span>
              <span className="tabular-nums text-neutral-500">
                {m.steps.toLocaleString()} 스텝 · {formatTokens(m.outputTokens)} 출력
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
