import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  presentBranch,
  presentPath,
  presentPr,
  presentProject,
  presentText,
  presentTitle,
  projectKey,
} from "./present";

/** 실제 로그에 있던 모양을 본뜬 값들 */
const SLUG = "-Users-someone-devel-AcmeCorp-full";
const REPO = "AcmeCorp/billing-service";
const PATH = "/Users/someone/devel/AcmeCorp-full/src/main/Billing.java";
const TITLE = "결제 모듈 리팩터링";
const BRANCH = "feature/ACME-1234-billing";

describe("projectKey", () => {
  // 슬러그가 URL에 실리면 주소창과 링크에 사내 경로가 그대로 드러난다
  test("원본 슬러그 조각을 담지 않는다", () => {
    const key = projectKey(SLUG);
    for (const part of ["Users", "someone", "devel", "AcmeCorp"]) {
      assert.ok(!key.includes(part), `키에 ${part}가 남아 있다: ${key}`);
    }
  });

  test("같은 슬러그는 같은 키, 다른 슬러그는 다른 키", () => {
    assert.equal(projectKey(SLUG), projectKey(SLUG));
    assert.notEqual(projectKey(SLUG), projectKey(`${SLUG}-2`));
  });

  test("URL에 그대로 넣을 수 있는 문자만 쓴다", () => {
    assert.match(projectKey(SLUG), /^[a-z0-9]+$/);
  });
});

describe("데모 모드 유출 방지", () => {
  const secrets = ["someone", "AcmeCorp", "acmecorp", "billing", "Billing", "ACME"];

  function assertClean(value: string | null, label: string) {
    assert.ok(value !== null, `${label}이 null이면 안 된다`);
    for (const s of secrets) {
      assert.ok(!value.includes(s), `${label}에 "${s}"가 남아 있다: ${value}`);
    }
  }

  test("프로젝트명", () => assertClean(presentProject(SLUG, "demo"), "프로젝트명"));
  test("파일 경로", () => assertClean(presentPath(PATH, "demo"), "경로"));
  test("브랜치", () => assertClean(presentBranch(BRANCH, "demo"), "브랜치"));
  test("제목", () => assertClean(presentTitle(TITLE, "demo"), "제목"));

  test("본문", () => {
    const text = `AcmeCorp 결제 서버의 someone 계정으로 접속`;
    assertClean(presentText(text, "demo"), "본문");
  });

  test("PR은 링크를 없애고 저장소를 가명으로 바꾼다", () => {
    const pr = { number: 203, url: `https://github.com/${REPO}/pull/203`, repository: REPO };
    const shown = presentPr(pr, "demo");
    // 링크를 남기면 가명이 무의미해진다
    assert.equal(shown.href, null);
    assertClean(shown.repository, "PR 저장소");
    // 번호는 남긴다 — 구조가 보여야 화면이 쓸모 있다
    assert.equal(shown.label, "#203");
  });
});

describe("기본 모드는 내용을 보존한다", () => {
  test("이름과 경로를 바꾸지 않는다", () => {
    assert.equal(presentProject(SLUG, "off"), SLUG);
    assert.equal(presentPath(PATH, "off"), PATH);
    assert.equal(presentBranch(BRANCH, "off"), BRANCH);
    assert.equal(presentTitle(TITLE, "off"), TITLE);
  });

  test("PR 링크를 살려둔다", () => {
    const pr = { number: 203, url: `https://github.com/${REPO}/pull/203`, repository: REPO };
    const shown = presentPr(pr, "off");
    assert.equal(shown.href, pr.url);
    assert.equal(shown.repository, REPO);
  });

  test("본문에서 시크릿은 여전히 가린다", () => {
    const out = presentText("Authorization: Bearer abcdef0123456789ABCDEF", "off");
    assert.ok(!out?.includes("abcdef0123456789"));
  });
});
