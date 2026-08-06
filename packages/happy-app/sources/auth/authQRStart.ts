import { getRandomBytes } from 'expo-crypto';
import sodium from '@/encryption/libsodium.lib';
import axios from 'axios';
import { encodeBase64 } from '../encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { getHappyClientId } from '@/sync/apiSocket';

export interface QRAuthKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

/**
 * Why an auth request can fail, so callers can surface something more
 * useful than a generic "authentication failed" alert.
 */
export type AuthQRStartFailure = 'network' | 'unauthorized' | 'server' | 'unknown';

export interface AuthQRStartResult {
    ok: boolean;
    failure?: AuthQRStartFailure;
}

export function generateAuthKeyPair(): QRAuthKeyPair {
    const secret = getRandomBytes(32);
    const keypair = sodium.crypto_box_seed_keypair(secret);
    return {
        publicKey: keypair.publicKey,
        secretKey: keypair.privateKey,
    };
}

function classifyAuthError(error: unknown): AuthQRStartFailure {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status) {
            if (status === 401 || status === 403) {
                return 'unauthorized';
            }
            if (status >= 500) {
                return 'server';
            }
            // Other 4xx (e.g. malformed request) - not a reachability issue.
            return 'unknown';
        }
        // No HTTP response: DNS failure, connection refused, timeout, offline.
        return 'network';
    }
    return 'unknown';
}

export async function authQRStart(keypair: QRAuthKeyPair): Promise<AuthQRStartResult> {
    try {
        const serverUrl = getServerUrl();
        const endpoint = `${serverUrl}/v1/auth/account/request`;

        if (process.env.EXPO_PUBLIC_DEBUG) {
            console.log(`[AUTH DEBUG] Sending auth request to: ${endpoint}`);
            console.log(`[AUTH DEBUG] Public key: ${encodeBase64(keypair.publicKey).substring(0, 20)}...`);
        }

        await axios.post(endpoint, {
            publicKey: encodeBase64(keypair.publicKey),
        }, {
            headers: {
                'X-Happy-Client': getHappyClientId(),
            }
        });

        if (process.env.EXPO_PUBLIC_DEBUG) {
            console.log('[AUTH DEBUG] Auth request sent successfully');
        }
        return { ok: true };
    } catch (error) {
        const failure = classifyAuthError(error);
        const detail = axios.isAxiosError(error)
            ? `${error.message}${error.response ? ` (HTTP ${error.response.status})` : ''}`
            : error instanceof Error ? error.message : String(error);
        console.error(`[AUTH] Failed to create authentication request (${failure}): ${detail}`);
        return { ok: false, failure };
    }
}
