import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { RoundButton } from '@/components/RoundButton';
import { Typography } from '@/constants/Typography';
import { encodeBase64 } from '@/encryption/base64';
import { generateAuthKeyPair, authQRStart, type AuthQRStartFailure } from '@/auth/authQRStart';
import { authQRWait } from '@/auth/authQRWait';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { localizedText, t } from '@/text';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { QRCode } from '@/components/qr/QRCode';

const stylesheet = StyleSheet.create((theme) => ({
    scrollView: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    container: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    contentWrapper: {
        width: '100%',
        maxWidth: layout.maxWidth,
        paddingVertical: 24,
    },
    secondInstructionText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        marginBottom: 20,
        marginTop: 30,
        ...Typography.default(),
    },
    qrInstructions: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginBottom: 16,
        lineHeight: 22,
        textAlign: 'center',
        ...Typography.default(),
    },
    waitingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 16,
    },
    waitingText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    textInput: {
        backgroundColor: theme.colors.input.background,
        padding: 16,
        borderRadius: theme.geometry.radius.interactive,
        marginBottom: 24,
        fontFamily: 'IBMPlexMono-Regular',
        fontSize: 14,
        minHeight: 120,
        textAlignVertical: 'top',
        color: theme.colors.input.text,
    },
}));

function authQRStartErrorMessage(failure?: AuthQRStartFailure): string {
    switch (failure) {
        case 'network':
            return t('errors.networkError');
        case 'unauthorized':
            return t('errors.authenticationFailed');
        case 'server':
            return t('errors.serverError');
        default:
            return t('errors.unknownError');
    }
}

export default function Restore() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const auth = useAuth();
    const router = useRouter();
    const [restoreKey, setRestoreKey] = useState('');
    const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
    const [authReady, setAuthReady] = useState(false);
    const [waitingDots, setWaitingDots] = useState(0);
    const isCancelledRef = useRef(false);

    // Memoize keypair generation to prevent re-creating on re-renders
    const keypair = React.useMemo(() => generateAuthKeyPair(), []);

    // Start QR authentication when component mounts
    useEffect(() => {
        const startQRAuth = async () => {
            try {
                setIsWaitingForAuth(true);

                // Send authentication request
                const result = await authQRStart(keypair);
                if (!result.ok) {
                    Modal.alert(t('common.error'), authQRStartErrorMessage(result.failure));
                    setIsWaitingForAuth(false);
                    return;
                }

                setAuthReady(true);

                // Start waiting for authentication
                const credentials = await authQRWait(
                    keypair,
                    (dots) => setWaitingDots(dots),
                    () => isCancelledRef.current
                );

                if (credentials && !isCancelledRef.current) {
                    // Convert secret bytes to base64url string for login
                    const secretString = encodeBase64(credentials.secret, 'base64url');
                    await auth.login(credentials.token, secretString);
                    if (!isCancelledRef.current) {
                        router.back();
                    }
                } else if (!isCancelledRef.current) {
                    Modal.alert(t('common.error'), t('errors.authenticationFailed'));
                }

            } catch (error) {
                if (!isCancelledRef.current) {
                    console.error('QR Auth error:', error);
                    Modal.alert(t('common.error'), t('errors.authenticationFailed'));
                }
            } finally {
                if (!isCancelledRef.current) {
                    setIsWaitingForAuth(false);
                    setAuthReady(false);
                }
            }
        };

        startQRAuth();

        // Cleanup function
        return () => {
            isCancelledRef.current = true;
        };
    }, [keypair]);

    return (
        <ScrollView style={styles.scrollView} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={styles.container}>

                <View style={{justifyContent: 'flex-end' }}>
                    <Text style={styles.secondInstructionText}>
                        {localizedText(
                            '1. Open Happy on your mobile device\n2. Go to Settings → Account\n3. Tap "Link New Device"\n4. Scan this QR code',
                            '1. 在移动设备上打开 Happy\n2. 前往 设置 → 账户\n3. 点击“关联新设备”\n4. 扫描此二维码',
                            '1. 在行動裝置上開啟 Happy\n2. 前往 設定 → 帳戶\n3. 點選「連結新裝置」\n4. 掃描此 QR 碼',
                        )}
                    </Text>
                </View>
                {!authReady && (
                    <View style={{ width: 200, height: 200, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.text} />
                    </View>
                )}
                {authReady && (
                    <QRCode
                        data={'happy:///account?' + encodeBase64(keypair.publicKey, 'base64url')}
                        size={300}
                        foregroundColor={'black'}
                        backgroundColor={'white'}
                    />
                )}
                {authReady && (
                    <View style={styles.waitingRow}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        <Text style={styles.waitingText}>
                            {localizedText('Waiting for approval on your other device', '等待另一台设备确认', '等待另一台裝置確認') + '.'.repeat((waitingDots % 3) + 1)}
                        </Text>
                    </View>
                )}
                <View style={{ flexGrow: 4, paddingTop: 30 }}>
                    <RoundButton title={localizedText('Restore with Secret Key Instead', '改用密钥恢复', '改用密鑰復原')} display='inverted' onPress={() => {
                        router.push('/restore/manual');
                    }} />
                </View>
            </View>
        </ScrollView>
    );
}
