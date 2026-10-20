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

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

export default App;