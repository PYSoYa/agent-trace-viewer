import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { before, describe, test } from "node:test";
import { CodexAdapter } from "./codex";
import { promptTokens, type ParsedTrace } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "__fixtures__", "codex");
const INDEX = join(ROOT, "session_index.jsonl");

describe("CodexAdapter", () => {
  let trace: ParsedTrace;

  before(async () => {
    const adapter = new CodexAdapter(ROOT, INDEX);
    const files = await adapter.discover();
    // session_index.jsonl은 롤아웃이 아니므로 트레이스를 만들지 않는다
    const traces = (await Promise.all(files.map((f) => adapter.parse(f)))).flat();
    assert.equal(traces.length, 1, "롤아웃 파일 하나만 트레이스가 되어야 한다");
    trace = traces[0];
  });

  test("날짜 디렉터리를 재귀로 훑는다", () => {
    assert.equal(trace.session.source, "codex");
    assert.equal(trace.session.id, "codex:abc123");
  });

  describe("토큰 계상", () => {
    // Codex의 cached_input_tokens는 input_tokens의 부분집합이다.
    // Anthropic처럼 별도 항목으로 옮기면 입력을 두 번 세게 된다.
    test("캐시분을 입력에서 빼서 옮긴다", () => {
      // 턴1 input 1000(cached 800), 턴2 input 2000(cached 1600)
      assert.equal(trace.session.tokens.cacheRead, 2400);
      assert.equal(trace.session.tokens.input, 1100); // (1000-800)+(2000-1600)+(500-0)
    });

    test("프롬프트 총량이 원본 input 합과 같다", () => {
      // 두 번 세지 않았다면 input + cacheRead가 원본 input 합(3000)과 맞는다
      assert.equal(promptTokens(trace.session.tokens), 3500);
    });

    // total_token_usage는 누적값이라 last와 같이 더하면 중복이 된다
    test("누적값이 아니라 턴별 사용량만 더한다", () => {
      assert.equal(trace.session.tokens.output, 95); // 50 + 30 + 15
    });

    // Claude Code 어댑터와 같은 불변식. 여기서도 한 번 새서 잡았다
    test("스텝 토큰 합계가 세션 합계와 정확히 일치한다", () => {
      const stepOutput = trace.steps.reduce((sum, s) => sum + (s.tokens?.output ?? 0), 0);
      const stepPrompt = trace.steps.reduce(
        (sum, s) => sum + (s.tokens ? promptTokens(s.tokens) : 0),
        0,
      );
      assert.equal(stepOutput, trace.session.tokens.output);
      assert.equal(stepPrompt, promptTokens(trace.session.tokens));
    });

    test("Codex는 캐시 쓰기 개념이 없어 0이다", () => {
      assert.equal(trace.session.tokens.cacheWrite5m, 0);
      assert.equal(trace.session.tokens.cacheWrite1h, 0);
    });

    test("단가를 아는 모델이므로 비용이 계산된다", () => {
      assert.ok(trace.session.costUsd > 0);
      assert.deepEqual(trace.session.unpricedModels, []);
    });
  });

  describe("스텝 추출", () => {
    test("사고·툴 호출·툴 결과·어시스턴트 응답을 남긴다", () => {
      const kinds = trace.steps.map((s) => s.kind);
      assert.deepEqual(kinds, [
        "user_prompt", // IDE 머리말 (스텝으로는 남는다)
        "user_prompt",
        "thinking",
        "tool_call",
        "tool_result",
        "tool_call",
        "tool_result",
        "assistant_text",
      ]);
    });

    // Codex는 실패 플래그를 주지 않고 출력 머리에 종료 코드를 적는다
    test("종료 코드 0이 아닌 툴 결과를 실패로 센다", () => {
      assert.equal(trace.session.errorCount, 1);
      const failed = trace.steps.find((s) => s.isError);
      assert.equal(failed?.toolUseId, "call_2");
    });

    test("결과 스텝에 호출한 툴 이름을 이어붙인다", () => {
      // 결과 레코드에는 이름이 없어 call_id로 되찾아야 한다
      const results = trace.steps.filter((s) => s.kind === "tool_result");
      assert.deepEqual(
        results.map((s) => s.toolName),
        ["shell", "apply_patch"],
      );
    });

    test("JSON 문자열 인자에서 파일 경로를 뽑는다", () => {
      const patch = trace.steps.find((s) => s.toolName === "apply_patch" && s.kind === "tool_call");
      assert.equal(patch?.filePath, "/tmp/demo-project/src/App.ts");
    });

    test("잘린 마지막 줄을 무시한다", () => {
      assert.equal(trace.steps.length, 8);
    });
  });

  describe("세션 메타", () => {
    test("Codex가 붙인 이름을 제목으로 쓴다", () => {
      // 첫 프롬프트보다 훨씬 읽기 좋다
      assert.equal(trace.session.title, "픽스처 Codex 세션");
    });

    test("IDE가 끼워 넣은 머리말은 첫 프롬프트로 잡지 않는다", () => {
      assert.equal(trace.session.firstPrompt, "실제 첫 프롬프트");
    });

    test("cwd로 프로젝트를 구분한다", () => {
      // 날짜로만 나눠 저장돼서 경로 말고는 프로젝트 단서가 없다
      assert.equal(trace.session.projectName, "demo-project");
      assert.equal(trace.session.projectSlug, "codex:/tmp/demo-project");
    });

    test("활동 시간은 유휴를 뺀다", () => {
      // 기록은 0s~11s에 몰려 있고 마지막은 20분 뒤다
      assert.equal(trace.session.activeMs, 8_000);
      assert.ok(trace.session.durationMs > trace.session.activeMs);
    });

    test("PR 링크 개념이 없어 빈 배열", () => {
      assert.deepEqual(trace.prLinks, []);
    });
  });
});
