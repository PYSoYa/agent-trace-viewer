import Link from "next/link";
import { countSearchHits, searchSteps, type SearchHit } from "@/lib/db/queries";
import { getRedactMode } from "@/lib/mode";
import { presentProject, presentText, presentTitle, type RedactMode } from "@/lib/present";
import { formatDateTime } from "@/lib/format";
import { DemoToggle } from "../demo-toggle";

export const dynamic = "force-dynamic";

/** 타임라인 쪽 크기와 맞춰야 링크가 맞는 쪽으로 간다 */
const TIMELINE_PAGE_SIZE = 150;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const mode = await getRedactMode();

  const hits = query ? searchSteps(query) : [];
  const total = query ? countSearchHits(query) : 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Sessions
        </Link>
        <DemoToggle mode={mode} />
      </div>

      <h1 className="mt-4 mb-6 text-xl font-semibold tracking-tight">Search</h1>

      {/* GET form이라 결과가 URL에 남고 클라이언트 JS가 필요 없다 */}
      <form method="get" className="mb-8 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Search prompts, tool arguments, and tool output…"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:border-neutral-400 dark:border-neutral-700"
        >
          Search
        </button>
      </form>

      {query === "" ? (
        <p className="text-sm text-neutral-500">
          All words must appear in the same step. Matches are ranked by relevance.
        </p>
      ) : hits.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No steps matched “{query}”.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-500">
            {total.toLocaleString()} matching steps
            {total > hits.length ? ` · showing the top ${hits.length}` : ""}
          </p>
          <ol className="space-y-2">
            {hits.map((hit) => (
              <Hit key={hit.uuid} hit={hit} mode={mode} />
            ))}
          </ol>
        </>
      )}
    </main>
  );
}

function Hit({ hit, mode }: { hit: SearchHit; mode: RedactMode }) {
  const page = Math.floor(hit.rowIndex / TIMELINE_PAGE_SIZE) + 1;
  const href = `/sessions/${encodeURIComponent(hit.sessionId)}?page=${page}`;

  return (
    <li className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <Link href={href} className="font-medium text-neutral-900 hover:underline dark:text-neutral-100">
          {presentTitle(hit.sessionTitle, mode) ?? hit.sessionId.slice(0, 8)}
        </Link>
        <span>{presentProject(hit.projectName, mode)}</span>
        <span>{formatDateTime(hit.startedAt)}</span>
        <span className="tabular-nums">#{hit.seq}</span>
        {hit.toolName && (
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px] dark:bg-neutral-800">
            {hit.toolName}
          </span>
        )}
      </div>
      <Snippet snippet={hit.snippet} mode={mode} />
    </li>
  );
}

/**
 * FTS5가 일치 부분을 «»로 감싸 돌려준다.
 * 데모 모드에서는 발췌 자체가 본문 유출이므로 내보내지 않는다.
 */
function Snippet({ snippet, mode }: { snippet: string; mode: RedactMode }) {
  if (mode === "demo") {
    return <p className="text-sm italic text-neutral-400">(demo mode · snippet hidden)</p>;
  }
  const safe = presentText(snippet, mode) ?? "";
  const parts = safe.split(/«([^»]*)»/g);
  return (
    <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 dark:bg-amber-800">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
