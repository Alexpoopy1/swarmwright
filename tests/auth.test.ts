import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import {
  AuthError,
  getDefaultWorkspaceId,
  getUserByToken,
  SESSION_COOKIE,
  signIn,
  signOut,
  signUp,
} from "@/server/auth";

describe("auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("exposes the session cookie name", () => {
    expect(SESSION_COOKIE).toBe("sw_session");
  });

  it("signs up, creating a default Personal workspace", async () => {
    const db = await testDb();
    const { userId } = await signUp({
      email: "ada@example.com",
      name: "Ada",
      password: "correct horse battery",
    });
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe("correct horse battery");

    const workspaceId = await getDefaultWorkspaceId(userId);
    const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
    expect(workspace!.name).toBe("Personal");
  });

  it("rejects duplicate emails", async () => {
    await signUp({ email: "dup@example.com", name: "One", password: "password-1" });
    await expect(
      signUp({ email: "dup@example.com", name: "Two", password: "password-2" })
    ).rejects.toMatchObject({ code: "duplicate_email" });
  });

  it("signs in and issues a 30-day session token", async () => {
    await signUp({ email: "grace@example.com", name: "Grace", password: "s3cret!!" });
    const { token, expiresAt } = await signIn({
      email: "grace@example.com",
      password: "s3cret!!",
    });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const days = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it("throws AuthError(invalid_credentials) on a wrong password", async () => {
    await signUp({ email: "alan@example.com", name: "Alan", password: "right-pass" });
    await expect(
      signIn({ email: "alan@example.com", password: "wrong-pass" })
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      signIn({ email: "ghost@example.com", password: "right-pass" })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("resolves the session user from the token row, and signOut invalidates it", async () => {
    await signUp({ email: "katherine@example.com", name: "Katherine", password: "passw0rd!" });
    const { token } = await signIn({ email: "katherine@example.com", password: "passw0rd!" });

    const user = await getUserByToken(token);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("katherine@example.com");
    expect(user!.name).toBe("Katherine");

    await signOut(token);
    expect(await getUserByToken(token)).toBeNull();
  });
});
