import * as React from 'react';
import { Pressable, type PressableProps, type TextStyle, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text';

export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps extends PressableProps {
    variant?: ButtonVariant;
    size?: ButtonSize;
    style?: ViewStyle | ViewStyle[];
    textStyle?: TextStyle;
    children: React.ReactNode;
}

/**
 * shadcn-style Button (react-native-unistyles implementation).
 */
const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
    ({ variant = 'default', size = 'default', style, textStyle, children, disabled, ...props }, ref) => {
        const { theme } = useUnistyles();
        styles.useVariants({
            variant: variant === 'default' ? undefined : variant,
            size: size === 'default' ? undefined : size,
        });
        return (
            <Pressable
                ref={ref}
                role="button"
                disabled={disabled}
                style={({ pressed }) => [
                    styles.base,
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                    style,
                ]}
                {...props}
            >
                {typeof children === 'string' ? (
                    <Text variant="label" style={[{ color: textColorFor(theme.semantic, variant) }, textStyle]}>
                        {children}
                    </Text>
                ) : (
                    children
                )}
            </Pressable>
        );
    },
);
Button.displayName = 'Button';

function textColorFor(
    semantic: { textPrimary: string; textInverse: string; focus: string },
    variant: ButtonVariant,
): string {
    switch (variant) {
        case 'default':
        case 'destructive':
            return semantic.textInverse;
        case 'link':
            return semantic.focus;
        default:
            return semantic.textPrimary;
    }
}

const styles = StyleSheet.create((theme) => ({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: theme.geometry.radius.interactive,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.semantic.control,
        // variant: default
        backgroundColor: theme.semantic.control,
        // size: default
        minHeight: 44,
        paddingHorizontal: 16,
        variants: {
            variant: {
                destructive: {
                    backgroundColor: theme.semantic.status.error,
                    borderColor: theme.semantic.status.error,
                },
                outline: {
                    backgroundColor: 'transparent',
                    borderColor: theme.semantic.borderStrong,
                },
                secondary: {
                    backgroundColor: theme.semantic.surfaceMuted,
                    borderColor: theme.semantic.border,
                },
                ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
                link: { backgroundColor: 'transparent', borderColor: 'transparent' },
            },
            size: {
                sm: { minHeight: 40, paddingHorizontal: 12 },
                lg: { minHeight: 48, paddingHorizontal: 24 },
                icon: { minHeight: 44, width: 44, paddingHorizontal: 0 },
            },
        },
    },
    pressed: {
        opacity: 0.88,
    },
    disabled: {
        opacity: 0.5,
    },
}));

export { Button };
export type { ButtonProps };
