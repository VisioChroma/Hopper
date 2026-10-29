/**
 * Hopper
 * Spatial File Transfer
 *
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { SiriProvider } from './src/components/apple-intelligence';
import GlowBridge from './src/components/apple-intelligence/GlowBridge';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      {/* Apple Intelligence glow (reacticx). `live` = drawn over the running screen. The screens only
          call GlowState.set(); GlowBridge turns that into show()/hide(). */}
      <SiriProvider live introDuration={1100} outroDuration={520}>
        <GlowBridge />
        <AppNavigator />
      </SiriProvider>
    </SafeAreaProvider>
  );
}

export default App;