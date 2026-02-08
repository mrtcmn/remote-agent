/**
 * Text input matching web UI styling.
 */
import React, { forwardRef } from 'react';
import {
  TextInput,
  StyleSheet,
  View,
  Text,
  type TextInputProps,
} from 'react-native';
import { colors, borderRadius, fontSize, spacing } from '../../lib/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ label, error, style, ...props }, ref) => {
    return (
      <View style={styles.wrapper}>
        {label && <Text style={styles.label}>{label}</Text>}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            error && styles.inputError,
            style,
          ]}
          {...props}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: 2,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.foreground,
    minHeight: 40,
  },
  inputError: {
    borderColor: colors.destructive,
  },
  error: {
    color: colors.destructive,
    fontSize: fontSize.xs,
  },
});
