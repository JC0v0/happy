import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import axios from 'axios';
import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { getHappyClientId } from '@/sync/apiSocket';

// GitHub OAuth App client ID. This is public - safe to ship in the client
// bundle. The matching client secret lives only on the server
// (GITHUB_CLIENT_SECRET) and is used when exchanging the code for a token.
const GITHUB_CLIENT_ID = 'Ov23liiIMnJBew4OSiYO';

// OAuth callback. Native uses the app scheme (intercepted by expo-web-browser);
// web has no custom scheme so it uses the current page origin. Every value used
// here must be registered as an Authorization callback URL in the GitHub OAuth
// App settings, otherwise GitHub rejects the authorization request.
const GITHUB_REDIRECT_URI = Platform.OS === 'web'
    ? (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:8081')
    : 'happy://auth';

/**
 * Derive the Ed25519 public key from a 32-byte seed, mirroring authChallenge.
 * GitHub login uses this publicKey as the E2E identity; the private key stays
 * on-device (derived from the same seed the caller persists via auth.login).
 */
export function derivePublicKey(secret: Uint8Array): Uint8Array {
    const keypair = sodium.crypto_sign_seed_keypair(secret);
    return keypair.publicKey;
}

/**
 * Open the GitHub OAuth consent screen and return the authorization code.
 * Uses expo-web-browser's auth session so the redirect is intercepted back
 * into the app (no browser tab left behind). Native only - the happy://
 * scheme callback is not valid on web.
 */
export async function githubAuthRequest(): Promise<string> {
    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_REDIRECT_URI,
        scope: 'read:user',
    });
    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, GITHUB_REDIRECT_URI);
    if (result.type !== 'success' || !result.url) {
        throw new Error('GitHub authorization cancelled');
    }
    const code = new URL(result.url).searchParams.get('code');
    if (!code) {
        throw new Error('GitHub authorization did not return a code');
    }
    return code;
}

/**
 * Exchange the GitHub code + the device's public key for a Happy auth token.
 * The server verifies the code with GitHub, upserts the Account keyed by
 * githubUserId, and returns a token. First call registers, later calls log in.
 */
export async function githubGetToken(publicKey: Uint8Array, code: string): Promise<string> {
    const API_ENDPOINT = getServerUrl();
    const response = await axios.post(
        `${API_ENDPOINT}/v1/auth/github`,
        { code, publicKey: encodeBase64(publicKey) },
        { headers: { 'X-Happy-Client': getHappyClientId() } },
    );
    return response.data.token;
}
