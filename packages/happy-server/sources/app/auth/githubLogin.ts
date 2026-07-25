import { db } from "@/storage/db";
import { encryptString } from "@/modules/encrypt";
import { log } from "@/utils/log";
import { GitHubProfile } from "@/app/api/types";

interface GithubTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

/**
 * Exchange a GitHub OAuth code for the user's GitHub profile, then upsert the
 * Account bound to that GitHub user id.
 *
 * GitHub validates *who the user is* - it replaces the challenge/signature
 * step in POST /v1/auth. The Ed25519 publicKey is still generated client-side
 * and remains the encryption identity; the server only stores its hex form.
 *
 * First call for a GitHub id = register (creates the Account + GithubUser and
 * binds the publicKey). Subsequent calls = login (returns the existing
 * Account; publicKey is NOT rotated, matching /v1/auth semantics).
 *
 * Unlike /v1/connect/github (which binds GitHub to an already-authenticated
 * user), this is an *entry* auth path: the client has no token yet, so the
 * publicKey travels alongside the code and the Account is keyed by
 * githubUserId. Avatar upload is skipped here - the connect flow can run
 * later if the user wants the profile photo.
 */
export async function githubLogin(publicKeyHex: string, code: string): Promise<{ userId: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("GitHub OAuth not configured");
    }

    // Exchange the one-time code for an access token.
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
        }),
    });
    const tokenData = await tokenResponse.json() as GithubTokenResponse;
    if (tokenData.error || !tokenData.access_token) {
        log(
            { module: "github-auth", level: "error" },
            `GitHub token exchange failed: ${tokenData.error} ${tokenData.error_description}`,
        );
        throw new Error(`GitHub auth failed: ${tokenData.error_description ?? tokenData.error ?? "unknown error"}`);
    }
    const accessToken = tokenData.access_token;

    // Fetch the GitHub profile (id is the stable identity; login/avatar can change).
    const userResponse = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
        },
    });
    if (!userResponse.ok) {
        log(
            { module: "github-auth", level: "error" },
            `GitHub profile fetch failed: ${userResponse.status}`,
        );
        throw new Error(`GitHub profile fetch failed: ${userResponse.status}`);
    }
    const profile = await userResponse.json() as GitHubProfile;
    const githubUserId = profile.id.toString();

    // Persist / refresh the GithubUser record FIRST - Account.githubUserId is
    // a foreign key to GithubUser.id, so the parent must exist before we can
    // upsert the Account. Profile + encrypted access token are stored here.
    await db.githubUser.upsert({
        where: { id: githubUserId },
        update: {
            profile,
        },
        create: {
            id: githubUserId,
            profile,
        },
    });

    // Upsert Account by githubUserId: first time creates it bound to this
    // publicKey, later logins just refresh updatedAt.
    const account = await db.account.upsert({
        where: { githubUserId },
        update: { updatedAt: new Date() },
        create: {
            publicKey: publicKeyHex,
            githubUserId,
            username: profile.login,
        },
    });

    // Now that we have the Account id, store the encrypted access token on
    // the GithubUser record (token is encrypted with the account id as part
    // of the key path, mirroring githubConnect).
    await db.githubUser.update({
        where: { id: githubUserId },
        data: {
            token: encryptString(["user", account.id, "github", "token"], accessToken),
        },
    });

    log({ module: "github-auth" }, `GitHub login ok: userId=${account.id} github=${profile.login}`);
    return { userId: account.id };
}
