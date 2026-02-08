/**
 * Avatar component with image + fallback, matching web Radix Avatar.
 */
import React, { useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { colors, borderRadius } from '../../lib/theme';

interface AvatarProps {
  src?: string | null;
  fallback: string;
  size?: number;
}

export function Avatar({ src, fallback, size = 32 }: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (src && !hasError) {
    return (
      <View style={[styles.container, containerStyle]}>
        <Image
          source={{ uri: src }}
          style={[styles.image, containerStyle]}
          onError={() => setHasError(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.fallback, containerStyle]}>
      <Text style={[styles.fallbackText, { fontSize: size * 0.4 }]}>
        {fallback.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    resizeMode: 'cover',
  },
  fallback: {
    backgroundColor: colors.muted,
  },
  fallbackText: {
    color: colors.foreground,
    fontWeight: '600',
  },
});
