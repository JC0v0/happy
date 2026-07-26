import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
    ADMIN_COOKIE_NAME,
    adminTokenConfigured,
    verifyAdminPassword,
    signSession,
    verifySession,
    buildSetCookieHeader,
    buildClearCookieHeader,
    parseCookie,
    isAdminAuthenticated,
    issueSession,
} from "./adminAuth";

describe("adminAuth", () => {
    const origSecret = process.env.HANDY_MASTER_SECRET;
    const origToken = process.env.ADMIN_TOKEN;

    beforeAll(() => {
        process.env.HANDY_MASTER_SECRET = "test-master-secret-for-admin-auth-tests";
        process.env.ADMIN_TOKEN = "correct-horse-battery-staple";
    });
    afterAll(() => {
        process.env.HANDY_MASTER_SECRET = origSecret;
        process.env.ADMIN_TOKEN = origToken;
    });

    describe("adminTokenConfigured", () => {
        it("returns true when ADMIN_TOKEN >= 8 chars", () => {
            expect(adminTokenConfigured()).toBe(true);
        });
        it("returns false when ADMIN_TOKEN missing", () => {
            const saved = process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_TOKEN;
            expect(adminTokenConfigured()).toBe(false);
            process.env.ADMIN_TOKEN = saved;
        });
        it("returns false when ADMIN_TOKEN too short", () => {
            const saved = process.env.ADMIN_TOKEN;
            process.env.ADMIN_TOKEN = "short";
            expect(adminTokenConfigured()).toBe(false);
            process.env.ADMIN_TOKEN = saved;
        });
    });

    describe("verifyAdminPassword", () => {
        it("accepts the correct password", () => {
            expect(verifyAdminPassword("correct-horse-battery-staple")).toBe(true);
        });
        it("rejects a wrong password", () => {
            expect(verifyAdminPassword("wrong-password-hereeee")).toBe(false);
        });
        it("rejects when ADMIN_TOKEN not set", () => {
            const saved = process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_TOKEN;
            expect(verifyAdminPassword("correct-horse-battery-staple")).toBe(false);
            process.env.ADMIN_TOKEN = saved;
        });
    });

    describe("session sign / verify", () => {
        it("verifies a freshly issued session", () => {
            const { token, expiresAt } = issueSession();
            expect(expiresAt).toBeGreaterThan(Date.now());
            expect(verifySession(token)).toBe(true);
        });
        it("verifies a token signed with explicit future expiry", () => {
            const token = signSession(Date.now() + 1000);
            expect(verifySession(token)).toBe(true);
        });
        it("rejects an expired token", () => {
            const token = signSession(Date.now() - 1000);
            expect(verifySession(token)).toBe(false);
        });
        it("rejects a tampered payload (expiry changed)", () => {
            const token = signSession(Date.now() + 1000);
            const dot = token.lastIndexOf(".");
            // bump the expiry digit so the signature no longer matches
            const tampered = token.slice(0, dot - 1) + "9" + token.slice(dot - 1);
            expect(verifySession(tampered)).toBe(false);
        });
        it("rejects a tampered signature", () => {
            const token = signSession(Date.now() + 1000);
            const dot = token.lastIndexOf(".");
            const tampered = token.slice(0, dot + 1) + "0".repeat(64);
            expect(verifySession(tampered)).toBe(false);
        });
        it("rejects undefined / malformed tokens", () => {
            expect(verifySession(undefined)).toBe(false);
            expect(verifySession("")).toBe(false);
            expect(verifySession("no-dot-here")).toBe(false);
            expect(verifySession(".onlymac")).toBe(false);
        });
    });

    describe("cookies", () => {
        it("buildSetCookieHeader is HttpOnly + SameSite=Lax + Path=/admin + Max-Age", () => {
            const token = signSession(Date.now() + 1000);
            const h = buildSetCookieHeader(token);
            expect(h).toContain(`${ADMIN_COOKIE_NAME}=${token}`);
            expect(h).toContain("HttpOnly");
            expect(h).toContain("SameSite=Lax");
            expect(h).toContain("Path=/admin");
            expect(h).toContain("Max-Age=");
        });
        it("buildClearCookieHeader clears with Max-Age=0", () => {
            const h = buildClearCookieHeader();
            expect(h).toContain(`${ADMIN_COOKIE_NAME}=`);
            expect(h).toContain("Max-Age=0");
        });
        it("parseCookie extracts the admin_sess value among others", () => {
            const token = signSession(Date.now() + 1000);
            const header = `foo=bar; ${ADMIN_COOKIE_NAME}=${token}; baz=qux`;
            expect(parseCookie(header)).toBe(token);
        });
        it("parseCookie returns undefined when absent", () => {
            expect(parseCookie("foo=bar")).toBeUndefined();
            expect(parseCookie(undefined)).toBeUndefined();
        });
    });

    describe("isAdminAuthenticated", () => {
        it("returns true for a request with a valid cookie", () => {
            const token = signSession(Date.now() + 1000);
            expect(isAdminAuthenticated({ headers: { cookie: `${ADMIN_COOKIE_NAME}=${token}` } })).toBe(true);
        });
        it("returns false when there is no cookie header", () => {
            expect(isAdminAuthenticated({ headers: {} })).toBe(false);
        });
        it("returns false for an invalid cookie value", () => {
            expect(isAdminAuthenticated({ headers: { cookie: `${ADMIN_COOKIE_NAME}=garbage` } })).toBe(false);
        });
    });
});
