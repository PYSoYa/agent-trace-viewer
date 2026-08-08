/**
 * 화면에 내보내기 직전의 변환을 한곳에 모은다.
 * 페이지마다 마스킹을 직접 부르면 한 군데만 빠뜨려도 그대로 새기 때문이다.
 */
import {
  anonymizePath,
  anonymizeProject,
  anonymizeRepo,
  anonymizeTitle,
  projectKey,
  redactSecrets,
  renderText,
  type RedactMode,
} from "./redact";

export type { RedactMode };
export { projectKey };

export function presentTitle(title: string | null, mode: RedactMode): string | null {
  if (title === null) return null;
  return mode === "demo" ? anonymizeTitle(title) : redactSecrets(title);
}

export function presentProject(name: string, mode: RedactMode): string {
  return mode === "demo" ? anonymizeProject(name) : name;
}

export function presentBranch(branch: string | null, mode: RedactMode): string | null {
  if (branch === null) return null;
  // 브랜치 이름에 티켓 번호나 고객사명이 들어가는 경우가 많다
  return mode === "demo" ? anonymizeProject(branch) : branch;
}

export function presentPath(path: string, mode: RedactMode): string {
  return mode === "demo" ? anonymizePath(path) : path;
}

/** 프롬프트·어시스턴트 응답·툴 결과 같은 자유 텍스트 */
export function presentText(text: string | null, mode: RedactMode): string | null {
  return renderText(text, mode);
}

export type PresentedPr = {
  label: string;
  repository: string;
  href: string | null;
};

export function presentPr(
  pr: { number: number; url: string; repository: string },
  mode: RedactMode,
): PresentedPr {
  if (mode === "demo") {
    return {
      label: `#${pr.number}`,
      repository: anonymizeRepo(pr.repository),
      // 링크를 남기면 가명이 무의미해진다
      href: null,
    };
  }
  return { label: `#${pr.number}`, repository: pr.repository, href: pr.url };
}
