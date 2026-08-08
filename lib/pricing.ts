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

  /*
   * OpenAI (Codex). 캐시 입력이 정확히 입력의 0.1배라 아래 캐시 배수가 그대로 맞는다.
   * 확인: developers.openai.com/api/docs/models/gpt-5.5 (2026-08)
   *
   * 반영하지 않은 것: 입력이 272K를 넘는 요청은 입력 2배·출력 1.5배로 매겨진다.
   * 턴별 입력 크기를 봐야 해서 지금은 넣지 않았고, 그만큼 과소 집계될 수 있다.
   */
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
};

/*
 * 단가표에 없는 모델은 비용을 '모름'으로 둔다.
 *
 * 예전에는 Opus 단가로 대신 계산했는데, 다른 제공자의 모델(gpt-5.4 등)이 들어오면서
 * 그게 돈 숫자를 지어내는 짓이 됐다. 0으로 두면 비용이 새는 걸 못 보고,
 * 아무 단가나 쓰면 틀린 값을 사실처럼 보여준다. 모르면 모른다고 표시한다.
 *
 * 단가를 아는 모델은 아래 RATES에 추가하면 그때부터 계산된다.
 */

export function isKnownModel(model: string): boolean {
  return normalize(model) in RATES;
}

function normalize(model: string): string {
  // Bedrock 프리픽스와 날짜 접미사를 벗겨 별칭으로 맞춘다
  const bare = model.replace(/^anthropic\./, "");
  if (bare in RATES) return bare;
  const undated = bare.replace(/-\d{8}$/, "");
  if (undated in RATES) return undated;
  // gpt-5.4-2026-01-31 처럼 날짜가 하이픈으로 붙는 형태도 맞춘다
  return undated.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function rateFor(model: string, atIso: string): Rate | null {
  const entry = RATES[normalize(model)];
  if (!entry) return null;
  if (entry.intro && atIso <= entry.intro.until) {
    return { input: entry.intro.input, output: entry.intro.output };
  }
  return { input: entry.input, output: entry.output };
}

/**
 * 단일 모델 호출의 비용(USD). 단가를 모르는 모델은 null을 돌려준다.
 * atIso는 프로모션 단가 적용 판정에만 쓰인다.
 */
export function costOf(model: string, u: TokenUsage, atIso: string): number | null {
  const rate = rateFor(model, atIso);
  if (!rate) return null;
  const perToken = rate.input / 1_000_000;
  return (
    u.input * perToken +
    u.cacheWrite5m * perToken * 1.25 +
    u.cacheWrite1h * perToken * 2 +
    u.cacheRead * perToken * 0.1 +
    (u.output * rate.output) / 1_000_000
  );
}

export function formatUsd(v: number | null): string {
  // 단가를 모르는 모델은 0원이 아니라 '모름'이다
  if (v === null) return "—";
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
