import { toggleDemoMode } from "./actions";
import type { RedactMode } from "@/lib/redact";

/** form + server action이라 클라이언트 JS 없이 동작한다 */
export function DemoToggle({ mode }: { mode: RedactMode }) {
  const on = mode === "demo";
  return (
    <form action={toggleDemoMode}>
      <button
        type="submit"
        title={
          on
            ? "Show the real values again"
            : "Replace names with pseudonyms and hide prose. For screenshots."
        }
        className={
          on
            ? "rounded-lg border border-amber-500 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            : "rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-400 dark:border-neutral-700"
        }
      >
        {on ? "Demo mode on" : "Demo mode"}
      </button>
    </form>
  );
}
