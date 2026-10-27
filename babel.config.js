module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated 4 / Skia need the worklets plugin. It must be the LAST plugin.
  plugins: ['react-native-worklets/plugin'],
};