/**
 * 렌더 직전에 거는 마스킹.
 *
 * 로그에는 에이전트가 본 것이 그대로 들어 있다. 실제 세션에서 Bearer 토큰, 개인키 블록,
 * `SECRET=` 대입이 발견됐다. DB에는 원문을 그대로 두고 화면에 나갈 때만 가린다 —
 * 인덱스는 원본에서 언제든 다시 만들 수 있어야 하고, 원문을 지우면 그게 깨진다.
 *
 * 두 단계로 나뉜다.
 *  - redactSecrets: 항상 적용. 토큰처럼 생긴 것만 가린다
 *  - 데모 모드: 여기에 더해 식별자를 가명으로 바꾸고 본문을 숨긴다 (스크린샷용)
 */

export type RedactMode = "off" | "demo";

type SecretRule = { name: string; pattern: RegExp };

/**
 * 값이 새는 것보다 과하게 가리는 쪽이 낫다.
 * 다만 경로·일반 문장을 통째로 먹지 않도록 각 패턴은 충분히 구체적이어야 한다.
 */
const SECRET_RULES: SecretRule[] = [
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "openai-key", pattern: /\bsk-(?!ant-)[A-Za-z0-9]{20,}/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: "aws-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: "bearer", pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  {
    name: "private-key",
    pattern: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
  },
  { name: "url-credentials", pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi },
  /*
   * 대입문에서 값만 가리고 키 이름은 남긴다 — 무엇이 가려졌는지 보여야 쓸모가 있다.
   *
   * 키 이름을 대소문자 구분 없이 부분 일치시키면 `const tokenCount = usage.output_tokens`
   * 같은 평범한 코드가 통째로 먹힌다. 그래서 두 가지 좁은 형태만 인정한다.
   */
  {
    // 1) 환경변수 스타일: 전부 대문자여야 한다
    name: "env-assignment",
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/g,
  },
  {
    // 2) JSON 스타일: 키가 따옴표로 감싸여 있어야 한다
    name: "json-assignment",
    pattern:
      /(["'])([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|credential)[A-Za-z0-9_.-]*)\1(\s*:\s*)(["'])([^"']{6,})\4/gi,
  },
];

const MASK = "‹redacted›";

export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of SECRET_RULES) {
    switch (rule.name) {
      case "url-credentials":
        out = out.replace(rule.pattern, (_m, scheme: string) => `${scheme}${MASK}@`);
        break;
      case "env-assignment":
        out = out.replace(
          rule.pattern,
          (_m, key: string, sep: string, quote: string) => `${key}${sep}${quote}${MASK}${quote}`,
        );
        break;
      case "json-assignment":
        out = out.replace(
          rule.pattern,
          (_m, kq: string, key: string, sep: string, vq: string) =>
            `${kq}${key}${kq}${sep}${vq}${MASK}${vq}`,
        );
        break;
      case "bearer":
        out = out.replace(rule.pattern, (_m, scheme: string) => `${scheme} ${MASK}`);
        break;
      default:
        out = out.replace(rule.pattern, MASK);
    }
  }
  return out;
}

/** 문자열을 안정적인 숫자로. 같은 입력은 늘 같은 가명을 받는다 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const ADJECTIVES = [
  "amber", "brisk", "calm", "dusk", "ember", "fern", "glide", "harbor",
  "ivory", "jade", "kite", "lumen", "mesa", "nova", "onyx", "prism",
];
const NOUNS = [
  "atlas", "beacon", "cedar", "delta", "echo", "forge", "grove", "haven",
  "inlet", "jetty", "kiln", "lagoon", "meadow", "nimbus", "orbit", "quarry",
];

function pseudonym(input: string, sep = "-"): string {
  const h = hash(input);
  return `${ADJECTIVES[h % ADJECTIVES.length]}${sep}${NOUNS[(h >> 8) % NOUNS.length]}`;
}

/**
 * URL에 실을 프로젝트 식별자.
 * 프로젝트 슬러그는 `-Users-<사용자>-devel-<회사프로젝트>` 꼴이라 그대로 쓰면
 * 주소창과 링크에 경로가 다 드러난다. 데모 모드와 무관하게 늘 불투명한 값을 쓴다.
 */
export function projectKey(slug: string): string {
  return hash(slug).toString(36);
}

/** owner/repo 형태를 통째로 가명화하되 모양은 유지한다 */
export function anonymizeRepo(slug: string): string {
  if (!slug.includes("/")) return pseudonym(slug);
  const [owner, name] = slug.split("/", 2);
  return `${pseudonym(owner)}/${pseudonym(name)}`;
}

export function anonymizeProject(name: string): string {
  return pseudonym(name);
}

/**
 * 경로는 모양(깊이·확장자)을 남기고 각 구간만 가명으로 바꾼다.
 * 구조가 보여야 스크린샷이 쓸모 있고, 이름이 가려져야 안전하다.
 */
export function anonymizePath(path: string): string {
  const withHome = path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  return withHome
    .split("/")
    .map((seg) => {
      if (seg === "" || seg === "~" || seg === "." || seg === "..") return seg;
      const dot = seg.lastIndexOf(".");
      // 확장자는 남긴다 — 무슨 종류의 파일인지가 정보의 핵심이다
      if (dot > 0) return `${pseudonym(seg.slice(0, dot))}${seg.slice(dot)}`;
      return pseudonym(seg);
    })
    .join("/");
}

/** 산문은 가명화가 불가능하다. 분량만 남기고 감춘다 */
export function hideProse(text: string | null): string | null {
  if (text === null) return null;
  if (text.trim() === "") return text;
  return `(demo mode · ${text.length.toLocaleString()} chars hidden)`;
}

/** 제목은 길이만 흉내 낸 가명으로 바꾼다 */
export function anonymizeTitle(title: string): string {
  return `${pseudonym(title, " ")} work`;
}

/** 화면에 나가는 자유 텍스트에 거는 최종 필터 */
export function renderText(text: string | null, mode: RedactMode): string | null {
  if (text === null) return null;
  if (mode === "demo") return hideProse(text);
  return redactSecrets(text);
}
