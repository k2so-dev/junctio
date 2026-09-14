import { eq, lt } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { sessions } from "../../db/schema.ts";
import { getSetting, setSetting } from "../../db/settings.ts";
import { randomToken, timingSafeEqual } from "../../crypto.ts";

export const SESSION_COOKIE = "junctio_session";
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;

export function needsSetup(db: Db): boolean {
  return getSetting(db, "admin_password_hash") === "";
}

export async function setAdminPassword(db: Db, password: string): Promise<void> {
  const hash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
  setSetting(db, "admin_password_hash", hash);
}

export async function verifyAdminPassword(db: Db, password: string): Promise<boolean> {
  const hash = getSetting(db, "admin_password_hash");
  if (hash === "") return false;
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export function createSession(db: Db): { id: string; expiresAt: number } {
  const id = randomToken(48);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.insert(sessions).values({ id, createdAt: Date.now(), expiresAt }).run();
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  return { id, expiresAt };
}

export function destroySession(db: Db, id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function sessionValid(db: Db, id: string): boolean {
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return false;
  if (row.expiresAt <= Date.now()) {
    destroySession(db, id);
    return false;
  }
  return true;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(id: string, secure: boolean, maxAgeSec = SESSION_TTL_MS / 1000): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeSec)}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}

export function isAdmin(db: Db, request: Request, adminToken: string | null): boolean {
  if (adminToken) {
    const header = request.headers.get("authorization");
    const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    const presented = match?.[1] ?? request.headers.get("x-admin-token");
    if (presented && timingSafeEqual(presented, adminToken)) return true;
  }
  const cookie = readCookie(request, SESSION_COOKIE);
  return cookie ? sessionValid(db, cookie) : false;
}
