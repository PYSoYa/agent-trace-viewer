export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin ? `${hr}h ${restMin}m` : `${hr}h`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 모델 ID를 목록에서 읽기 쉬운 짧은 이름으로 */
export function shortModel(model: string): string {
  return model.replace(/^anthropic\./, "").replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/**
 * 툴 호출 한 줄 요약. 인자 JSON 전체를 접힌 채로 두고, 펼치지 않아도 뭘 했는지 보이게 한다.
 * 툴마다 의미 있는 필드가 달라서 우선순위대로 찾는다.
 */
const SUMMARY_FIELDS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
];

export function toolSummary(toolInput: string | null): string | null {
  if (!toolInput) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolInput);
  } catch {
    return truncate(toolInput, 120); // 잘린 인자는 파싱이 안 된다
  }
  if (typeof parsed !== "object" || parsed === null) return truncate(String(parsed), 120);

  const obj = parsed as Record<string, unknown>;
  for (const key of SUMMARY_FIELDS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return truncate(v, 140);
  }
  const keys = Object.keys(obj);
  return keys.length ? truncate(keys.join(", "), 120) : null;
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
