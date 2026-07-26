/**
 * Server-side HTML rendering for the /admin console. No frontend build step -
 * pages are plain HTML strings with a little inline CSS. Kept deliberately
 * small and dependency-free.
 */

export interface UserRow {
    id: string;
    username: string | null;
    displayName: string;
    createdAt: Date;
    viaGithub: boolean;
    sessionCount: number;
    machineCount: number;
}

export interface OnlineRow {
    id: string;
    username: string | null;
    displayName: string;
    connections: { clientType: string; sessionId?: string; machineId?: string }[];
}

export interface UserDetailRow {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    publicKey: string;
    createdAt: Date;
    updatedAt: Date;
    viaGithub: boolean;
    githubLogin: string | null;
    sessionCount: number;
    machineCount: number;
    recentSessions: { id: string; createdAt: Date; lastActiveAt: Date | null; active: boolean }[];
    recentMachines: { id: string; createdAt: Date; lastActiveAt: Date | null; active: boolean }[];
}

const CLIENT_LABELS: Record<string, string> = {
    "user-scoped": "App",
    "session-scoped": "CLI",
    "machine-scoped": "Daemon",
};

export function clientLabel(t: string): string {
    return CLIENT_LABELS[t] ?? t;
}

function esc(s: string | null | undefined): string {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function fmtDate(d: Date | null | undefined): string {
    if (!d) return "—";
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return "—";
    return dt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

function layout(title: string, body: string, isAdmin: boolean): string {
    const nav = isAdmin
        ? `<nav class="nav">
             <a href="/admin">Users</a>
             <a href="/admin/online">Online</a>
             <form method="post" action="/admin/logout" class="inline"><button type="submit">Logout</button></form>
           </nav>`
        : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Happy Admin</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #f6f7f9; }
  header { background: #111; color: #fff; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header a.brand { color: #fff; text-decoration: none; }
  .nav { margin-left: auto; display: flex; gap: 12px; align-items: center; }
  .nav a { color: #cfcfcf; text-decoration: none; }
  .nav a:hover { color: #fff; }
  .nav button { background: none; border: 1px solid #555; color: #cfcfcf; padding: 3px 10px; border-radius: 4px; cursor: pointer; font: inherit; }
  .nav .inline { display: inline; margin: 0; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  h2 { margin: 0 0 16px; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.06); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: #666; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafcff; }
  td.mono, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  a.row { color: #0a58ca; text-decoration: none; }
  a.row:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; background: #eef; color: #335; }
  .badge.gh { background: #e6f4ea; color: #137333; }
  .badge.key { background: #fef7e0; color: #7a5a00; }
  .badge.online { background: #e6f4ea; color: #137333; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; background: #eef; color: #335; margin-right: 4px; }
  .muted { color: #888; }
  .pager { margin-top: 16px; display: flex; gap: 8px; align-items: center; }
  .pager a, .pager span { padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; text-decoration: none; color: #333; background: #fff; }
  .pager a:hover { background: #f0f0f0; }
  .card { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.06); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .kv { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; }
  .kv dt { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  .kv dd { margin: 0; word-break: break-all; }
  .login { max-width: 340px; margin: 80px auto; }
  .login input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font: inherit; margin-bottom: 12px; }
  .login button { width: 100%; padding: 10px; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; font: inherit; }
  .err { color: #b00020; margin-bottom: 12px; }
  .empty { padding: 32px; text-align: center; color: #888; }
  .stat { display: inline-block; margin-right: 24px; }
  .stat b { font-size: 20px; display: block; }
</style>
</head>
<body>
<header>
  <a class="brand" href="/admin"><h1>Happy Admin</h1></a>
  ${nav}
</header>
<main>
${body}
</main>
</body>
</html>`;
}

export function loginPage(error?: string): string {
    const err = error ? `<div class="err">${esc(error)}</div>` : "";
    return layout(
        "Login",
        `<div class="login card">
           <h2>Admin login</h2>
           ${err}
           <form method="post" action="/admin/login">
             <input name="password" type="password" placeholder="Admin password" autofocus required>
             <button type="submit">Sign in</button>
           </form>
         </div>`,
        false,
    );
}

export function disabledPage(): string {
    return layout(
        "Disabled",
        `<div class="card"><h2>Admin console disabled</h2>
         <p class="muted">Set the <code>ADMIN_TOKEN</code> environment variable (at least 8 characters) to enable the admin console.</p></div>`,
        false,
    );
}

export function usersListPage(rows: UserRow[], page: number, pageSize: number, total: number): string {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    const prev = page > 1 ? `<a href="/admin?page=${page - 1}">‹ Prev</a>` : `<span class="muted">‹ Prev</span>`;
    const next = page < totalPages ? `<a href="/admin?page=${page + 1}">Next ›</a>` : `<span class="muted">Next ›</span>`;
    const body = rows.length === 0
        ? `<h2>Users</h2><div class="empty">No registered users yet.</div>`
        : `<h2>Users <span class="muted">(${total} total)</span></h2>
           <table>
             <thead><tr><th>Username</th><th>Name</th><th>Registered</th><th>Login</th><th>Sessions</th><th>Machines</th></tr></thead>
             <tbody>
             ${rows.map(r => `<tr>
               <td><a class="row" href="/admin/users/${encodeURIComponent(r.id)}">${esc(r.username) || `<span class="muted">${shortId(r.id)}</span>`}</a></td>
               <td>${esc(r.displayName) || `<span class="muted">—</span>`}</td>
               <td class="mono">${fmtDate(r.createdAt)}</td>
               <td>${r.viaGithub ? `<span class="badge gh">GitHub</span>` : `<span class="badge key">Key</span>`}</td>
               <td>${r.sessionCount}</td>
               <td>${r.machineCount}</td>
             </tr>`).join("")}
             </tbody>
           </table>
           <div class="pager">${prev}<span>Page ${page} / ${totalPages} · ${from}-${to}</span>${next}</div>`;
    return layout("Users", body, true);
}

export function onlinePage(rows: OnlineRow[], totalUsers: number): string {
    const body = rows.length === 0
        ? `<h2>Online users</h2><div class="empty">No one is online right now.</div>`
        : `<h2>Online users <span class="muted">(${rows.length} online, ${totalUsers} registered)</span></h2>
           <table>
             <thead><tr><th>Username</th><th>Name</th><th>Connections</th><th>Detail</th></tr></thead>
             <tbody>
             ${rows.map(r => {
                 const pills = r.connections.map(c => `<span class="pill">${esc(clientLabel(c.clientType))}</span>`).join("");
                 const detail = r.connections.map(c => {
                     const parts = [clientLabel(c.clientType)];
                     if (c.sessionId) parts.push(`session ${shortId(c.sessionId)}`);
                     if (c.machineId) parts.push(`machine ${shortId(c.machineId)}`);
                     return parts.join(" · ");
                 }).join("<br>");
                 return `<tr>
                   <td><a class="row" href="/admin/users/${encodeURIComponent(r.id)}">${esc(r.username) || `<span class="muted">${shortId(r.id)}</span>`}</a></td>
                   <td>${esc(r.displayName) || `<span class="muted">—</span>`}</td>
                   <td>${pills} <span class="muted">×${r.connections.length}</span></td>
                   <td class="mono">${detail}</td>
                 </tr>`;
             }).join("")}
             </tbody>
           </table>`;
    return layout("Online", body, true);
}

export function userDetailPage(u: UserDetailRow): string {
    const sessRows = u.recentSessions.length === 0
        ? `<tr><td colspan="4" class="muted">None</td></tr>`
        : u.recentSessions.map(s => `<tr>
            <td class="mono">${shortId(s.id)}</td>
            <td class="mono">${fmtDate(s.createdAt)}</td>
            <td class="mono">${fmtDate(s.lastActiveAt)}</td>
            <td>${s.active ? `<span class="badge online">active</span>` : `<span class="muted">idle</span>`}</td>
          </tr>`).join("");
    const machRows = u.recentMachines.length === 0
        ? `<tr><td colspan="4" class="muted">None</td></tr>`
        : u.recentMachines.map(m => `<tr>
            <td class="mono">${shortId(m.id)}</td>
            <td class="mono">${fmtDate(m.createdAt)}</td>
            <td class="mono">${fmtDate(m.lastActiveAt)}</td>
            <td>${m.active ? `<span class="badge online">online</span>` : `<span class="muted">offline</span>`}</td>
          </tr>`).join("");
    const body = `
      <p><a href="/admin" class="row">‹ Back to users</a></p>
      <h2>${esc(u.username) || `<span class="muted">unnamed</span>`}</h2>
      <div class="card">
        <dl class="kv">
          <dt>Display name</dt><dd>${esc([u.firstName, u.lastName].filter(Boolean).join(" ")) || `<span class="muted">—</span>`}</dd>
          <dt>Account ID</dt><dd class="mono">${esc(u.id)}</dd>
          <dt>Public key</dt><dd class="mono">${esc(u.publicKey.slice(0, 24))}…<span class="muted"> (${u.publicKey.length} chars)</span></dd>
          <dt>Login</dt><dd>${u.viaGithub ? `<span class="badge gh">GitHub</span>${u.githubLogin ? ` @${esc(u.githubLogin)}` : ""}` : `<span class="badge key">Key</span>`}</dd>
          <dt>Registered</dt><dd class="mono">${fmtDate(u.createdAt)}</dd>
          <dt>Updated</dt><dd class="mono">${fmtDate(u.updatedAt)}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="stat"><b>${u.sessionCount}</b> sessions</div>
        <div class="stat"><b>${u.machineCount}</b> machines</div>
      </div>
      <h3>Recent sessions</h3>
      <table>
        <thead><tr><th>ID</th><th>Created</th><th>Last active</th><th>State</th></tr></thead>
        <tbody>${sessRows}</tbody>
      </table>
      <h3 style="margin-top:24px">Recent machines</h3>
      <table>
        <thead><tr><th>ID</th><th>Created</th><th>Last active</th><th>State</th></tr></thead>
        <tbody>${machRows}</tbody>
      </table>`;
    return layout("User detail", body, true);
}

export function notFoundPage(): string {
    return layout("Not found", `<div class="card"><h2>404</h2><p class="muted">Not found.</p></div>`, true);
}
