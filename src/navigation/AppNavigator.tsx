// src/navigation/AppNavigator.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplashScreen from '../screens/SplashScreen';
import HomeScreen from '../screens/HomeScreen';
import ShareScreen from '../screens/ShareScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import SenderWaitingScreen from '../screens/SenderWaitingScreen';
import ReceiverWaitingScreen from '../screens/ReceiverWaitingScreen';

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  Share: undefined;
  SenderWaiting: { 
    hotspot: { ssid: string; password: string; ip: string }; 
    sessionId: string; 
  };
  FilePicker: undefined;
  Receive: undefined;
  ReceiverWaiting: { 
    sessionId: string; 
  };
};

// Temporary placeholder screen for FilePicker
function FilePickerScreen() {
  return (
    <View style={styles.placeholderContainer}>
      <Text style={styles.placeholderTitle}>File Picker</Text>
      <Text style={styles.placeholderSubtitle}>Coming Soon</Text>
    </View>
  );
}

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Share" component={ShareScreen} />
        <Stack.Screen name="SenderWaiting" component={SenderWaitingScreen} />
        <Stack.Screen name="FilePicker" component={FilePickerScreen} />
        <Stack.Screen name="Receive" component={ReceiveScreen} />
        <Stack.Screen name="ReceiverWaiting" component={ReceiverWaitingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  placeholderSubtitle: {
    fontSize: 14,
    color: '#888888',
  },
});