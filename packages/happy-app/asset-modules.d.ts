// Vendored text assets (xterm.js UMD build + CSS for the native terminal
// WebView). Required as raw asset module ids; their content is read at runtime
// via expo-asset + expo-file-system so the WebView renders fully offline.
declare module '*.txt' {
    const value: number;
    export default value;
}
