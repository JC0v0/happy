import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLanguage = vi.hoisted(() => ({
    preferredLanguage: 'en' as string | null,
}));

vi.mock('@/sync/persistence', () => ({
    loadSettings: () => ({
        settings: {
            preferredLanguage: mockLanguage.preferredLanguage,
        },
    }),
}));

vi.mock('expo-localization', () => ({
    getLocales: () => [],
}));

async function localizeFor(language: string | null) {
    mockLanguage.preferredLanguage = language;
    vi.resetModules();

    const { localizedText } = await import('./index');
    return localizedText('English', '简体中文', '繁體中文');
}

describe('localizedText', () => {
    beforeEach(() => {
        mockLanguage.preferredLanguage = 'en';
    });

    it('returns simplified Chinese for zh-Hans', async () => {
        await expect(localizeFor('zh-Hans')).resolves.toBe('简体中文');
    });

    it('returns traditional Chinese for zh-Hant', async () => {
        await expect(localizeFor('zh-Hant')).resolves.toBe('繁體中文');
    });

    it('falls back to English for other supported languages', async () => {
        await expect(localizeFor('ja')).resolves.toBe('English');
    });
});
