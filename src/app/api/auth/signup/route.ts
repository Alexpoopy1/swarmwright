import { z } from "zod";
import { signIn, signUp } from "@/server/auth";
import { errorResponse, json, parseBody, setSessionCookie } from "@/app/api/_utils";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("A valid email address is required"),
  name: z.string().min(1, "Name is required").max(120),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, bodySchema);
    const { userId } = await signUp(body);
    // Sign in immediately so the user lands straight in the workspace.
    const { token } = await signIn({ email: body.email, password: body.password });
    const res = json({ userId }, 201);
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
