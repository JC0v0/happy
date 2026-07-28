import * as React from 'react';
import {
    applyTerminalModifiers,
    EMPTY_TERMINAL_MODIFIERS,
    toggleTerminalCtrl,
    type TerminalModifierState,
} from './terminal-modifiers';

export function useTerminalModifierInput(sendRawTerminalInput: (data: string) => void) {
    const modifiersRef = React.useRef<TerminalModifierState>(EMPTY_TERMINAL_MODIFIERS);
    const [modifiers, setModifiers] = React.useState<TerminalModifierState>(EMPTY_TERMINAL_MODIFIERS);

    const commitModifiers = React.useCallback((next: TerminalModifierState) => {
        modifiersRef.current = next;
        setModifiers(next);
    }, []);

    const toggleCtrl = React.useCallback(() => {
        commitModifiers(toggleTerminalCtrl(modifiersRef.current));
    }, [commitModifiers]);

    const clearModifiers = React.useCallback(() => {
        if (modifiersRef.current.ctrl) {
            commitModifiers(EMPTY_TERMINAL_MODIFIERS);
        }
    }, [commitModifiers]);

    const sendTerminalInput = React.useCallback((data: string) => {
        if (data.length === 0) {
            return;
        }
        const result = applyTerminalModifiers(data, modifiersRef.current);
        if (result.modifiers.ctrl !== modifiersRef.current.ctrl) {
            commitModifiers(result.modifiers);
        }
        sendRawTerminalInput(result.data);
    }, [commitModifiers, sendRawTerminalInput]);

    return {
        ctrlActive: modifiers.ctrl,
        sendTerminalInput,
        toggleCtrl,
        clearModifiers,
    };
}
