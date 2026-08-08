import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  anonymizePath,
  anonymizeRepo,
  hideProse,
  redactSecrets,
  renderText,
} from "./redact";

const MASK = "‹가림›";

describe("redactSecrets", () => {
  // 실제 세션 로그에서 발견된 종류들
  const cases: [string, string][] = [
    ["anthropic 키", "key=sk-ant-api03-AbCdEf0123456789XyZ"],
    ["openai 키", "OPENAI sk-proj0123456789abcdefGHIJ"],
    ["github 토큰", "token ghp_ABCdef0123456789ABCdef0123456789ABCD"],
    ["github PAT", "github_pat_11ABCDEFG0123456789_abcdefgh"],
    ["AWS 액세스 키", "AKIAIOSFODNN7EXAMPLE"],
    ["구글 키", "AIzaSyB1234567890abcdefghijklmnopqrstuv"],
    ["슬랙 토큰", "xoxb-1234567890-abcdefghijkl"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K"],
  ];

  for (const [name, input] of cases) {
    test(`${name}을 가린다`, () => {
      const out = redactSecrets(input);
      assert.ok(out.includes(MASK), `가려지지 않음: ${out}`);
    });
  }

  test("Bearer 토큰은 스킴을 남기고 값만 가린다", () => {
    const out = redactSecrets("Authorization: Bearer abcdef0123456789ABCDEF");
    assert.equal(out, `Authorization: Bearer ${MASK}`);
  });

  test("개인키 블록을 통째로 가린다", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----";
    assert.equal(redactSecrets(`before\n${pem}\nafter`), `before\n${MASK}\nafter`);
  });

  test("KEY=value에서 키 이름은 남기고 값만 가린다", () => {
    // 무엇이 가려졌는지 보여야 디버깅에 쓸모가 있다
    const out = redactSecrets("DB_PASSWORD=hunter2supersecret");
    assert.equal(out, `DB_PASSWORD=${MASK}`);
  });

  test("JSON 형태의 토큰 값도 가린다", () => {
    const out = redactSecrets('{"api_key": "abcdef0123456789"}');
    assert.ok(out.includes(MASK));
    assert.ok(out.includes("api_key"), "키 이름은 남아야 한다");
  });

  test("URL에 박힌 자격증명을 가린다", () => {
    const out = redactSecrets("https://user:p4ssw0rd@example.com/repo.git");
    assert.equal(out, `https://${MASK}@example.com/repo.git`);
  });

  describe("과잉 마스킹 방지", () => {
    // 로그 대부분은 평범한 명령어와 경로다. 이게 먹히면 도구가 쓸모없어진다
    const benign = [
      "pnpm build && pnpm test",
      "/Users/dev/project/src/main/App.java",
      "git commit -m 'fix: 토큰 계산 오류'",
      "SELECT COUNT(*) FROM sessions WHERE cost_usd > 10",
      "https://github.com/owner/repo/pull/203",
      "const tokenCount = usage.output_tokens;",
    ];
    for (const text of benign) {
      test(`그대로 둔다: ${text.slice(0, 34)}`, () => {
        assert.equal(redactSecrets(text), text);
      });
    }
  });
});

describe("데모 모드 가명화", () => {
  test("같은 입력은 항상 같은 가명을 받는다", () => {
    // 한 화면 안에서 같은 프로젝트가 다른 이름으로 보이면 안 된다
    assert.equal(anonymizeRepo("acme/api"), anonymizeRepo("acme/api"));
    assert.equal(anonymizePath("/a/b/c.ts"), anonymizePath("/a/b/c.ts"));
  });

  test("다른 입력은 다른 가명을 받는다", () => {
    assert.notEqual(anonymizeRepo("acme/api"), anonymizeRepo("acme/web"));
  });

  test("저장소는 owner/name 모양을 유지한다", () => {
    const out = anonymizeRepo("SomeOrg/some-service");
    assert.match(out, /^[a-z]+-[a-z]+\/[a-z]+-[a-z]+$/);
    assert.ok(!out.includes("SomeOrg") && !out.includes("some-service"));
  });

  test("경로는 홈을 접고 확장자를 남긴다", () => {
    const out = anonymizePath("/Users/someone/devel/proj/src/App.tsx");
    assert.ok(out.startsWith("~/"), out);
    assert.ok(out.endsWith(".tsx"), "확장자는 남아야 파일 종류를 알 수 있다");
    assert.ok(!out.includes("someone") && !out.includes("proj"));
    assert.equal(out.split("/").length, "~/devel/proj/src/App.tsx".split("/").length);
  });

  test("본문은 분량만 남기고 감춘다", () => {
    const out = hideProse("a".repeat(1234));
    assert.ok(out?.includes("1,234"));
    assert.ok(!out?.includes("aaaa"));
  });

  test("빈 문자열은 그대로 둔다", () => {
    assert.equal(hideProse(""), "");
    assert.equal(hideProse(null), null);
  });
});

describe("renderText", () => {
  const secret = "export GITHUB_TOKEN=ghp_ABCdef0123456789ABCdef0123456789ABCD";

  test("기본 모드에서는 시크릿만 가린다", () => {
    const out = renderText(secret, "off");
    assert.ok(out?.includes(MASK));
    assert.ok(out?.includes("export"), "나머지는 읽을 수 있어야 한다");
  });

  test("데모 모드에서는 본문 전체를 감춘다", () => {
    const out = renderText(secret, "demo");
    assert.ok(!out?.includes("export"));
    assert.ok(!out?.includes("ghp_"));
  });

  test("null은 통과시킨다", () => {
    assert.equal(renderText(null, "off"), null);
    assert.equal(renderText(null, "demo"), null);
  });
});
