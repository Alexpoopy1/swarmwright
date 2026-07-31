import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/server/db";

/**
 * Authentication & session management (SPEC §4.1).
 *
 * Passwords are hashed with bcryptjs. Sessions are DB rows with a random
 * 256-bit hex token and a 30-day expiry; route handlers set the token in an
 * httpOnly sameSite=lax cookie named SESSION_COOKIE.
 */

export const SESSION_COOKIE = "sw_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class AuthError extends Error {
  constructor(
    public code: string,
    msg?: string
  ) {
    super(msg ?? code);
    this.name = "AuthError";
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function signUp(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ userId: string }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new AuthError("duplicate_email", "An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await db.user.create({
    data: { email, name: input.name.trim(), passwordHash },
  });
  // Every user gets a default personal workspace. Nothing else is created here.
  await db.workspace.create({
    data: { name: "Personal", ownerId: user.id },
  });
  return { userId: user.id };
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new AuthError("invalid_credentials", "Invalid email or password");
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AuthError("invalid_credentials", "Invalid email or password");

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { userId: user.id, token, expiresAt } });
  return { token, expiresAt };
}

export async function signOut(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } });
}

/**
 * Look up the user for a session token. Exported for testability; the
 * cookie-based `getSessionUser` delegates to this.
 */
export async function getUserByToken(token: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("unauthorized", "Authentication required");
  return user;
}

export async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const workspace = await db.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
  });
  if (!workspace) throw new AuthError("no_workspace", "User has no workspace");
  return workspace.id;
}
