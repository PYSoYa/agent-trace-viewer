import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { costOf, isKnownModel } from "./pricing";
import { emptyUsage, type TokenUsage } from "./trace/types";

const AT = "2026-01-01T00:00:00.000Z";

function usage(over: Partial<TokenUsage>): TokenUsage {
  return { ...emptyUsage(), ...over };
}

describe("costOf", () => {
  test("입력·출력을 100만 토큰 단가로 계산한다", () => {
    // opus-5: input $5 / output $25 per MTok
    const cost = costOf("claude-opus-5", usage({ input: 1_000_000, output: 1_000_000 }), AT);
    assert.equal(cost, 30);
  });

  describe("캐시 배수", () => {
    test("5분 캐시 쓰기는 입력 단가의 1.25배", () => {
      const cost = costOf("claude-opus-5", usage({ cacheWrite5m: 1_000_000 }), AT);
      assert.equal(cost, 5 * 1.25);
    });

    test("1시간 캐시 쓰기는 입력 단가의 2배", () => {
      const cost = costOf("claude-opus-5", usage({ cacheWrite1h: 1_000_000 }), AT);
      assert.equal(cost, 5 * 2);
    });

    test("캐시 읽기는 입력 단가의 0.1배", () => {
      const cost = costOf("claude-opus-5", usage({ cacheRead: 1_000_000 }), AT);
      assert.ok(Math.abs(cost - 0.5) < 1e-9);
    });
  });

  test("픽스처 세션의 비용이 손으로 계산한 값과 맞는다", () => {
    // input 15, output 150, cacheWrite5m 280, cacheRead 3000 @ opus-5
    const cost = costOf(
      "claude-opus-5",
      usage({ input: 15, output: 150, cacheWrite5m: 280, cacheRead: 3000 }),
      AT,
    );
    assert.ok(Math.abs(cost - 0.007075) < 1e-9, `계산값 ${cost}`);
  });

  describe("프로모션 단가", () => {
    const u = usage({ input: 1_000_000, output: 1_000_000 });

    test("종료일 이전에는 인트로 단가를 쓴다", () => {
      // sonnet-5 인트로: $2 / $10 (2026-08-31까지)
      assert.equal(costOf("claude-sonnet-5", u, "2026-08-01T00:00:00Z"), 12);
    });

    test("종료일 이후에는 정가로 돌아간다", () => {
      // sonnet-5 정가: $3 / $15
      assert.equal(costOf("claude-sonnet-5", u, "2026-09-01T00:00:00Z"), 18);
    });
  });

  describe("모델 ID 정규화", () => {
    test("Bedrock 프리픽스를 벗긴다", () => {
      assert.equal(
        costOf("anthropic.claude-haiku-4-5", usage({ output: 1_000_000 }), AT),
        5,
      );
    });

    test("날짜 접미사를 벗긴다", () => {
      assert.equal(costOf("claude-haiku-4-5-20251001", usage({ output: 1_000_000 }), AT), 5);
    });
  });

  test("모르는 모델도 0원으로 떨어뜨리지 않는다", () => {
    // 조용히 0이 되면 비용이 새는 걸 눈치채지 못한다
    assert.equal(isKnownModel("claude-future-9"), false);
    assert.ok(costOf("claude-future-9", usage({ output: 1_000_000 }), AT) > 0);
  });

  test("사용량이 없으면 0원", () => {
    assert.equal(costOf("claude-opus-5", emptyUsage(), AT), 0);
  });
});
