import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { before, describe, test } from "node:test";
import { ClaudeCodeAdapter } from "./claude-code";
import { promptTokens, type ParsedTrace } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(here, "__fixtures__", "projects");
const PARENT_ID = "11111111-1111-1111-1111-111111111111";

describe("ClaudeCodeAdapter", () => {
  let traces: ParsedTrace[];
  let parent: ParsedTrace;
  let subagent: ParsedTrace;

  before(async () => {
    const adapter = new ClaudeCodeAdapter(FIXTURE_ROOT);
    const files = await adapter.discover();
    traces = (await Promise.all(files.map((f) => adapter.parse(f)))).flat();
    const found = traces.find((t) => t.session.agentId === null);
    const foundSub = traces.find((t) => t.session.agentId !== null);
    assert.ok(found && foundSub, "부모와 서브에이전트 트레이스가 모두 나와야 한다");
    parent = found;
    subagent = foundSub;
  });

  test("서브에이전트 파일까지 재귀로 찾는다", () => {
    assert.equal(traces.length, 2);
  });

  describe("토큰 계상", () => {
    // 한 assistant 메시지가 message.id를 공유하는 여러 줄로 쪼개져 들어온다.
    // 줄마다 같은 usage가 실려 있어 줄 단위로 더하면 부풀려진다.
    test("같은 message.id의 usage를 한 번만 계상한다", () => {
      // msg_A(3줄) + msg_B(2줄). 줄 단위 합산이면 output이 100*3 + 50*2 = 400이 된다
      assert.equal(parent.session.tokens.output, 150);
      assert.equal(parent.session.tokens.input, 15);
      assert.equal(parent.session.tokens.cacheRead, 3000);
    });

    // usage는 메시지의 첫 줄에 실리는데 그 줄은 보통 thinking 블록만 담고 있다.
    // 사고 블록을 스텝으로 만들지 않으면 그 줄과 함께 usage가 통째로 버려진다.
    test("스텝 토큰 합계가 세션 합계와 정확히 일치한다", () => {
      const stepOutput = parent.steps.reduce((sum, s) => sum + (s.tokens?.output ?? 0), 0);
      const stepPrompt = parent.steps.reduce(
        (sum, s) => sum + (s.tokens ? promptTokens(s.tokens) : 0),
        0,
      );
      assert.equal(stepOutput, parent.session.tokens.output);
      assert.equal(stepPrompt, promptTokens(parent.session.tokens));
    });

    test("메시지의 usage는 그 메시지의 첫 스텝에만 붙는다", () => {
      const withTokens = parent.steps.filter((s) => s.tokens !== null);
      assert.equal(withTokens.length, 2, "메시지가 둘이므로 토큰이 붙은 스텝도 둘이어야 한다");
      assert.deepEqual(
        withTokens.map((s) => s.kind),
        ["thinking", "thinking"],
        "두 메시지 모두 첫 블록이 thinking이므로 거기에 붙어야 한다",
      );
    });

    test("cache_creation 세부가 없으면 총량을 5분 캐시로 본다", () => {
      // msg_A는 세부 200(5m), msg_B는 세부 없이 총량 80
      assert.equal(parent.session.tokens.cacheWrite5m, 280);
      assert.equal(parent.session.tokens.cacheWrite1h, 0);
    });
  });

  describe("스텝 추출", () => {
    test("사고·텍스트·툴 호출·툴 결과를 모두 스텝으로 남긴다", () => {
      const kinds = parent.steps.map((s) => s.kind);
      assert.deepEqual(kinds, [
        "user_prompt", // /clear (메타지만 스텝으로는 남는다)
        "user_prompt",
        "thinking",
        "assistant_text",
        "tool_call",
        "tool_result",
        "thinking",
        "tool_call",
        "tool_result",
        "system",
      ]);
    });

    test("툴 호출 수와 에러 수를 센다", () => {
      assert.equal(parent.session.toolCallCount, 2);
      assert.equal(parent.session.errorCount, 1);
    });

    test("툴 인자를 원문 JSON으로 보존한다", () => {
      const call = parent.steps.find((s) => s.toolName === "Bash");
      assert.ok(call?.toolInput);
      assert.deepEqual(JSON.parse(call.toolInput), {
        command: "ls -la",
        description: "목록 확인",
      });
    });

    test("툴 결과를 tool_use_id로 이어붙인다", () => {
      const result = parent.steps.find((s) => s.kind === "tool_result" && s.isError);
      assert.equal(result?.toolUseId, "toolu_2");
    });

    test("잘린 마지막 줄을 무시하고 나머지를 살린다", () => {
      // 픽스처 마지막 줄은 파일이 쓰이는 도중처럼 JSON이 잘려 있다
      assert.equal(parent.steps.length, 10);
    });
  });

  describe("세션 메타", () => {
    test("슬래시 명령 같은 메타 텍스트는 첫 프롬프트로 잡지 않는다", () => {
      assert.equal(parent.session.firstPrompt, "실제 첫 프롬프트");
    });

    test("제목·브랜치·기간을 채운다", () => {
      assert.equal(parent.session.title, "픽스처 세션 제목");
      assert.equal(parent.session.gitBranch, "main");
      assert.equal(parent.session.projectName, "demo-project");
      assert.equal(parent.session.durationMs, 600_000);
    });

    test("<synthetic>이 아닌 모델만 모은다", () => {
      assert.deepEqual(parent.session.models, ["claude-opus-5"]);
    });
  });

  describe("서브에이전트", () => {
    // 서브에이전트 로그의 sessionId는 부모와 같다.
    // 그대로 쓰면 기본키가 겹쳐 부모 세션 행을 덮어쓴다.
    test("부모 ID를 침범하지 않는 합성 ID를 쓴다", () => {
      assert.equal(parent.session.id, PARENT_ID);
      assert.equal(subagent.session.id, `${PARENT_ID}:agent-deadbeef`);
      assert.notEqual(subagent.session.id, parent.session.id);
    });

    test("부모를 가리키고 자기 agentId를 갖는다", () => {
      assert.equal(subagent.session.parentSessionId, PARENT_ID);
      assert.equal(subagent.session.agentId, "agent-deadbeef");
      assert.equal(parent.session.parentSessionId, null);
      assert.equal(parent.session.agentId, null);
    });

    test("서브에이전트 사용량은 부모 합계에 섞이지 않는다", () => {
      assert.equal(subagent.session.tokens.output, 7);
      assert.equal(parent.session.tokens.output, 150);
    });
  });
});
