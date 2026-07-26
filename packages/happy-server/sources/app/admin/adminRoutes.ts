import { Fastify } from "../api/types";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { eventRouter } from "@/app/events/eventRouter";
import type { GitHubProfile } from "@/app/api/types";
import {
    adminTokenConfigured,
    verifyAdminPassword,
    issueSession,
    buildSetCookieHeader,
    buildClearCookieHeader,
    isAdminAuthenticated,
} from "./adminAuth";
import {
    loginPage,
    disabledPage,
    usersListPage,
    onlinePage,
    userDetailPage,
    notFoundPage,
    type UserRow,
    type OnlineRow,
    type UserDetailRow,
} from "./adminViews";

const PAGE_SIZE = 50;

function displayName(firstName: string | null, lastName: string | null, username: string | null): string {
    const name = [firstName, lastName].filter(Boolean).join(" ").trim();
    return name || username || "";
}

function html(reply: any, body: string, code = 200): void {
    reply.code(code).type("text/html; charset=utf-8").send(body);
}

/** Returns true if the request may proceed; otherwise sends a redirect/404. */
function guard(request: any, reply: any): boolean {
    if (!adminTokenConfigured()) {
        html(reply, disabledPage(), 404);
        return false;
    }
    if (!isAdminAuthenticated(request)) {
        reply.redirect("/admin/login");
        return false;
    }
    return true;
}

export function adminRoutes(app: Fastify): void {
    // Parse HTML form submissions (login form posts application/x-www-form-urlencoded).
    // Fastify does not parse this content type by default; we add a tiny zero-dep
    // parser so the admin login form works without @fastify/formbody.
    app.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string" },
        (_req, body, done) => {
            try {
                done(null, Object.fromEntries(new URLSearchParams(body as string)));
            } catch (e) {
                done(e as Error, undefined);
            }
        },
    );

    // --- Login (public, but 404s if ADMIN_TOKEN is not configured) ---
    app.get("/admin/login", async (_request, reply) => {
        if (!adminTokenConfigured()) {
            html(reply, disabledPage(), 404);
            return;
        }
        html(reply, loginPage());
    });

    app.post("/admin/login", async (request, reply) => {
        if (!adminTokenConfigured()) {
            html(reply, disabledPage(), 404);
            return;
        }
        const body = (request.body ?? {}) as Record<string, unknown>;
        const password = typeof body.password === "string" ? body.password : "";
        if (!verifyAdminPassword(password)) {
            log({ module: "admin" }, "Failed admin login attempt");
            html(reply, loginPage("Incorrect password"));
            return;
        }
        const { token } = issueSession();
        reply.header("Set-Cookie", buildSetCookieHeader(token));
        reply.redirect("/admin");
    });

    app.post("/admin/logout", async (_request, reply) => {
        reply.header("Set-Cookie", buildClearCookieHeader());
        reply.redirect("/admin/login");
    });

    // --- User list (paginated, read-only) ---
    app.get("/admin", async (request, reply) => {
        if (!guard(request, reply)) return;
        const page = Math.max(1, parseInt(String((request.query as any).page ?? "1"), 10) || 1);
        const skip = (page - 1) * PAGE_SIZE;
        const [accounts, total] = await Promise.all([
            db.account.findMany({
                orderBy: { createdAt: "desc" },
                skip,
                take: PAGE_SIZE,
                include: {
                    _count: { select: { Session: true, Machine: true } },
                    githubUser: true,
                },
            }),
            db.account.count(),
        ]);
        const rows: UserRow[] = accounts.map((a) => ({
            id: a.id,
            username: a.username,
            displayName: displayName(a.firstName, a.lastName, a.username),
            createdAt: a.createdAt,
            viaGithub: !!a.githubUserId,
            sessionCount: a._count.Session,
            machineCount: a._count.Machine,
        }));
        html(reply, usersListPage(rows, page, PAGE_SIZE, total));
    });

    // --- Online users (live socket connections on this instance) ---
    app.get("/admin/online", async (request, reply) => {
        if (!guard(request, reply)) return;
        const online = eventRouter.getOnlineUsers();
        const ids = online.map((o) => o.userId);
        const accounts = ids.length === 0
            ? []
            : await db.account.findMany({
                where: { id: { in: ids } },
                select: { id: true, username: true, firstName: true, lastName: true },
            });
        const byId = new Map(accounts.map((a) => [a.id, a]));
        const rows: OnlineRow[] = online.map((o) => {
            const a = byId.get(o.userId);
            return {
                id: o.userId,
                username: a?.username ?? null,
                displayName: a ? displayName(a.firstName, a.lastName, a.username) : "",
                connections: o.connections,
            };
        });
        const totalUsers = await db.account.count();
        html(reply, onlinePage(rows, totalUsers));
    });

    // --- User detail ---
    app.get("/admin/users/:id", async (request, reply) => {
        if (!guard(request, reply)) return;
        const id = (request.params as any).id as string;
        const a = await db.account.findUnique({
            where: { id },
            include: {
                githubUser: true,
                _count: { select: { Session: true, Machine: true } },
                Session: {
                    orderBy: { createdAt: "desc" },
                    take: 20,
                    select: { id: true, createdAt: true, lastActiveAt: true, active: true },
                },
                Machine: {
                    orderBy: { createdAt: "desc" },
                    take: 20,
                    select: { id: true, createdAt: true, lastActiveAt: true, active: true },
                },
            },
        });
        if (!a) {
            html(reply, notFoundPage(), 404);
            return;
        }
        const profile = a.githubUser?.profile as GitHubProfile | null | undefined;
        const detail: UserDetailRow = {
            id: a.id,
            username: a.username,
            firstName: a.firstName,
            lastName: a.lastName,
            publicKey: a.publicKey,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            viaGithub: !!a.githubUserId,
            githubLogin: profile?.login ?? null,
            sessionCount: a._count.Session,
            machineCount: a._count.Machine,
            recentSessions: a.Session.map((s) => ({
                id: s.id,
                createdAt: s.createdAt,
                lastActiveAt: s.lastActiveAt,
                active: s.active,
            })),
            recentMachines: a.Machine.map((m) => ({
                id: m.id,
                createdAt: m.createdAt,
                lastActiveAt: m.lastActiveAt,
                active: m.active,
            })),
        };
        html(reply, userDetailPage(detail));
    });
}
