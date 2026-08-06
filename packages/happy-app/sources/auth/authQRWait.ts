import axios from 'axios';
import { decodeBase64, encodeBase64 } from '../encryption/base64';
import { getServerUrl } from '@/sync/serverConfig';
import { QRAuthKeyPair } from './authQRStart';
import { decryptBox } from '@/encryption/libsodium';
import { getHappyClientId } from '@/sync/apiSocket';

export interface AuthCredentials {
    secret: Uint8Array;
    token: string;
}

// Tolerate a few consecutive poll failures before giving up: a single transient
// network blip during the (long) wait-for-approval phase shouldn't fail the
// whole restore/link flow with a confusing "authentication failed".
const MAX_CONSECUTIVE_ERRORS = 5;

export async function authQRWait(keypair: QRAuthKeyPair, onProgress?: (dots: number) => void, shouldCancel?: () => boolean): Promise<AuthCredentials | null> {
    let dots = 0;
    let consecutiveErrors = 0;
    const serverUrl = getServerUrl();
    const endpoint = `${serverUrl}/v1/auth/account/request`;

    while (true) {
        if (shouldCancel && shouldCancel()) {
            return null;
        }

        try {
            const response = await axios.post(endpoint, {
                publicKey: encodeBase64(keypair.publicKey),
            }, {
                headers: {
                    'X-Happy-Client': getHappyClientId(),
                }
            });

            consecutiveErrors = 0;

            if (response.data.state === 'authorized') {
                const token = response.data.token as string;
                const encryptedResponse = decodeBase64(response.data.response);
                
                const decrypted = decryptBox(encryptedResponse, keypair.secretKey);
                if (decrypted) {
                    console.log('\n\nAuthentication successful\n');
                    return {
                        secret: decrypted,
                        token: token
                    };
                } else {
                    console.log('\n\nFailed to decrypt response. Please try again.');
                    return null;
                }
            }
        } catch (error) {
            consecutiveErrors++;
            const detail = axios.isAxiosError(error)
                ? `${error.message}${error.response ? ` (HTTP ${error.response.status})` : ''}`
                : error instanceof Error ? error.message : String(error);
            console.log(`\n\nFailed to check authentication status (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${detail}`);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                return null;
            }
        }

        // Call progress callback if provided
        if (onProgress) {
            onProgress(dots);
        }
        dots++;

        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}
