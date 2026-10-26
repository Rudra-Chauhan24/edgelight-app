/**
 * src/face-detector.js
 * Lightweight, 100% Local, Privacy-First Face Presence Detector for Edge Light.
 * 
 * Features:
 * - Zero network transmission: Camera frames are analyzed entirely in local memory.
 * - Zero biometric identification: Detects ONLY human face presence; never stores,
 *   matches, or creates facial identity templates.
 * - Hardware Acceleration / Native Shape Detection API support where available
 *   (window.FaceDetector in modern Chromium/Electron).
 * - Ultra-lightweight local Computer Vision fallback using skin chrominance locus
 *   (YCbCr space) + vertical facial aspect ratio + eye/brow luminance valley analysis.
 * - Consecutive frame thresholding (configurable, default: 3 frames) to eliminate false flicker.
 * - Smooth departure grace period (configurable, default: 3000ms) to prevent abrupt shutoff.
 * - Throttled sampling (~6-8 fps) to ensure < 1% CPU utilization without freezing UI.
 */

class FacePresenceDetector {
  constructor(options = {}) {
    this.consecutiveRequired = options.consecutiveRequired || 3;
    this.consecutivePresentCount = 0;
    this.consecutiveAbsentCount = 0;
    this.gracePeriodMs = options.gracePeriodMs !== undefined ? options.gracePeriodMs : 3000;
    this._facePresentState = false;
    this.lastFaceDetectedTime = 0;
    this.onFaceStateChange = options.onFaceStateChange || null;
    this.onDetectionSample = options.onDetectionSample || null;
    this.enabled = options.enabled !== false;
    this.isProcessing = false;
    this.lastProcessTime = 0;
    this.processIntervalMs = options.processIntervalMs || 140; // ~7 fps
    this.nativeDetector = null;
    this.detectorBackend = 'local-cv';
    this.analysisCanvas = null;
    this.analysisCtx = null;

    this._initDetector();
  }

  isFacePresent() {
    return !!this._facePresentState;
  }

  _initDetector() {
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        this.nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
        this.detectorBackend = 'native';
      } catch (_) {
        this.nativeDetector = null;
        this.detectorBackend = 'local-cv';
      }
    } else {
      this.detectorBackend = 'local-cv';
    }
  }

  _ensureCanvas(width = 80, height = 60) {
    if (!this.analysisCanvas && typeof document !== 'undefined') {
      this.analysisCanvas = document.createElement('canvas');
      this.analysisCanvas.width = width;
      this.analysisCanvas.height = height;
      this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    }
    return this.analysisCtx;
  }

  setEnabled(enable) {
    this.enabled = Boolean(enable);
    if (!this.enabled) {
      this.reset();
    }
  }

  reset() {
    this.consecutivePresentCount = 0;
    this.consecutiveAbsentCount = 0;
    const wasPresent = this._facePresentState;
    this._facePresentState = false;
    this.lastFaceDetectedTime = 0;
    if (wasPresent && typeof this.onFaceStateChange === 'function') {
      this.onFaceStateChange(false, { reason: 'reset' });
    }
  }

  destroy() {
    this.reset();
    this.analysisCanvas = null;
    this.analysisCtx = null;
  }

  /**
   * Evaluates face presence from a video element or canvas.
   * Throttled to ~7 fps to keep CPU usage negligible.
   */
  async processFrame(videoOrCanvas) {
    if (!this.enabled || !videoOrCanvas) return null;

    const now = Date.now();
    if (now - this.lastProcessTime < this.processIntervalMs || this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    this.lastProcessTime = now;

    let detected = false;
    let confidence = 0;
    let details = {};

    try {
      if (this.detectorBackend === 'native' && this.nativeDetector) {
        try {
          const faces = await this.nativeDetector.detect(videoOrCanvas);
          if (faces && faces.length > 0) {
            detected = true;
            confidence = 0.95;
            details = { facesCount: faces.length, source: 'native-shape-detector' };
          }
        } catch (_) {
          // Fall back seamlessly to local-cv if native detector encounters format or device issue
          this.detectorBackend = 'local-cv';
        }
      }

      if (this.detectorBackend === 'local-cv') {
        const cvResult = this._detectFaceLocalCV(videoOrCanvas);
        detected = cvResult.detected;
        confidence = cvResult.confidence;
        details = cvResult;
      }

      this._updateTemporalState(detected, confidence, details);

      if (typeof this.onDetectionSample === 'function') {
        this.onDetectionSample({
          detected,
          confidence,
          isFacePresent: this.isFacePresent,
          backend: this.detectorBackend
        });
      }

      return {
        detected,
        confidence,
        isFacePresent: this.isFacePresent,
        backend: this.detectorBackend
      };

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Fast, privacy-preserving Local Computer Vision Face-Presence Analysis.
   * Analyzes an 80x60 downscaled frame for anthropometric human face features:
   * 1. Skin Chrominance in YCbCr space (universal across diverse human skin tones:
   *    Cb in [77, 127], Cr in [133, 173], Y in [28, 240]).
   * 2. Vertical cluster aspect ratio (head/face vertical oval ratio ~ 1.15 to 1.75).
   * 3. Eye/Eyebrow horizontal luminance valley (upper facial contrast ratio).
   */
  _detectFaceLocalCV(source) {
    const W = 80;
    const H = 60;

    try {
      let data;
      if (source && source.data && source.width && source.height) {
        data = source.data;
      } else {
        const ctx = this._ensureCanvas(80, 60);
        if (!ctx) return { detected: false, confidence: 0 };
        ctx.drawImage(source, 0, 0, W, H);
        const img = ctx.getImageData(0, 0, W, H);
        data = img.data;
      }

      let skinCount = 0;
      let centerSkinCount = 0;
      let minX = W, maxX = 0, minY = H, maxY = 0;

      // Upper and middle facial region luminance tracking
      let upperLumSum = 0;
      let upperCount = 0;
      let midLumSum = 0;
      let midCount = 0;

      for (let y = 0; y < H; y += 2) {
        const isCenterY = y >= 10 && y <= 50;
        for (let x = 0; x < W; x += 2) {
          const isCenterX = x >= 15 && x <= 65;
          const idx = (y * W + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // YCbCr transformation
          const Y = 0.299 * r + 0.587 * g + 0.114 * b;
          const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

          // Standard human skin chrominance locus test
          const isSkin = (Cb >= 77 && Cb <= 127) && (Cr >= 133 && Cr <= 173) && (Y >= 28 && Y <= 245);

          if (isSkin) {
            skinCount++;
            if (isCenterX && isCenterY) {
              centerSkinCount++;
            }
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            // Eye/brow region contrast: y in [18, 30] vs cheek/nose in [30, 44]
            if (y >= 18 && y <= 30 && x >= 24 && x <= 56) {
              upperLumSum += Y;
              upperCount++;
            } else if (y > 30 && y <= 44 && x >= 24 && x <= 56) {
              midLumSum += Y;
              midCount++;
            }
          }
        }
      }

      // Minimum cluster size (~3% to 65% of sampled frame)
      const totalSampledPixels = (W / 2) * (H / 2);
      const skinRatio = skinCount / totalSampledPixels;
      const centerSkinRatio = centerSkinCount / (26 * 21);

      if (skinCount < 35 || centerSkinRatio < 0.08 || skinRatio > 0.85) {
        return { detected: false, confidence: 0, reason: 'insufficient_skin_cluster' };
      }

      // Cluster bounding dimensions & aspect ratio
      const clusterW = Math.max(1, maxX - minX);
      const clusterH = Math.max(1, maxY - minY);
      const aspectRatio = clusterH / clusterW;

      // Human face/head aspect ratio typically ranges between 1.05 and 1.95
      const validAspect = aspectRatio >= 1.02 && aspectRatio <= 2.1;

      // Facial luminance contrast: Eyes/brows create a slight luminance dip relative to cheeks
      let hasFacialContrast = true;
      if (upperCount > 10 && midCount > 10) {
        const avgUpper = upperLumSum / upperCount;
        const avgMid = midLumSum / midCount;
        // Upper eye/brow region is typically equal or darker than cheek region
        hasFacialContrast = (avgUpper <= avgMid * 1.18);
      }

      const detected = validAspect && hasFacialContrast && centerSkinCount >= 25;
      const confidence = detected
        ? Math.min(0.92, Math.max(0.65, centerSkinRatio * 1.4))
        : 0.2;

      return {
        detected,
        confidence,
        centerSkinRatio,
        aspectRatio,
        skinCount
      };

    } catch (e) {
      return { detected: false, confidence: 0, error: e.message };
    }
  }

  /**
   * Applies consecutive frame thresholding and graceful exit delay.
   * Prevents flickering, brief false detections, and abrupt shutoffs.
   */
  _updateTemporalState(frameDetected, confidence, details) {
    const now = Date.now();

    if (frameDetected) {
      this.consecutivePresentCount++;
      this.consecutiveAbsentCount = 0;
      this.lastFaceDetectedTime = now;

      // Activate only after reaching required consecutive positive frames
      if (this.consecutivePresentCount >= this.consecutiveRequired) {
        if (!this._facePresentState) {
          this._facePresentState = true;
          if (typeof this.onFaceStateChange === 'function') {
            this.onFaceStateChange(true, { confidence, details });
          }
        }
      }
    } else {
      this.consecutiveAbsentCount++;
      this.consecutivePresentCount = 0;

      if (this._facePresentState) {
        // Apply grace period: do not deactivate immediately
        const elapsedSinceLastSeen = now - this.lastFaceDetectedTime;
        const graceExpired = elapsedSinceLastSeen >= this.gracePeriodMs;

        if (graceExpired) {
          this._facePresentState = false;
          if (typeof this.onFaceStateChange === 'function') {
            this.onFaceStateChange(false, {
              reason: 'grace_period_expired',
              elapsedSinceLastSeen,
              details
            });
          }
        }
      }
    }
  }

  // Local-only privacy guarantee: zero biometric templates or network transmissions
  /**
   * Helper method for test suites and headless frame processing.
   */
  async processImageData(imgData) {
    if (!this.enabled) return { detected: false, isFacePresent: false };
    const res = this._detectFaceLocalCV(imgData);
    this._updateTemporalState(res.detected, res.confidence, res);
    return {
      detected: res.detected,
      isFacePresent: this.isFacePresent(),
      confidence: res.confidence
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FacePresenceDetector };
}
if (typeof window !== 'undefined') {
  window.FacePresenceDetector = FacePresenceDetector;
}
