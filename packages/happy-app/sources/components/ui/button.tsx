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
                    <Text style={[{ color: textColorFor(variant), fontSize: 14, fontWeight: '500' }, textStyle]}>
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

function textColorFor(variant: ButtonVariant): string | undefined {
    switch (variant) {
        case 'default':
        case 'destructive':
            return '#FFFFFF';
        default:
            return undefined;
    }
}

const styles = StyleSheet.create((theme) => ({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 8,
        // variant: default
        backgroundColor: theme.colors.text,
        // size: default
        height: 40,
        paddingHorizontal: 16,
        variants: {
            variant: {
                destructive: { backgroundColor: theme.colors.status.error },
                outline: {
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                },
                secondary: { backgroundColor: theme.colors.surfaceHigh },
                ghost: { backgroundColor: 'transparent' },
                link: { backgroundColor: 'transparent' },
            },
            size: {
                sm: { height: 36, paddingHorizontal: 12, borderRadius: 8 },
                lg: { height: 44, paddingHorizontal: 24 },
                icon: { height: 40, width: 40, paddingHorizontal: 0 },
            },
        },
    },
    pressed: {
        opacity: 0.8,
    },
    disabled: {
        opacity: 0.5,
    },
}));

export { Button };
export type { ButtonProps };
