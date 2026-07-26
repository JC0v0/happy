import { createHmac, timingSafeEqual } from "crypto";

/**
 * Admin authentication for the /admin management console.
 *
 * - A single admin password is configured via `ADMIN_TOKEN`. If missing or
 *   shorter than 8 chars, the whole console is disabled (routes 404), so a
 *   fresh deploy never exposes it by accident.
 * - On login we issue an HttpOnly + SameSite=Lax + Path=/admin cookie carrying
 *   a timestamp + HMAC-SHA256 signature derived from HANDY_MASTER_SECRET.
 * - No third-party cookie plugin: cookie is set/read by hand (zero deps).
 */

const COOKIE_NAME = "admin_sess";
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function signingKey(): string {
    const secret = process.env.HANDY_MASTER_SECRET;
    if (!secret) throw new Error("HANDY_MASTER_SECRET not set");
    return `${secret}:admin-cookie-v1`;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;

export function adminTokenConfigured(): boolean {
    const t = process.env.ADMIN_TOKEN;
    return typeof t === "string" && t.length >= 8;
}

/** Constant-time password check against ADMIN_TOKEN. */
export function verifyAdminPassword(password: string): boolean {
    const t = process.env.ADMIN_TOKEN;
    if (!t) return false;
    const a = Buffer.from(password);
    const b = Buffer.from(t);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export function signSession(expiresAt: number): string {
    const payload = String(expiresAt);
    const mac = createHmac("sha256", signingKey()).update(payload).digest("hex");
    return `${payload}.${mac}`;
}

export function verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.lastIndexOf(".");
    if (dot < 1) return false;
    const payload = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = createHmac("sha256", signingKey()).update(payload).digest("hex");
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
    const exp = Number(payload);
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    return true;
}

export function buildSetCookieHeader(token: string): string {
    const maxAge = Math.floor(COOKIE_TTL_MS / 1000);
    return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=${maxAge}`;
}

export function buildClearCookieHeader(): string {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/admin; Max-Age=0`;
}

export function parseCookie(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === COOKIE_NAME) {
            return part.slice(eq + 1).trim();
        }
    }
    return undefined;
}

export function isAdminAuthenticated(request: { headers: Record<string, string | string[] | undefined> }): boolean {
    const cookieHeader = request.headers.cookie as string | undefined;
    return verifySession(parseCookie(cookieHeader));
}

export function issueSession(): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + COOKIE_TTL_MS;
    return { token: signSession(expiresAt), expiresAt };
}
