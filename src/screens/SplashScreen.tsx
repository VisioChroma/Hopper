// src/screens/SplashScreen.tsx
import React, { useEffect } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Home');
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/redd.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.text}>HOPPER</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 90,
    height: 90,
  },
  text: {
    marginTop: 12,
    fontSize: 22,
    color: '#8A5A2B',
    fontFamily: 'LuckiestGuy-Regular',
  },
});