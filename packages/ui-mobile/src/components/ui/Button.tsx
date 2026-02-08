/**
 * Button component matching web UI CVA-style variants.
 * Variants: default, destructive, outline, secondary, ghost
 * Sizes: sm, default, lg
 */
import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type TouchableOpacityProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { colors, borderRadius, fontSize, spacing } from '../../lib/theme';

type Variant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
type Size = 'sm' | 'default' | 'lg' | 'icon';

interface ButtonProps extends TouchableOpacityProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<Variant, ViewStyle> = {
  default: {
    backgroundColor: colors.primary,
  },
  destructive: {
    backgroundColor: colors.destructive,
  },
  outline: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondary: {
    backgroundColor: colors.secondary,
  },
  ghost: {
    backgroundColor: colors.transparent,
  },
};

const variantTextStyles: Record<Variant, TextStyle> = {
  default: { color: colors.primaryForeground },
  destructive: { color: colors.destructiveForeground },
  outline: { color: colors.foreground },
  secondary: { color: colors.secondaryForeground },
  ghost: { color: colors.foreground },
};

const sizeStyles: Record<Size, ViewStyle> = {
  sm: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 32 },
  default: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 40 },
  lg: { paddingHorizontal: spacing['2xl'], paddingVertical: spacing.md, minHeight: 48 },
  icon: { width: 40, height: 40, padding: 0 },
};

const sizeTextStyles: Record<Size, TextStyle> = {
  sm: { fontSize: fontSize.xs },
  default: { fontSize: fontSize.sm },
  lg: { fontSize: fontSize.base },
  icon: { fontSize: fontSize.sm },
};

export function Button({
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  children,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={isDisabled}
      style={[
        styles.base,
        variantStyles[variant],
        sizeStyles[size],
        isDisabled && styles.disabled,
        style as ViewStyle,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variantTextStyles[variant].color}
        />
      ) : typeof children === 'string' ? (
        <Text
          style={[
            styles.text,
            variantTextStyles[variant],
            sizeTextStyles[size],
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  text: {
    fontWeight: '500',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
