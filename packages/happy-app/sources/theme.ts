import { Platform } from 'react-native';
import {
    darkThemeSemantics,
    lightThemeSemantics,
    semanticGeometry,
    type ThemeSemantics,
} from './themeSemantics';

const lightSemantic: ThemeSemantics = lightThemeSemantics;
const darkSemantic: ThemeSemantics = darkThemeSemantics;

// Shared spacing, sizing constants (DRY - used by both themes)
const sharedSpacing = {
    // Spacing scale (based on actual usage patterns in codebase)
    margins: {
        xs: 4,   // Tight spacing, status indicators
        sm: 8,   // Small gaps, most common gap value
        md: 12,  // Button gaps, card margins
        lg: 16,  // Most common padding value
        xl: 20,  // Large padding
        xxl: 24, // Section spacing
    },

    // OpenCode-inspired geometry: structure is square, controls are compact.
    borderRadius: {
        sm: semanticGeometry.radius.compact,
        md: semanticGeometry.radius.interactive,
        lg: semanticGeometry.radius.interactive,
        xl: semanticGeometry.radius.structural,
        xxl: semanticGeometry.radius.structural,
    },

    // Icon sizes (based on actual usage patterns)
    iconSize: {
        small: 12,  // Inline icons (checkmark, lock, status indicators)
        medium: 16, // Section headers, add buttons
        large: 20,  // Action buttons (delete, duplicate, edit) - most common
        xlarge: 24, // Main section icons (desktop, folder)
    },
} as const;

export const lightTheme = {
    dark: false,
    semantic: lightSemantic,
    geometry: semanticGeometry,
    colors: {

        //
        // Main colors
        //

        text: lightSemantic.textPrimary,
        textDestructive: Platform.select({ ios: '#FF3B30', default: '#F44336' }),
        textSecondary: lightSemantic.textSecondary,
        textLink: lightSemantic.focus,
        deleteAction: '#FF6B6B', // Delete/remove button color
        warningCritical: '#FF3B30',
        warning: '#8E8E93',
        success: '#34C759',
        surface: lightSemantic.surface,
        surfaceRipple: 'rgba(0, 0, 0, 0.08)',
        surfacePressed: lightSemantic.surfaceSelected,
        surfaceSelected: lightSemantic.surfaceSelected,
        surfacePressedOverlay: lightSemantic.surfaceSelected,
        surfaceHigh: lightSemantic.surfaceMuted,
        surfaceHighest: lightSemantic.surfaceRaised,
        divider: lightSemantic.border,
        shadow: {
            color: 'transparent',
            opacity: 0,
        },

        //
        // System components
        //

        groupped: {
            background: lightSemantic.canvas,
            chevron: lightSemantic.textMuted,
            sectionTitle: lightSemantic.textSecondary,
        },
        header: {
            background: lightSemantic.canvas,
            tint: lightSemantic.textPrimary,
        },
        switch: {
            track: {
                active: Platform.select({ ios: '#34C759', default: '#1976D2' }),
                inactive: '#dddddd',
            },
            thumb: {
                active: '#FFFFFF',
                inactive: '#767577',
            },
        },
        radio: {
            active: '#007AFF',
            inactive: '#C0C0C0',
            dot: '#007AFF',
        },
        modal: {
            border: 'rgba(0, 0, 0, 0.1)'
        },
        button: {
            primary: {
                background: lightSemantic.control,
                tint: lightSemantic.textInverse,
                disabled: lightSemantic.controlDisabled,
            },
            secondary: {
                tint: '#666666',
            }
        },
        input: {
            background: lightSemantic.surfaceMuted,
            text: lightSemantic.textPrimary,
            placeholder: lightSemantic.textMuted,
        },
        box: {
            warning: {
                background: '#FFF8F0',
                border: '#FF9500',
                text: '#FF9500',
            },
            error: {
                background: '#FFF0F0',
                border: '#FF3B30',
                text: '#FF3B30',
            }
        },

        //
        // App components
        //

        status: {
            connected: lightSemantic.status.success,
            connecting: lightSemantic.status.info,
            disconnected: lightSemantic.status.offline,
            error: lightSemantic.status.error,
            default: lightSemantic.textMuted,
        },

        // Permission mode colors
        permission: {
            default: '#8E8E93',
            acceptEdits: '#007AFF',
            bypass: '#FF9500',
            plan: '#34C759',
            readOnly: '#8B8B8D',
            safeYolo: '#FF6B35',
            yolo: '#DC143C',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#34C759',
                text: '#FFFFFF',
            },
            deny: {
                background: '#FF3B30',
                text: '#FFFFFF',
            },
            allowAll: {
                background: '#007AFF',
                text: '#FFFFFF',
            },
            inactive: {
                background: '#E5E5EA',
                border: '#D1D1D6',
                text: '#8E8E93',
            },
            selected: {
                background: '#F2F2F7',
                border: '#D1D1D6',
                text: '#3C3C43',
            },
        },


        // Diff view
        diff: {
            outline: '#E0E0E0',
            success: '#28A745',
            error: '#DC3545',
            // Traditional diff colors
            addedBg: '#E6FFED',
            addedBorder: '#34D058',
            addedText: '#24292E',
            removedBg: '#FFEEF0',
            removedBorder: '#D73A49',
            removedText: '#24292E',
            contextBg: '#F6F8FA',
            contextText: '#586069',
            lineNumberBg: '#F6F8FA',
            lineNumberText: '#959DA5',
            hunkHeaderBg: '#F1F8FF',
            hunkHeaderText: '#005CC5',
            leadingSpaceDot: '#E8E8E8',
            inlineAddedBg: '#ACFFA6',
            inlineAddedText: '#0A3F0A',
            inlineRemovedBg: '#FFCECB',
            inlineRemovedText: '#5A0A05',
        },

        // Message View colors
        userMessageBackground: '#f0eee6',
        userMessageText: '#000000',
        agentMessageText: '#000000',
        agentEventText: '#666666',

        // Code/Syntax colors
        syntaxKeyword: '#1d4ed8',
        syntaxString: '#059669',
        syntaxComment: '#6b7280',
        syntaxNumber: '#0891b2',
        syntaxFunction: '#9333ea',
        syntaxBracket1: '#ff6b6b',
        syntaxBracket2: '#4ecdc4',
        syntaxBracket3: '#45b7d1',
        syntaxBracket4: '#f7b731',
        syntaxBracket5: '#5f27cd',
        syntaxDefault: '#374151',

        // Git status colors
        gitBranchText: '#6b7280',
        gitFileCountText: '#6b7280',
        gitAddedText: '#22c55e',
        gitRemovedText: '#ef4444',


    },

    ...sharedSpacing,
};

export const darkTheme = {
    dark: true,
    semantic: darkSemantic,
    geometry: semanticGeometry,
    colors: {

        //
        // Main colors
        //

        text: darkSemantic.textPrimary,
        textDestructive: Platform.select({ ios: '#FF453A', default: '#F48FB1' }),
        textSecondary: darkSemantic.textSecondary,
        textLink: darkSemantic.focus,
        deleteAction: '#FF6B6B', // Delete/remove button color (same in both themes)
        warningCritical: '#FF453A',
        warning: '#8E8E93',
        success: '#32D74B',
        surface: darkSemantic.surface,
        surfaceRipple: 'rgba(255, 255, 255, 0.08)',
        surfacePressed: darkSemantic.surfaceSelected,
        surfaceSelected: darkSemantic.surfaceSelected,
        surfacePressedOverlay: darkSemantic.surfaceSelected,
        surfaceHigh: darkSemantic.surfaceMuted,
        surfaceHighest: darkSemantic.surfaceRaised,
        divider: darkSemantic.border,
        shadow: {
            color: 'transparent',
            opacity: 0,
        },

        //
        // System components
        //

        header: {
            background: darkSemantic.canvas,
            tint: darkSemantic.textPrimary,
        },
        switch: {
            track: {
                active: Platform.select({ ios: '#34C759', default: '#1976D2' }),
                inactive: '#3a393f',
            },
            thumb: {
                active: '#FFFFFF',
                inactive: '#767577',
            },
        },
        groupped: {
            background: darkSemantic.canvas,
            chevron: darkSemantic.textMuted,
            sectionTitle: darkSemantic.textSecondary,
        },
        radio: {
            active: '#0A84FF',
            inactive: '#48484A',
            dot: '#0A84FF',
        },
        modal: {
            border: 'rgba(255, 255, 255, 0.1)'
        },
        button: {
            primary: {
                background: darkSemantic.control,
                tint: darkSemantic.textInverse,
                disabled: darkSemantic.controlDisabled,
            },
            secondary: {
                tint: '#8E8E93',
            }
        },
        input: {
            background: darkSemantic.surfaceMuted,
            text: darkSemantic.textPrimary,
            placeholder: darkSemantic.textMuted,
        },
        box: {
            warning: {
                background: 'rgba(255, 159, 10, 0.15)',
                border: '#FF9F0A',
                text: '#FFAB00',
            },
            error: {
                background: 'rgba(255, 69, 58, 0.15)',
                border: '#FF453A',
                text: '#FF6B6B',
            }
        },

        //
        // App components
        //

        status: { // App Connection Status
            connected: darkSemantic.status.success,
            connecting: darkSemantic.status.info,
            disconnected: darkSemantic.status.offline,
            error: darkSemantic.status.error,
            default: darkSemantic.textMuted,
        },

        // Permission mode colors
        permission: {
            default: '#8E8E93',
            acceptEdits: '#0A84FF',
            bypass: '#FF9F0A',
            plan: '#32D74B',
            readOnly: '#98989D',
            safeYolo: '#FF7A4C',
            yolo: '#FF453A',
        },

        // Permission button colors
        permissionButton: {
            allow: {
                background: '#32D74B',
                text: '#FFFFFF',
            },
            deny: {
                background: '#FF453A',
                text: '#FFFFFF',
            },
            allowAll: {
                background: '#0A84FF',
                text: '#FFFFFF',
            },
            inactive: {
                background: '#2C2C2E',
                border: '#38383A',
                text: '#8E8E93',
            },
            selected: {
                background: '#1C1C1E',
                border: '#38383A',
                text: '#FFFFFF',
            },
        },


        // Diff view
        diff: {
            outline: '#30363D',
            success: '#3FB950',
            error: '#F85149',
            // Traditional diff colors for dark mode
            addedBg: '#0D2E1F',
            addedBorder: '#3FB950',
            addedText: '#C9D1D9',
            removedBg: '#3F1B23',
            removedBorder: '#F85149',
            removedText: '#C9D1D9',
            contextBg: '#161B22',
            contextText: '#8B949E',
            lineNumberBg: '#161B22',
            lineNumberText: '#6E7681',
            hunkHeaderBg: '#161B22',
            hunkHeaderText: '#58A6FF',
            leadingSpaceDot: '#2A2A2A',
            inlineAddedBg: '#2A5A2A',
            inlineAddedText: '#7AFF7A',
            inlineRemovedBg: '#5A2A2A',
            inlineRemovedText: '#FF7A7A',
        },

        // Message View colors
        userMessageBackground: '#2C2C2E',
        userMessageText: '#FFFFFF',
        agentMessageText: '#FFFFFF',
        agentEventText: '#8E8E93',

        // Code/Syntax colors (brighter for dark mode)
        syntaxKeyword: '#569CD6',
        syntaxString: '#CE9178',
        syntaxComment: '#6A9955',
        syntaxNumber: '#B5CEA8',
        syntaxFunction: '#DCDCAA',
        syntaxBracket1: '#FFD700',
        syntaxBracket2: '#DA70D6',
        syntaxBracket3: '#179FFF',
        syntaxBracket4: '#FF8C00',
        syntaxBracket5: '#00FF00',
        syntaxDefault: '#D4D4D4',

        // Git status colors
        gitBranchText: '#8E8E93',
        gitFileCountText: '#8E8E93',
        gitAddedText: '#34C759',
        gitRemovedText: '#FF453A',


    },

    ...sharedSpacing,
} satisfies typeof lightTheme;

export type Theme = typeof lightTheme;
