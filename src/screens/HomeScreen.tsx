// src/screens/HomeScreen.tsx
// White background + animated bunny SVG (replaces the looping video, which used a
// SurfaceView and caused glitches during screen transitions).
import React, { useRef } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { BUNNY_SVG } from '../assets/svg/bunnySvg';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// The SVG animates itself (SMIL), the WebView only has to display it.
const BUNNY_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #FFFFFF; overflow: hidden; }
      svg { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>${BUNNY_SVG}</body>
</html>`;

export default function HomeScreen({ navigation }: Props) {
  const fade = useRef(new Animated.Value(0)).current;

  // fade the bunny in once the WebView has loaded (avoids a blank/white pop-in)
  const onLoaded = () => {
    Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HOPPER</Text>

      <Animated.View style={[styles.bunnyWrap, { opacity: fade }]} pointerEvents="none">
        <WebView
          source={{ html: BUNNY_HTML }}
          originWhitelist={['*']}
          style={styles.webview}
          containerStyle={styles.webview}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          javaScriptEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          onLoadEnd={onLoaded}
        />
      </Animated.View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('Share')}
          activeOpacity={0.8}
        >
          <Image
            source={require('../assets/images/sendd.png')}
            style={styles.icon}
            resizeMode="contain"
          />
          <Text style={styles.buttonText}>Send</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate('Receive')}
          activeOpacity={0.8}
        >
          <Image
            source={require('../assets/images/receive.png')}
            style={styles.icon}
            resizeMode="contain"
          />
          <Text style={styles.buttonText}>Receive</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    color: '#1A1A1A',
    fontFamily: 'LuckiestGuy-Regular',
  },
  bunnyWrap: {
    width: '100%',
    aspectRatio: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
  },
  icon: {
    width: 18,
    height: 18,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});