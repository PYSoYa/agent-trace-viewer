import Link from "next/link";
import { indexTraces } from "@/lib/db/indexer";
import { listProjects, listSessions, prCountsBySession } from "@/lib/db/queries";
import { formatUsd } from "@/lib/pricing";
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
  const sessions = listSessions(project);
  const prCounts = prCountsBySession();

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
          <h1 className="text-2xl font-semibold tracking-tight">에이전트 트레이스</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {index.scanned}개 파일 스캔 · {index.reindexed}개 재인덱싱 · {index.elapsedMs}ms
          </p>
        </div>
        <Link
          href="/stats"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-400 dark:border-neutral-700"
        >
          집계
        </Link>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="세션" value={String(sessions.length)} />
        <Stat label="비용" value={formatUsd(totalCost)} />
        <Stat label="출력 토큰" value={formatTokens(totalOutput)} />
        <Stat
          label="캐시 히트율"
          value={totalPrompt ? formatPercent(totalCacheRead / totalPrompt) : "-"}
        />
        <Stat label="툴 호출" value={formatTokens(totalTools)} />
      </section>

      <nav className="mb-6 flex flex-wrap gap-2">
        <FilterChip href="/" active={!project} label="전체" />
        {projects.map((p) => (
          <FilterChip
            key={p.slug}
            href={`/?project=${encodeURIComponent(p.slug)}`}
            active={project === p.slug}
            label={`${p.name} (${p.sessionCount})`}
          />
        ))}
      </nav>

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          인덱싱된 세션이 없습니다. ~/.claude/projects 아래에 jsonl 로그가 있는지 확인하세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">세션</th>
                <th className="px-4 py-3 font-medium">프로젝트</th>
                <th className="px-4 py-3 font-medium">시작</th>
                {/* 첫 기록과 마지막 기록 사이의 벽시계 간격. 세션을 며칠 뒤 이어가면 그만큼 길어진다 */}
                <th className="px-4 py-3 text-right font-medium">기간</th>
                <th className="px-4 py-3 font-medium">모델</th>
                <th className="px-4 py-3 text-right font-medium">출력</th>
                <th className="px-4 py-3 text-right font-medium">캐시</th>
                <th className="px-4 py-3 text-right font-medium">툴</th>
                <th className="px-4 py-3 text-right font-medium">에러</th>
                <th className="px-4 py-3 text-right font-medium">비용</th>
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
                      {s.title ?? (s.firstPrompt ? truncate(s.firstPrompt, 60) : s.id.slice(0, 8))}
                    </Link>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {s.stepCount} 스텝
                      {s.gitBranch && s.gitBranch !== "HEAD" ? ` · ${s.gitBranch}` : ""}
                      {s.subagentCount > 0 ? ` · 서브에이전트 ${s.subagentCount}` : ""}
                      {prCounts.get(s.id) ? (
                        <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          PR {prCounts.get(s.id)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {s.projectName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {formatDateTime(s.startedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {formatDuration(s.durationMs)}
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
                    {formatUsd(s.totalCostUsd)}
                    {s.subagentCount > 0 && (
                      <div className="text-xs font-normal text-neutral-500">
                        본체 {formatUsd(s.costUsd)}
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
