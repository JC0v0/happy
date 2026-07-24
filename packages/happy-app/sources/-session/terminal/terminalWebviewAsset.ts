import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

import xtermModule from '../../../assets/terminal/xterm.txt';
import fitModule from '../../../assets/terminal/xterm-fit.txt';
import cssModule from '../../../assets/terminal/xterm-css.txt';

export interface TerminalWebviewAssets {
    /** @xterm/xterm UMD build - defines `Terminal` on the window. */
    xtermJs: string;
    /** @xterm/addon-fit UMD build - defines `FitAddon` on the window. */
    fitJs: string;
    /** xterm.css stylesheet text. */
    css: string;
}

// Loaded once and cached for the app lifetime - the xterm bundle is ~500KB and
// should only be read off disk a single time.
let cache: TerminalWebviewAssets | null = null;

async function readAsset(moduleId: number): Promise<string> {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    if (!asset.localUri) {
        throw new Error('Terminal webview asset has no localUri');
    }
    return FileSystem.readAsStringAsync(asset.localUri);
}

/**
 * Load the vendored xterm.js / fit addon / CSS text for the native terminal
 * WebView. Native-only: this module is imported solely by the native
 * SessionTerminalView, so the asset requires never enter the web bundle.
 */
export async function loadTerminalWebviewAssets(): Promise<TerminalWebviewAssets> {
    if (cache) {
        return cache;
    }
    const [xtermJs, fitJs, css] = await Promise.all([
        readAsset(xtermModule),
        readAsset(fitModule),
        readAsset(cssModule),
    ]);
    cache = { xtermJs, fitJs, css };
    return cache;
}
