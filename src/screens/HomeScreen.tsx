// src/screens/HomeScreen.tsx
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import Video from 'react-native-video';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <View style={styles.container}>
      {!videoFailed && (
        <Video
          source={require('../assets/videos/bg.mp4')}
          style={styles.video}
          resizeMode="cover"
          repeat
          muted
          paused={false}
          playInBackground={false}
          playWhenInactive={false}
          onError={(e) => {
            console.log('VIDEO ERROR:', JSON.stringify(e));
            setVideoFailed(true);
          }}
        />
      )}

      <View style={styles.overlay}>
        <Text style={styles.title}>HOPPER</Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FB573F',
  },
  video: {
    position: 'absolute',
    top: 40,
    left: 5,
    width: '100%',
    height: '80%',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    color: '#1A1A1A',
    fontFamily: 'LuckiestGuy-Regular',
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