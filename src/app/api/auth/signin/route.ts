import { z } from "zod";
import { signIn } from "@/server/auth";
import { errorResponse, json, parseBody, setSessionCookie } from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("A valid email address is required"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, bodySchema);
    const { token } = await signIn(body);
    const res = json({ ok: true });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
