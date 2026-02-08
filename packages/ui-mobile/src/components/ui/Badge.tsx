/**
 * Badge component for status indicators and counts.
 */
import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { colors, borderRadius, fontSize, spacing } from '../../lib/theme';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  style?: ViewStyle;
}

const variantStyles: Record<BadgeVariant, ViewStyle> = {
  default: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.secondary },
  destructive: { backgroundColor: colors.destructive },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  success: { backgroundColor: colors.statusActive },
  warning: { backgroundColor: colors.statusWaiting },
};

const textColors: Record<BadgeVariant, string> = {
  default: colors.primaryForeground,
  secondary: colors.secondaryForeground,
  destructive: colors.destructiveForeground,
  outline: colors.foreground,
  success: colors.primaryForeground,
  warning: '#000000',
};

export function Badge({ variant = 'default', children, style }: BadgeProps) {
  return (
    <View style={[styles.badge, variantStyles[variant], style]}>
      {typeof children === 'string' ? (
        <Text style={[styles.text, { color: textColors[variant] }]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
});
