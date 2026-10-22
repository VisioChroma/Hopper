// src/components/GrabSheet.tsx
// Bottom sheet that slides up from the bottom and plays the grab animation.
// The SVG animates itself (SMIL) inside a WebView; this component only handles
// the slide-in / slide-out and keeps the sheet mounted until the slide-out ends.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { GRAB_SVG } from '../assets/svg/grabSvg';

const SHEET_HEIGHT = 300;

const GRAB_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #FFFFFF; overflow: hidden; }
      svg { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>${GRAB_SVG}</body>
</html>`;

type Props = {
  visible: boolean;
  fileCount: number;
  onCancel: () => void;
};

export default function GrabSheet({ visible, fileCount, onCancel }: Props) {
  const slide = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fade, { toValue: 1, duration: 380, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slide, {
          toValue: SHEET_HEIGHT,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false); // unmount -> WebView (and the loop) is released
      });
    }
  }, [visible, slide, fade]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]} pointerEvents="auto" />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={styles.handle} />
        <View style={styles.animWrap} pointerEvents="none">
          <WebView
            source={{ html: GRAB_HTML }}
            originWhitelist={['*']}
            style={styles.webview}
            containerStyle={styles.webview}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            javaScriptEnabled={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          />
        </View>
        <Text style={styles.caption}>
          {fileCount} {fileCount === 1 ? 'file' : 'files'} ready — waiting for a receiver to catch
        </Text>
        <TouchableOpacity style={styles.cancel} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D0D0D0', marginBottom: 8 },
  animWrap: { width: '100%', aspectRatio: 512 / 210 },
  webview: { flex: 1, backgroundColor: '#FFFFFF' },
  caption: { color: '#555', fontSize: 13, marginTop: 8, textAlign: 'center' },
  cancel: {
    marginTop: 'auto',
    borderWidth: 2,
    borderColor: '#1A1A1A',
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 32,
  },
  cancelText: { color: '#1A1A1A', fontSize: 15, fontWeight: '600' },
});