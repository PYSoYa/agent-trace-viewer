import type { TokenUsage } from "./trace/types";

/**
 * 100만 토큰당 USD 단가.
 * 캐시 단가는 base input에서 파생된다: write 5m = 1.25x, write 1h = 2x, read = 0.1x.
 */
type Rate = { input: number; output: number };

type RateEntry = Rate & {
  /** 한시적 프로모션 단가와 종료일 (ISO). 종료일 이후 요청은 base로 계산 */
  intro?: Rate & { until: string };
};

const RATES: Record<string, RateEntry> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    intro: { input: 2, output: 10, until: "2026-08-31T23:59:59Z" },
  },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** 단가표에 없는 모델의 폴백. 비용을 0으로 만들어 조용히 누락시키지 않는다 */
const FALLBACK: Rate = { input: 5, output: 25 };

export function isKnownModel(model: string): boolean {
  return normalize(model) in RATES;
}

function normalize(model: string): string {
  // Bedrock 프리픽스와 날짜 접미사를 벗겨 별칭으로 맞춘다
  const bare = model.replace(/^anthropic\./, "");
  if (bare in RATES) return bare;
  const undated = bare.replace(/-\d{8}$/, "");
  return undated;
}

function rateFor(model: string, atIso: string): Rate {
  const entry = RATES[normalize(model)];
  if (!entry) return FALLBACK;
  if (entry.intro && atIso <= entry.intro.until) {
    return { input: entry.intro.input, output: entry.intro.output };
  }
  return { input: entry.input, output: entry.output };
}

/** 단일 모델 호출의 비용(USD). atIso는 프로모션 단가 적용 판정에만 쓰인다 */
export function costOf(model: string, u: TokenUsage, atIso: string): number {
  const rate = rateFor(model, atIso);
  const perToken = rate.input / 1_000_000;
  return (
    u.input * perToken +
    u.cacheWrite5m * perToken * 1.25 +
    u.cacheWrite1h * perToken * 2 +
    u.cacheRead * perToken * 0.1 +
    (u.output * rate.output) / 1_000_000
  );
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
