"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/mode";

export async function toggleDemoMode(): Promise<void> {
  const store = await cookies();
  const on = store.get(DEMO_COOKIE)?.value === "1";
  store.set(DEMO_COOKIE, on ? "0" : "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  // 모든 페이지의 표시가 바뀌므로 레이아웃 단위로 다시 그린다
  revalidatePath("/", "layout");
}
