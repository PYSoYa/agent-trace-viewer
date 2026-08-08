import Link from "next/link";
import { notFound } from "next/navigation";
import {
  countSteps,
  getSession,
  listSessionPrs,
  listSteps,
  listSubagents,
  listTouchedFiles,
  type StepRow,
} from "@/lib/db/queries";
import { formatUsd } from "@/lib/pricing";
import { getRedactMode } from "@/lib/mode";
import {
  presentBranch,
  presentPath,
  presentPr,
  presentProject,
  presentText,
  presentTitle,
  type RedactMode,
} from "@/lib/present";
import { DemoToggle } from "../../demo-toggle";
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTokens,
  shortModel,
  toolSummary,
} from "@/lib/format";

export const dynamic = "force-dynamic";

/** 한 세션이 1,960 스텝까지 나와서 통째로 렌더하면 문서가 수 MB가 된다 */
const PAGE_SIZE = 150;

export default async function SessionTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;

  const session = getSession(decodeURIComponent(id));
  if (!session) notFound();

  const total = countSteps(session.id);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const steps = listSteps(session.id, (current - 1) * PAGE_SIZE, PAGE_SIZE);
  const subagents = listSubagents(session.id);
  const prs = listSessionPrs(session.id);
  const files = listTouchedFiles(session.id);
  const changed = files.filter((f) => f.writes > 0);
  const mode = await getRedactMode();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← 세션 목록
        </Link>
        <DemoToggle mode={mode} />
      </div>

      <header className="mt-4 mb-8">
        <h1 className="text-xl font-semibold tracking-tight">
          {presentTitle(session.title, mode) ??
            presentText(session.firstPrompt, mode) ??
            session.id}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          {presentProject(session.projectName, mode)}
          {session.gitBranch && session.gitBranch !== "HEAD"
            ? ` · ${presentBranch(session.gitBranch, mode)}`
            : ""} ·{" "}
          {formatDateTime(session.startedAt)} · {formatDuration(session.durationMs)} ·{" "}
          {session.models.map(shortModel).join(", ") || "모델 정보 없음"}
        </p>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="비용" value={formatUsd(session.totalCostUsd)} />
        <Stat label="출력 토큰" value={formatTokens(session.tokens.output)} />
        <Stat label="캐시 히트율" value={formatPercent(session.cacheHitRate)} />
        <Stat label="툴 호출" value={String(session.toolCallCount)} />
        <Stat label="에러" value={String(session.errorCount)} tone={session.errorCount ? "bad" : undefined} />
      </section>

      {(prs.length > 0 || changed.length > 0) && (
        <section className="mb-8 grid gap-4 sm:grid-cols-2">
          {prs.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-neutral-500">
                이 세션이 만든 PR {prs.length}개
              </h2>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-900 dark:border-neutral-800">
                {prs.map((pr, i) => {
                  const shown = presentPr(pr, mode);
                  return (
                    <li key={i} className="px-4 py-2.5 text-sm">
                      {shown.href ? (
                        <a
                          href={shown.href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:underline"
                        >
                          {shown.label}
                        </a>
                      ) : (
                        <span className="font-medium">{shown.label}</span>
                      )}
                      <span className="ml-2 text-xs text-neutral-500">{shown.repository}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {changed.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-neutral-500">
                변경한 파일 {changed.length}개
                {files.length > changed.length
                  ? ` · 읽기만 한 파일 ${files.length - changed.length}개`
                  : ""}
              </h2>
              <ul className="max-h-56 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200 dark:divide-neutral-900 dark:border-neutral-800">
                {changed.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
                  >
                    <span className="truncate font-mono" title={presentPath(f.path, mode)}>
                      {presentPath(f.path, mode).replace(/^.*\/(?=[^/]+\/[^/]+$)/, "…/")}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {f.writes}회 변경
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {subagents.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">
            서브에이전트 {subagents.length}개
          </h2>
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-900 dark:border-neutral-800">
            {subagents.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link
                  href={`/sessions/${encodeURIComponent(a.id)}`}
                  className="font-mono text-xs hover:underline"
                >
                  {a.agentId ?? a.id}
                </Link>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {a.stepCount} 스텝 · 툴 {a.toolCallCount} · {formatTokens(a.outputTokens)} ·{" "}
                  {formatUsd(a.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-500">
            타임라인 · 전체 {total.toLocaleString()} 스텝
          </h2>
          <Pager sessionId={session.id} current={current} pageCount={pageCount} />
        </div>

        <ol className="space-y-2">
          {steps.map((step) => (
            <Step key={step.uuid} step={step} mode={mode} />
          ))}
        </ol>

        <div className="mt-6 flex justify-end">
          <Pager sessionId={session.id} current={current} pageCount={pageCount} />
        </div>
      </section>
    </main>
  );
}

function Step({ step, mode }: { step: StepRow; mode: RedactMode }) {
  const text = presentText(step.text, mode);
  const toolInput = presentText(step.toolInput, mode);
  const toolResult = presentText(step.toolResult, mode);
  if (step.kind === "system") {
    return (
      <li className="px-3 py-1 text-xs text-neutral-400">
        #{step.seq} {step.text}
        {step.gapMs !== null && step.gapMs > 1000 ? ` · ${formatDuration(step.gapMs)} 대기` : ""}
      </li>
    );
  }

  const tone = STEP_TONE[step.kind] ?? "border-neutral-300 dark:border-neutral-700";
  const errorTone = step.isError ? "border-red-500" : tone;

  return (
    <li className={`rounded-r border-l-2 ${errorTone} bg-neutral-50 px-4 py-3 dark:bg-neutral-900/40`}>
      <div className="mb-1.5 flex items-center gap-2 text-xs text-neutral-500">
        <span className="tabular-nums">#{step.seq}</span>
        <span className="font-medium">{KIND_LABEL[step.kind] ?? step.kind}</span>
        {step.toolName && (
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px] dark:bg-neutral-800">
            {step.toolName}
          </span>
        )}
        {step.isError && <span className="font-medium text-red-600 dark:text-red-400">에러</span>}
        {step.outputTokens !== null && (
          <span className="tabular-nums">out {formatTokens(step.outputTokens)}</span>
        )}
        {step.gapMs !== null && step.gapMs > 1000 && (
          <span className="tabular-nums">+{formatDuration(step.gapMs)}</span>
        )}
      </div>

      {step.kind === "thinking" && !step.text ? (
        // Opus 5는 기본이 display: omitted라 사고 내용이 빈 문자열로 기록된다
        <p className="text-sm italic text-neutral-400">사고 내용은 로그에 남지 않음</p>
      ) : (
        text && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
        )
      )}

      {step.toolInput && (
        <>
          <p className="break-all font-mono text-xs text-neutral-700 dark:text-neutral-300">
            {mode === "demo"
              ? step.filePath
                ? presentPath(step.filePath, mode)
                : "(데모 모드 · 인자 숨김)"
              : presentText(toolSummary(step.toolInput), mode)}
          </p>
          {toolInput && <Collapsible label="인자 전체" body={toolInput} />}
        </>
      )}

      {toolResult && (
        <Collapsible
          label={step.isError ? "에러 출력" : "결과"}
          body={toolResult}
          preview={toolResult.split("\n")[0]?.slice(0, 120)}
        />
      )}
    </li>
  );
}

/** details/summary라 클라이언트 JS 없이 접힌다 */
function Collapsible({
  label,
  body,
  preview,
}: {
  label: string;
  body: string;
  preview?: string;
}) {
  return (
    <details className="mt-1.5 group">
      <summary className="cursor-pointer list-none text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        <span className="group-open:hidden">▸ {preview ? preview : label}</span>
        <span className="hidden group-open:inline">▾ {label} 접기</span>
      </summary>
      <pre className="mt-1.5 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-3 font-mono text-xs leading-relaxed dark:bg-neutral-950">
        {body}
      </pre>
    </details>
  );
}

const KIND_LABEL: Record<string, string> = {
  user_prompt: "사용자",
  assistant_text: "어시스턴트",
  thinking: "사고",
  tool_call: "툴 호출",
  tool_result: "툴 결과",
};

const STEP_TONE: Record<string, string> = {
  user_prompt: "border-blue-500",
  assistant_text: "border-neutral-400 dark:border-neutral-600",
  thinking: "border-amber-500",
  tool_call: "border-violet-500",
  tool_result: "border-emerald-500",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Pager({
  sessionId,
  current,
  pageCount,
}: {
  sessionId: string;
  current: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const base = `/sessions/${encodeURIComponent(sessionId)}`;
  return (
    <nav className="flex items-center gap-2 text-xs">
      {current > 1 ? (
        <Link href={`${base}?page=${current - 1}`} className="hover:underline">
          이전
        </Link>
      ) : (
        <span className="text-neutral-300 dark:text-neutral-700">이전</span>
      )}
      <span className="tabular-nums text-neutral-500">
        {current} / {pageCount}
      </span>
      {current < pageCount ? (
        <Link href={`${base}?page=${current + 1}`} className="hover:underline">
          다음
        </Link>
      ) : (
        <span className="text-neutral-300 dark:text-neutral-700">다음</span>
      )}
    </nav>
  );
}
