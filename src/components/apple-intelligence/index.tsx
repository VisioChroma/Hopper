// Apple Intelligence glow - from reacticx (rit3zh/reacticx, src/components/organisms/apple-intelligence).
// The shader, uniforms, config and timings are the original. Changes for Hopper are marked "HOPPER":
//   1. `live` mode + show()/hide(): the glow is drawn over the running screen, not a frozen snapshot.
//   2. the overlay is positioned with explicit style (StyleSheet.absoluteFillObject is not available
//      on this React Native version, which made the overlay collapse into a thin strip).
import React, { memo, useCallback, useRef, useState } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import {
  Canvas,
  Fill,
  Shader,
  ImageShader,
  makeImageFromView,
  type SkImage,
} from "@shopify/react-native-skia";
import {
  useSharedValue,
  withTiming,
  Easing,
  useAnimatedStyle,
} from "react-native-reanimated";
import Animated from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { SiriContext } from "./context";
import { SHADER_SOURCE, EMPTY_CONTENTS } from "./conf";
import { useSiriUniforms } from "./use-siri-uniforms";
import type { IAppleIntelligenceProvider, ISiriToggleOptions } from "./types";

export const SiriProvider: React.FC<IAppleIntelligenceProvider> = memo<IAppleIntelligenceProvider>(
  ({
    children,
    introDuration = 1200,
    outroDuration = 600,
    wave: defaultWave,
    noise: defaultNoise,
    glow: defaultGlow,
    shimmer: defaultShimmer,
    border: defaultBorder,
    live = false,
  }: IAppleIntelligenceProvider) => {
    const viewRef = useRef<View>(null);
    const [snapshot, setSnapshot] = useState<SkImage | null>(null);
    const [active, setActive] = useState<boolean>(false);
    const activeRef = useRef<boolean>(false); // HOPPER: always-current copy of `active`
    const [layout, setLayout] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });
    const busyRef = useRef<boolean>(false);

    const [overlayContent, setOverlayContent] = useState<React.ReactNode>(null);

    const overlayOpacity = useSharedValue<number>(0);

    const { iTime, intensity, uniforms, applyConfig, frameCallback } = useSiriUniforms({
      layout,
      defaultWave,
      defaultNoise,
      defaultGlow,
      defaultShimmer,
      defaultBorder,
    });

    const overlayStyle = useAnimatedStyle<
      Required<Partial<Pick<ViewStyle, "opacity">>>
    >(() => ({
      opacity: overlayOpacity.value,
    }));

    const dismiss = useCallback(() => {
      frameCallback.setActive(false);
      busyRef.current = false;
      activeRef.current = false;
      setActive(false);
      setSnapshot(null);
      setOverlayContent(null);
    }, [frameCallback]);

    // Fade-out, then remove the overlay (original outro).
    const hide = useCallback(() => {
      if (!activeRef.current) return;
      busyRef.current = true;
      intensity.value = withTiming<number>(
        0,
        { duration: outroDuration, easing: Easing.out(Easing.quad) },
        (finished) => {
          if (finished) {
            overlayOpacity.value = withTiming(0, { duration: 200 }, (done) => {
              if (done) scheduleOnRN(dismiss);
            });
          }
        },
      );
    }, [outroDuration, intensity, overlayOpacity, dismiss]);

    // HOPPER: start the glow over the live screen. Safe to call again while it is already on or
    // while it is fading out (it then resumes from where it is instead of restarting).
    const show = useCallback(
      (options?: ISiriToggleOptions) => {
        if (layout.width === 0 || layout.height === 0) return;
        applyConfig(options);
        overlayOpacity.value = 1;
        frameCallback.setActive(true);
        if (!activeRef.current) {
          intensity.value = 0;
          iTime.value = 0;
          activeRef.current = true;
          setActive(true);
        }
        busyRef.current = false;
        intensity.value = withTiming(1, {
          duration: introDuration,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
      },
      [layout, applyConfig, frameCallback, introDuration, intensity, overlayOpacity, iTime],
    );

    // Original behaviour: snapshot of the screen, shader warps + glows it.
    const toggle = useCallback(
      async (options?: ISiriToggleOptions) => {
        if (activeRef.current) {
          hide();
          return;
        }
        if (live) {
          show(options);
          return;
        }

        if (
          busyRef.current ||
          !viewRef.current ||
          layout.width === 0 ||
          layout.height === 0
        )
          return;
        busyRef.current = true;

        try {
          const image = await makeImageFromView(viewRef);
          if (!image) {
            busyRef.current = false;
            return;
          }

          applyConfig(options);
          intensity.value = 0;
          iTime.value = 0;
          overlayOpacity.value = 1;

          setSnapshot(image);
          activeRef.current = true;
          setActive(true);
          frameCallback.setActive(true);
          busyRef.current = false;

          intensity.value = withTiming(1, {
            duration: introDuration,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          });
        } catch (err) {
          busyRef.current = false;
          console.warn("[SiriProvider]", err);
        }
      },
      [
        live,
        layout,
        introDuration,
        applyConfig,
        frameCallback,
        hide,
        show,
        intensity,
        overlayOpacity,
        iTime,
      ],
    );

    const setOverlay = useCallback((content: React.ReactNode) => {
      setOverlayContent(content);
    }, []);

    return (
      <SiriContext.Provider value={{ toggle, show, hide, isActive: active, setOverlay }}>
        <View
          ref={viewRef}
          style={styles.container}
          collapsable={false}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setLayout({ width, height });
          }}
        >
          {children}
        </View>
        {active && (live || snapshot) && layout.width > 0 && (
          <Animated.View
            style={[styles.overlay, overlayStyle]}
            pointerEvents="none"
          >
            <Canvas style={{ width: layout.width, height: layout.height }}>
              <Fill>
                <Shader source={SHADER_SOURCE} uniforms={uniforms}>
                  {live ? (
                    <Shader source={EMPTY_CONTENTS} />
                  ) : (
                    <ImageShader
                      image={snapshot!}
                      fit="cover"
                      width={layout.width}
                      height={layout.height}
                    />
                  )}
                </Shader>
              </Fill>
            </Canvas>
          </Animated.View>
        )}
        {overlayContent}
      </SiriContext.Provider>
    );
  },
);

export default SiriProvider;

const styles = StyleSheet.create({
  container: { flex: 1 },
  // HOPPER: explicit full-screen positioning instead of StyleSheet.absoluteFillObject.
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
});