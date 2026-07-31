import { cookies } from "next/headers";
import { SESSION_COOKIE, signOut } from "@/server/auth";
import { clearSessionCookie, errorResponse, json } from "@/app/api/_utils";

export const runtime = "nodejs";

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) await signOut(token);
    const res = json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
