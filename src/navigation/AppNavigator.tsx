// src/navigation/AppNavigator.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SplashScreen from '../screens/SplashScreen';
import HomeScreen from '../screens/HomeScreen';
import ShareScreen from '../screens/ShareScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import SenderWaitingScreen from '../screens/SenderWaitingScreen';
import ReceiverWaitingScreen from '../screens/ReceiverWaitingScreen';
import FilePickerScreen from '../screens/FilePickerScreen';

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