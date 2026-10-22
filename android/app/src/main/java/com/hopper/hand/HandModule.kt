package com.hopper.hand

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/**
 * Watches the FRONT camera (no preview) with MediaPipe Hand Landmarker and emits "HopperHand":
 *   present: Boolean            a hand is visible
 *   ratios:  [index, middle, ring, pinky]  = |fingertip - wrist| / |knuckle - wrist| (3D)
 *   fps, ms: detection speed (frames/second, milliseconds per frame) - for diagnostics
 *   lite:    true when the low-end profile (smaller camera image) is active
 *
 * Built to stay fast on weak phones:
 *  - the model loads on a background thread (the UI never freezes)
 *  - one reusable bitmap, rotation handled by MediaPipe (no per-frame allocations)
 *  - frames are DROPPED while the model is busy, so there is never a backlog (= low latency)
 *  - phones with <= 4.5 GB RAM use a smaller camera image
 *
 * Needs android/app/src/main/assets/hand_landmarker.task
 */
class HandModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private var provider: ProcessCameraProvider? = null
  @Volatile private var landmarker: HandLandmarker? = null
  private var executor: ExecutorService? = null
  @Volatile private var running = false
  @Volatile private var starting = false
  @Volatile private var generation = 0

  private var frameBitmap: Bitmap? = null
  private val inFlight = AtomicBoolean(false)
  @Volatile private var inFlightSince = 0L

  private var lite = false
  private var statFrames = 0
  private var statLatencySum = 0L
  private var statWindowStart = 0L
  private var statFps = 0.0
  private var statMs = 0.0

  override fun getName() = "HopperHand"

  @ReactMethod
  fun start(promise: Promise) {
    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA) !=
        PackageManager.PERMISSION_GRANTED) {
      promise.reject("NO_PERMISSION", "Camera permission not granted")
      return
    }
    val owner = reactContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      promise.reject("NO_ACTIVITY", "No active screen")
      return
    }
    if (running || starting) {
      promise.resolve(true)
      return
    }

    starting = true
    val gen = ++generation
    lite = isLowEnd()
    val exec = Executors.newSingleThreadExecutor()
    executor = exec

    // Load the model off the UI thread (slow on weak phones).
    exec.execute {
      try {
        val options =
            HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumHands(1)
                .setMinHandDetectionConfidence(0.5f)
                .setMinHandPresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .setResultListener { result, _ -> onResult(result) }
                .setErrorListener { e ->
                  Log.w(TAG, "HandLandmarker error: ${e.message}")
                  inFlight.set(false)
                }
                .build()
        val lm = HandLandmarker.createFromOptions(reactContext, options)
        if (gen != generation) { // stop() was called while loading
          lm.close()
          starting = false
          promise.resolve(false)
          return@execute
        }
        landmarker = lm
        UiThreadUtil.runOnUiThread { bindCamera(owner, gen, promise) }
      } catch (e: Exception) {
        // Most common cause: hand_landmarker.task missing from android/app/src/main/assets
        UiThreadUtil.runOnUiThread { cleanup() }
        promise.reject("MODEL_ERROR", e.message, e)
      }
    }
  }

  private fun bindCamera(owner: LifecycleOwner, gen: Int, promise: Promise) {
    if (gen != generation) {
      starting = false
      promise.resolve(false)
      return
    }
    val future = ProcessCameraProvider.getInstance(reactContext)
    future.addListener(
        {
          try {
            if (gen != generation) {
              starting = false
              promise.resolve(false)
              return@addListener
            }
            val cameraProvider = future.get()
            provider = cameraProvider

            val size = if (lite) Size(320, 240) else Size(480, 360)
            val resolution =
                ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(size, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build()

            val analysis =
                ImageAnalysis.Builder()
                    .setResolutionSelector(resolution)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
            analysis.setAnalyzer(executor!!) { proxy -> analyze(proxy) }

            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            running = true
            starting = false
            promise.resolve(true)
          } catch (e: Exception) {
            cleanup()
            promise.reject("CAMERA_ERROR", e.message, e)
          }
        },
        ContextCompat.getMainExecutor(reactContext))
  }

  @ReactMethod
  fun stop() {
    UiThreadUtil.runOnUiThread { cleanup() }
  }

  private fun cleanup() {
    generation++
    running = false
    starting = false
    try {
      provider?.unbindAll()
    } catch (e: Exception) {}
    provider = null
    try {
      landmarker?.close()
    } catch (e: Exception) {}
    landmarker = null
    executor?.shutdown()
    executor = null
    frameBitmap = null
    inFlight.set(false)
    statFrames = 0
    statLatencySum = 0
    statWindowStart = 0
    statFps = 0.0
    statMs = 0.0
  }

  private fun isLowEnd(): Boolean {
    val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    return am.isLowRamDevice || info.totalMem <= 4_500_000_000L
  }

  private fun analyze(proxy: ImageProxy) {
    val lm = landmarker
    if (lm == null || !running) {
      proxy.close()
      return
    }
    val now = SystemClock.uptimeMillis()
    // Model still busy with the previous frame -> drop this one (no backlog, lowest latency).
    // The 700 ms escape hatch prevents a permanent stall if a result is ever lost.
    if (inFlight.get() && now - inFlightSince < 700) {
      proxy.close()
      return
    }
    try {
      val rotation = proxy.imageInfo.rotationDegrees
      var bmp = frameBitmap
      if (bmp == null || bmp.width != proxy.width || bmp.height != proxy.height) {
        bmp = Bitmap.createBitmap(proxy.width, proxy.height, Bitmap.Config.ARGB_8888)
        frameBitmap = bmp
      }
      proxy.use { bmp.copyPixelsFromBuffer(it.planes[0].buffer) }

      inFlightSince = now
      inFlight.set(true)
      val opts = ImageProcessingOptions.builder().setRotationDegrees(rotation).build()
      lm.detectAsync(BitmapImageBuilder(bmp).build(), opts, now)
    } catch (e: Exception) {
      inFlight.set(false)
      Log.w(TAG, "analyze failed: ${e.message}")
    }
  }

  private fun onResult(result: HandLandmarkerResult) {
    val now = SystemClock.uptimeMillis()
    val latency = now - inFlightSince
    inFlight.set(false) // the bitmap may be reused from here on

    statFrames++
    statLatencySum += latency
    if (statWindowStart == 0L) statWindowStart = now
    val span = now - statWindowStart
    if (span >= 1000) {
      statFps = statFrames * 1000.0 / span
      statMs = statLatencySum.toDouble() / statFrames
      statFrames = 0
      statLatencySum = 0
      statWindowStart = now
    }

    if (!reactContext.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    val hands = result.worldLandmarks()
    if (hands.isEmpty() || hands[0].size < 21) {
      map.putBoolean("present", false)
      map.putArray("ratios", Arguments.createArray())
    } else {
      val p = hands[0]
      fun dist(a: Int, b: Int): Double {
        val dx = (p[a].x() - p[b].x()).toDouble()
        val dy = (p[a].y() - p[b].y()).toDouble()
        val dz = (p[a].z() - p[b].z()).toDouble()
        return sqrt(dx * dx + dy * dy + dz * dz)
      }
      val tips = intArrayOf(8, 12, 16, 20) // index, middle, ring, pinky fingertips
      val bases = intArrayOf(5, 9, 13, 17) // their knuckles (MCP)
      val ratios = Arguments.createArray()
      for (i in tips.indices) {
        val base = dist(bases[i], 0)
        ratios.pushDouble(if (base > 1e-6) dist(tips[i], 0) / base else 0.0)
      }
      map.putBoolean("present", true)
      map.putArray("ratios", ratios)
    }
    map.putDouble("t", now.toDouble())
    map.putDouble("fps", statFps)
    map.putDouble("ms", statMs)
    map.putBoolean("lite", lite)
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("HopperHand", map)
  }

  // Required by NativeEventEmitter
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  companion object {
    private const val TAG = "HopperHand"
  }
}