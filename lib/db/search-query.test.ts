import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFtsQuery } from "./queries";

/**
 * 사용자 입력을 FTS5 문법으로 그대로 흘려보내면 두 가지가 깨진다.
 * 구문 오류로 검색이 실패하거나, 입력한 낱말이 연산자로 해석돼 엉뚱한 결과가 나온다.
 */
describe("toFtsQuery", () => {
  test("낱말을 따옴표로 감싸 AND로 잇는다", () => {
    assert.equal(toFtsQuery("gradle compileJava"), '"gradle" AND "compileJava"');
  });

  test("한 낱말도 따옴표로 감싼다", () => {
    assert.equal(toFtsQuery("반품"), '"반품"');
  });

  test("공백이 여러 개여도 낱말만 남긴다", () => {
    assert.equal(toFtsQuery("  a   b  "), '"a" AND "b"');
  });

  describe("연산자를 리터럴로 다룬다", () => {
    // FTS5는 이 낱말들을 문법으로 읽는다. 사용자는 그냥 검색어로 친 것이다
    for (const word of ["AND", "OR", "NOT", "NEAR"]) {
      test(word, () => {
        assert.equal(toFtsQuery(word), `"${word}"`);
      });
    }

    test("별표는 접두 검색이 아니라 글자 그대로", () => {
      assert.equal(toFtsQuery("build*"), '"build*"');
    });

    test("괄호와 콜론도 그대로", () => {
      assert.equal(toFtsQuery("foo(bar) baz:qux"), '"foo(bar)" AND "baz:qux"');
    });
  });

  test("따옴표는 이스케이프해 구문을 깨뜨리지 않는다", () => {
    // 이스케이프하지 않으면 문자열 리터럴이 조기에 닫혀 구문 오류가 난다
    assert.equal(toFtsQuery('say "hi"'), '"say" AND """hi"""');
  });

  test("빈 입력은 질의를 만들지 않는다", () => {
    assert.equal(toFtsQuery(""), null);
    assert.equal(toFtsQuery("    "), null);
  });
});
