import { cookies } from "next/headers";
import type { RedactMode } from "./redact";

export const DEMO_COOKIE = "atv_demo";

/** 데모 모드 여부는 쿠키로 들고 다닌다. 페이지마다 쿼리스트링을 이어 붙이지 않아도 되게 */
export async function getRedactMode(): Promise<RedactMode> {
  const store = await cookies();
  return store.get(DEMO_COOKIE)?.value === "1" ? "demo" : "off";
}
