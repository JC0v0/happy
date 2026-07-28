/**
 * Warp-inspired terminal chrome. Terminal sessions intentionally keep this
 * palette in both app themes so a remote shell remains visually stable.
 */
export const TERMINAL_VISUAL_THEME = {
    canvas: '#111318',
    chrome: '#15171C',
    chromeRaised: '#1C1F26',
    control: '#22252D',
    controlPressed: '#2C303A',
    border: '#30343E',
    text: '#F3F4F6',
    textMuted: '#959BA7',
    accent: '#B86BFF',
    accentStrong: '#9B4DFF',
    selection: 'rgba(184, 107, 255, 0.35)',
    success: '#6DD58C',
    warning: '#F5BE5B',
    danger: '#FF6B78',
} as const;
