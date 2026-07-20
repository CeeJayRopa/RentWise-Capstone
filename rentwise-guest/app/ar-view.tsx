import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
  Modal,
  Animated,
  Easing,
} from "react-native";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { getARObjects, getModelDownloadUrl, logArPlacement } from "../services/modelService";
import type { ARObject } from "../shared/types/arObject";
import { ARSessionScene, PlacedState, ScaleAxis, SurfaceType, SelectedMeasurement, SurfaceIssue } from "../features/ar/ARSessionScene";
import ModelViewer from "../features/ar/ModelViewer";

// ─── Theme (AR-specific blue/teal "tech" palette — intentionally distinct
// from the rest of the guest site's green branding, since this is the
// immersive camera-passthrough experience, not a marketing page) ─────────────
const PRIMARY = "#0891B2";
const PRIMARY_DARK = "#155E75";
const ACCENT = "#F59E0B";
// Dark chrome (header, hint banner, control panel, catalog rail) uses this as
// rgba(8,28,38, alpha) — the RN StyleSheet values below inline the same hex
// as literal rgba() strings so each surface can carry its own opacity. Deep
// navy-teal instead of the old green-black, to match the new palette.
const BG = "#FAFAF8";
const SURFACE = "#FFFFFF";
const TEXT_DARK = "#171A19";
const TEXT_MUTED = "#5B6560";
const DANGER = "#B3261E";

// Translates WebXR's raw DOMException names (thrown by navigator.xr.requestSession) into
// plain-English causes, instead of surfacing something like "NotAllowedError" directly.
function translateSessionStartError(e: any): string {
  const name = e?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was denied — please allow camera permissions and try again.";
  }
  if (name === "NotSupportedError") {
    return "Your browser or device doesn't support AR.";
  }
  return e?.message ?? "Could not start AR. Make sure you're on Chrome for Android over HTTPS.";
}

const AXIS_LABELS: { axis: ScaleAxis; label: string }[] = [
  { axis: "x", label: "Width" },
  { axis: "y", label: "Height" },
  { axis: "z", label: "Depth" },
];

// AR's UI doesn't fit the ref/spotlight-based HelpTour used in admin/owner/tenant — there's
// no fixed layout to spotlight here, just a live camera feed — so this is a lighter
// step-by-step card overlay instead, following the same "auto-opens once per device,
// replayable via Help" philosophy as the rest of the app.
const AR_TOUR_STORAGE_KEY = "rentwise-guest:ar-tour-seen";
const AR_TOUR_STEPS = [
  {
    title: "Point & Scan",
    text: "Tap \"Start AR,\" then slowly move your phone around to find a flat floor, tabletop, or wall.",
  },
  {
    title: "Place an Item",
    text: "Once a surface is found, tap it to place the highlighted item from the tray below.",
  },
  {
    title: "Adjust It",
    text: "Tap a placed item to select it, then rotate, resize, move, or delete it using the panel that appears.",
  },
  {
    title: "Finish Up",
    text: "Happy with your arrangement? Tap Done up top when you're finished.",
  },
];

// Reached directly from market-map.tsx's "AR Viewing" button — this IS the AR session
// itself now, not a catalog-browsing/preview step that then links to a separate scene.
export default function ARView() {
  const [objects, setObjects] = useState<ARObject[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [reticleVisible, setReticleVisible] = useState(false);
  const [surfaceType, setSurfaceType] = useState<SurfaceType | null>(null);
  const [placedState, setPlacedState] = useState<PlacedState>({ placed: [], selectedId: null, canUndo: false });
  const [measurement, setMeasurement] = useState<SelectedMeasurement | null>(null);
  const [surfaceIssue, setSurfaceIssue] = useState<SurfaceIssue>(null);
  const [isDim, setIsDim] = useState(false);
  const [isPointingWrong, setIsPointingWrong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasReticleVisibleRef = useRef(false);
  const scanPulseAnim = useRef(new Animated.Value(0)).current;

  // Loops for the entire time AR is active — the "actively scanning" pulse ring is only
  // actually rendered while !reticleVisible (see JSX below), but keeping the loop itself
  // running continuously (rather than starting/stopping it per reticle-visibility change)
  // means it's always mid-cycle and ready the instant it needs to reappear.
  useEffect(() => {
    if (!sessionActive) return;
    scanPulseAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(scanPulseAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [sessionActive]);

  // null = still checking, so we never flash the "Start AR" button on a device that's
  // about to turn out unsupported. Checked proactively via isSessionSupported so we never
  // even attempt navigator.xr.requestSession (i.e. never prompt for camera access) on a
  // device without ARCore, or on iPhone where navigator.xr doesn't exist at all.
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [showUnsupportedModal, setShowUnsupportedModal] = useState(false);
  // Non-AR fallback: the 3D spin-and-inspect preview shown instead of AR placement on
  // devices/browsers where WebXR isn't available at all (all iPhones, older Android, desktop).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [tourVisible, setTourVisible] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // Auto-opens the guided tour the first time this device ever lands on this page — never
  // again after that (localStorage, not AsyncStorage, since rentwise-guest is web-only).
  // Replayable anytime via the header's "?" button.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      if (!localStorage.getItem(AR_TOUR_STORAGE_KEY)) {
        setTourVisible(true);
        localStorage.setItem(AR_TOUR_STORAGE_KEY, "true");
      }
    } catch {
      // Non-fatal — worst case the tour just opens again next visit.
    }
  }, []);

  const canvasContainerRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const sceneRef = useRef<ARSessionScene | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    getARObjects()
      .then(async (data) => {
        setObjects(data);

        // Resolved independently per item — one bad/missing thumbnailStoragePath
        // must not blank out every other item's thumbnail too (Promise.all would
        // reject as a whole on a single failure).
        const entries = await Promise.all(
          data.map(async (o) => {
            try {
              return [o.id, await getModelDownloadUrl(o.thumbnailStoragePath)] as const;
            } catch (err) {
              console.error(`[AR] thumbnail failed for "${o.name}" (${o.id}):`, err);
              return [o.id, null] as const;
            }
          })
        );
        setThumbnailUrls(
          Object.fromEntries(entries.filter((e): e is [string, string] => e[1] !== null))
        );
      })
      .catch((err) => console.error("[AR] failed to load AR objects:", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const nav = navigator as any;
    if (!nav.xr?.isSessionSupported) {
      // Covers iPhone/Safari and any other browser with no WebXR at all.
      setArSupported(false);
      setShowUnsupportedModal(true);
      return;
    }
    nav.xr
      .isSessionSupported("immersive-ar")
      .then((supported: boolean) => {
        setArSupported(supported);
        if (!supported) setShowUnsupportedModal(true);
      })
      .catch(() => {
        setArSupported(false);
        setShowUnsupportedModal(true);
      });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const container = canvasContainerRef.current as unknown as HTMLElement | null;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const scene = new ARSessionScene();
    scene.setCallbacks(setPlacedState, (visible, type) => {
      // Rising edge only (not every visible frame) — a quick vibration the instant a
      // surface is first found, so there's a physical confirmation cue even if you're not
      // staring at exactly the right spot on screen to notice the reticle pop in.
      if (visible && !wasReticleVisibleRef.current) {
        try {
          (navigator as any).vibrate?.(50);
        } catch {
          // Non-fatal — not every device/browser supports vibration.
        }
      }
      wasReticleVisibleRef.current = visible;
      setReticleVisible(visible);
      setSurfaceType(type);
    });
    scene.setMeasurementCallback(setMeasurement);
    scene.setSurfaceIssueCallback(setSurfaceIssue);
    scene.setLightLevelCallback(setIsDim);
    scene.setCameraAngleCallback(setIsPointingWrong);
    scene.mount(canvas);
    sceneRef.current = scene;

    return () => {
      scene.dispose();
      sceneRef.current = null;
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  const startAR = async () => {
    const overlay = overlayRef.current as unknown as HTMLElement | null;
    if (!sceneRef.current || !overlay) return;

    try {
      setError(null);
      await sceneRef.current.startSession(overlay);
      setSessionActive(true);
    } catch (e: any) {
      setError(translateSessionStartError(e));
    }
  };

  const endAR = async () => {
    if (sessionActive) {
      await sceneRef.current?.endSession();
      setSessionActive(false);
    } else {
      router.back();
    }
  };

  // Wired to onPressIn/onPressOut on every control-panel and catalog-rail button, so
  // pressing rotate/scale/move/delete/arm doesn't also place or select something in the
  // scene underneath the button (see ARSessionScene.beginUIInteraction — must start on
  // touch-down, not inside onPress, since the leaking AR "select" event isn't guaranteed
  // to fire after React's onPress handler).
  const suppressPressIn = () => sceneRef.current?.beginUIInteraction();
  const suppressPressOut = () => sceneRef.current?.endUIInteraction();

  const arm = async (o: ARObject) => {
    setArming(true);
    setError(null);
    try {
      const modelUrl = await getModelDownloadUrl(o.modelStoragePath);
      if (arSupported && sceneRef.current) {
        await sceneRef.current.armObject(o.id, modelUrl);
      } else {
        // No AR support on this device/browser — fall back to the 3D spin-and-inspect
        // preview instead of silently doing nothing (the tray used to promise you could
        // "still browse the items below," but nothing actually happened on tap).
        setPreviewUrl(modelUrl);
      }
      setArmedId(o.id);
    } catch (e: any) {
      setError(`Couldn't load "${o.name}": ${e?.message ?? "unknown error"}`);
    } finally {
      setArming(false);
    }
  };

  // Arm the first catalog item automatically once AR starts, so tapping the surface
  // places something immediately instead of silently doing nothing until a thumbnail
  // is tapped first — this was the exact flow gap that made placement look broken.
  useEffect(() => {
    if (sessionActive && !armedId && !arming && objects.length > 0) {
      arm(objects[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, objects]);

  // Same idea for the non-AR fallback: preview the first item automatically once we know
  // AR isn't available, instead of showing an empty spin-viewer until a thumbnail is tapped.
  useEffect(() => {
    if (arSupported === false && !armedId && !arming && objects.length > 0) {
      arm(objects[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arSupported, objects]);

  // The engine consumes the armed item once it's placed (so a tap on/near an existing
  // object places the new one instead of ambiguously selecting the old one — see
  // ARSessionScene.placeArmedAtReticle). Mirror that here: once a new object shows up in
  // placedState, clear the armed thumbnail highlight too, so the UI doesn't keep showing
  // something as "armed" that the engine already treats as spent. The auto-arm effect
  // above then re-arms the first item by default, or the user can tap a different one.
  const prevPlacedCountRef = useRef(0);
  useEffect(() => {
    if (placedState.placed.length > prevPlacedCountRef.current) {
      setArmedId(null);

      // Log the newest placement as an interest signal — see logArPlacement's own comment
      // for why. `placed` preserves insertion order (deleteSelected only filters, never
      // reorders), so the last entry is always the one that was just placed.
      const newest = placedState.placed[placedState.placed.length - 1];
      const placedObject = objects.find((o) => o.id === newest?.objectId);
      if (placedObject) {
        void logArPlacement(placedObject.id, placedObject.name, placedObject.category);
      }
    }
    prevPlacedCountRef.current = placedState.placed.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedState.placed.length]);

  const armedObject = objects.find((o) => o.id === armedId) ?? null;

  // If nothing's been found for a while (and tracking is otherwise fine — "no-results" is
  // the only cause this delay applies to), add a more actionable tip on top of the basic
  // "move your phone" hint. The other two causes (tracking-lost, bad-angle) are shown
  // immediately below since they're unambiguous, real information as soon as they're known.
  const [showSurfaceTip, setShowSurfaceTip] = useState(false);
  useEffect(() => {
    if (!sessionActive || surfaceIssue !== "no-results") {
      setShowSurfaceTip(false);
      return;
    }
    const timer = setTimeout(() => setShowSurfaceTip(true), 6000);
    return () => clearTimeout(timer);
  }, [sessionActive, surfaceIssue]);

  const surfaceHintText =
    surfaceIssue === "tracking-lost"
      ? "Lost tracking — hold your phone steady and slowly look around"
      : surfaceIssue === "bad-angle"
      ? "Surface found, but it's at an odd angle — try a flatter spot"
      : surfaceIssue === "no-results" && isPointingWrong
      ? "Point your camera down toward the floor"
      : surfaceIssue === "no-results" && isDim
      ? "It's quite dark — try a brighter area"
      : showSurfaceTip
      ? "Still looking… try a flat, well-lit, textured floor, tabletop, or wall (avoid glass, mirrors, or glossy/plain white surfaces)"
      : "Move your phone slowly to find a surface…";

  // AR Status checklist — a persistent, glanceable readout of everything the diagnostics
  // above already know, all at once, instead of one message at a time.
  const statusRows: { label: string; ok: boolean; text: string }[] = [
    {
      label: "Tracking",
      ok: surfaceIssue !== "tracking-lost",
      text: surfaceIssue === "tracking-lost" ? "Lost" : "Stable",
    },
    { label: "Lighting", ok: !isDim, text: isDim ? "Too dark" : "Good" },
    {
      label: "Surface",
      ok: reticleVisible,
      text: reticleVisible ? "Found" : surfaceIssue === "bad-angle" ? "Odd angle" : "Searching",
    },
    {
      label: "Camera angle",
      ok: reticleVisible || !isPointingWrong,
      text: reticleVisible || !isPointingWrong ? "Good" : "Point down more",
    },
  ];

  const selectedPlacedObjectId = placedState.selectedId
    ? placedState.placed.find((p) => p.id === placedState.selectedId)?.objectId
    : null;
  const selectedCatalogObject = objects.find((o) => o.id === selectedPlacedObjectId) ?? null;

  if (Platform.OS !== "web") {
    return (
      <View style={styles.webScreen}>
        <Text style={styles.webTitle}>Open on Your Phone's Browser</Text>
        <Text style={styles.webMsg}>
          Arranging items in AR works right in your mobile browser — no app install needed.
        </Text>
        <TouchableOpacity style={styles.webCloseBtn} onPress={() => router.back()}>
          <Text style={styles.webCloseBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Canvas layer (the actual AR/WebGL surface) */}
      <View ref={canvasContainerRef} style={StyleSheet.absoluteFill} />

      {/* Non-AR fallback layer — 3D spin-and-inspect preview for devices/browsers that
          can't do AR placement at all (all iPhones, older Android, desktop). */}
      {arSupported === false && previewUrl && (
        <ModelViewer src={previewUrl} poster={armedId ? thumbnailUrls[armedId] : undefined} />
      )}

      {/* Actively-scanning pulse — visible feedback that the phone is doing something while
          searching for a surface, since real detection latency can't be eliminated (see
          surfaceHintText's own comments) but the *perceived* responsiveness still matters. */}
      {sessionActive && !reticleVisible && (
        <View style={styles.scanPulseWrap} pointerEvents="none">
          <Animated.View
            style={[
              styles.scanPulseRing,
              {
                opacity: scanPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
                transform: [
                  { scale: scanPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.8] }) },
                ],
              },
            ]}
          />
          <View style={styles.scanPulseDot} />
        </View>
      )}

      {/*
        DOM overlay layer, passed to WebXR as domOverlay.root. pointerEvents="box-none" so
        taps on empty space fall through to the canvas below and register as WebXR "select"
        taps (tap-to-place); taps that land on a real button below still work as normal
        presses, since Chrome's dom-overlay only intercepts taps that hit an actual element.
      */}
      <View ref={overlayRef} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Header */}
        <View style={styles.header} pointerEvents="box-none">
          <TouchableOpacity onPress={endAR} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>{sessionActive ? "Done" : "Back"}</Text>
          </TouchableOpacity>
          <View style={styles.headerRightGroup}>
            {sessionActive && placedState.canUndo && (
              <TouchableOpacity
                style={styles.doneBtn}
                onPress={() => sceneRef.current?.undo()}
                onPressIn={suppressPressIn}
                onPressOut={suppressPressOut}
              >
                <Text style={styles.doneBtnText}>Undo</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => {
                setTourStep(0);
                setTourVisible(true);
              }}
            >
              <Text style={styles.doneBtnText}>Help</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!sessionActive && (
          <View style={styles.centerPrompt} pointerEvents="box-none">
            {loading || arSupported === null ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : arSupported === false ? (
              objects.length === 0 ? (
                <Text style={styles.promptText}>No items available to preview yet.</Text>
              ) : (
                <Text style={styles.promptText}>
                  AR placement isn't supported on this device, but you can still rotate and
                  inspect items in 3D — drag to spin, pinch to zoom. Pick a different item from
                  the tray below anytime.
                </Text>
              )
            ) : objects.length === 0 ? (
              <Text style={styles.promptText}>No items available to arrange yet.</Text>
            ) : (
              <>
                <Text style={styles.promptText}>
                  Tap "Start AR", then point your camera at a flat surface. Pick items from the
                  tray below to place them you can place as many as you like together.
                </Text>
                <TouchableOpacity style={styles.startBtn} onPress={startAR}>
                  <Text style={styles.startBtnText}>Start AR</Text>
                </TouchableOpacity>
                {error && <Text style={styles.errorText}>{error}</Text>}
              </>
            )}
          </View>
        )}

        {showUnsupportedModal && (
          <Modal transparent animationType="fade" onRequestClose={() => setShowUnsupportedModal(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Device Not Supported</Text>
                <Text style={styles.modalMessage}>
                  {Platform.OS === "web" &&
                  typeof navigator !== "undefined" &&
                  /iPhone|iPad|iPod/i.test(navigator.userAgent)
                    ? "AR placement isn't available on iPhone yet, but you can still rotate and inspect items in 3D below."
                    : "Your device or browser doesn't support AR placement, but you can still rotate and inspect items in 3D below."}
                </Text>
                <TouchableOpacity
                  style={styles.modalBtn}
                  onPress={() => setShowUnsupportedModal(false)}
                >
                  <Text style={styles.modalBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {tourVisible && (
          <Modal transparent animationType="fade" onRequestClose={() => setTourVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <View style={styles.tourDotsRow}>
                  {AR_TOUR_STEPS.map((_, i) => (
                    <View key={i} style={[styles.tourDot, i === tourStep && styles.tourDotActive]} />
                  ))}
                </View>
                <Text style={styles.modalTitle}>{AR_TOUR_STEPS[tourStep].title}</Text>
                <Text style={styles.modalMessage}>{AR_TOUR_STEPS[tourStep].text}</Text>
                <View style={styles.tourButtonRow}>
                  {tourStep < AR_TOUR_STEPS.length - 1 && (
                    <TouchableOpacity style={styles.tourSkipBtn} onPress={() => setTourVisible(false)}>
                      <Text style={styles.tourSkipBtnText}>Skip</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.modalBtn}
                    onPress={() => {
                      if (tourStep < AR_TOUR_STEPS.length - 1) {
                        setTourStep((s) => s + 1);
                      } else {
                        setTourVisible(false);
                      }
                    }}
                  >
                    <Text style={styles.modalBtnText}>
                      {tourStep < AR_TOUR_STEPS.length - 1 ? "Next" : "Got it"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        )}

        {sessionActive && (
          <View style={styles.statusPanel} pointerEvents="none">
            <View style={styles.statusGrid}>
              {statusRows.map((row) => (
                <View key={row.label} style={styles.statusCell}>
                  <View style={[styles.statusDot, row.ok ? styles.statusDotOk : styles.statusDotBad]} />
                  <Text style={styles.statusLabel}>{row.label}</Text>
                  <Text style={[styles.statusValue, !row.ok && styles.statusValueBad]}>{row.text}</Text>
                </View>
              ))}
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusHintRow}>
              <Text style={styles.statusHintText}>
                {arming
                  ? `Loading ${armedObject?.name ?? "item"}…`
                  : !reticleVisible
                  ? surfaceHintText
                  : armedObject
                  ? `Tap the ${surfaceType === "wall" ? "wall" : "surface"} to place: ${armedObject.name}`
                  : "Tap an item below to place it"}
              </Text>
              {error && (
                <Text style={[styles.statusHintText, styles.hintErrorText]}>{error}</Text>
              )}
            </View>
          </View>
        )}

        {measurement && measurement.visible && (
          <View
            style={[
              styles.measurementLabel,
              { left: measurement.screenX, top: measurement.screenY },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.measurementLabelText}>
              {/* Length is always the longer of the two horizontal
                  measurements, Width the shorter -- a fixed axis (always
                  "X is length") only happened to be right for one model's
                  orientation and was wrong for others. */}
              L: {Math.max(measurement.widthM, measurement.depthM).toFixed(2)}m × W:{" "}
              {Math.min(measurement.widthM, measurement.depthM).toFixed(2)}m × H:{" "}
              {measurement.heightM.toFixed(2)}m
            </Text>
          </View>
        )}

        {placedState.selectedId && (
          <View style={styles.controlPanel} pointerEvents="box-none">
            <Text style={styles.controlLabel} numberOfLines={1}>
              {selectedCatalogObject?.name ?? "Selected item"}
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.controlRow}
              onTouchStart={suppressPressIn}
              onTouchEnd={suppressPressOut}
              onTouchCancel={suppressPressOut}
            >
              <View style={styles.carouselItem}>
                <Text style={styles.carouselItemLabel}>Rotate</Text>
                <View style={styles.controlBtnPair}>
                  {/* THREE.js's rotateY(positive angle) spins the object counterclockwise as
                      seen from a normal standing viewpoint, not clockwise — so the ↻/↺ icons
                      are matched to -15/15 here (not 15/-15) to actually match their labels. */}
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => sceneRef.current?.rotateSelected(-15)}
                  >
                    <Text style={styles.controlBtnText}>↻</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => sceneRef.current?.rotateSelected(15)}
                  >
                    <Text style={styles.controlBtnText}>↺</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.carouselItem}>
                <Text style={styles.carouselItemLabel}>Size</Text>
                <View style={styles.controlBtnPair}>
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => {
                      sceneRef.current?.scaleSelectedAxis("x", 0.9);
                      sceneRef.current?.scaleSelectedAxis("y", 0.9);
                      sceneRef.current?.scaleSelectedAxis("z", 0.9);
                    }}
                  >
                    <Text style={styles.controlBtnText}>▼</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => {
                      sceneRef.current?.scaleSelectedAxis("x", 1.1);
                      sceneRef.current?.scaleSelectedAxis("y", 1.1);
                      sceneRef.current?.scaleSelectedAxis("z", 1.1);
                    }}
                  >
                    <Text style={styles.controlBtnText}>▲</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {AXIS_LABELS.map(({ axis, label }) => (
                <View key={axis} style={styles.carouselItem}>
                  <Text style={styles.carouselItemLabel}>{label}</Text>
                  <View style={styles.controlBtnPair}>
                    <TouchableOpacity
                      style={styles.controlBtn}
                      onPressIn={suppressPressIn}
                      onPressOut={suppressPressOut}
                      onPress={() => sceneRef.current?.scaleSelectedAxis(axis, 0.9)}
                    >
                      <Text style={styles.controlBtnText}>−</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.controlBtn}
                      onPressIn={suppressPressIn}
                      onPressOut={suppressPressOut}
                      onPress={() => sceneRef.current?.scaleSelectedAxis(axis, 1.1)}
                    >
                      <Text style={styles.controlBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View style={styles.carouselItem}>
                <Text style={styles.carouselItemLabel}>Move</Text>
                <TouchableOpacity
                  style={[styles.controlBtn, !reticleVisible && styles.controlBtnDisabled]}
                  disabled={!reticleVisible}
                  onPressIn={suppressPressIn}
                  onPressOut={suppressPressOut}
                  onPress={() => sceneRef.current?.moveSelectedToReticle()}
                >
                  <Text style={styles.controlBtnText}>📍</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.carouselItem}>
                <Text style={styles.carouselItemLabel}>Delete</Text>
                <TouchableOpacity
                  style={[styles.controlBtn, styles.deleteBtn]}
                  onPressIn={suppressPressIn}
                  onPressOut={suppressPressOut}
                  onPress={() => sceneRef.current?.deleteSelected()}
                >
                  <Text style={styles.controlBtnText}>🗑</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}

        {/* Catalog rail — arms which item gets placed on the next tap */}
        {objects.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catalogRow}
            style={styles.catalogScroll}
          >
            {objects.map((o) => (
              <TouchableOpacity
                key={o.id}
                style={[styles.catalogThumb, armedId === o.id && styles.catalogThumbActive]}
                onPressIn={suppressPressIn}
                onPressOut={suppressPressOut}
                onPress={() => arm(o)}
              >
                {thumbnailUrls[o.id] && (
                  <Image source={{ uri: thumbnailUrls[o.id] }} style={styles.catalogThumbImage} />
                )}
                {arming && armedId === o.id && (
                  <ActivityIndicator size="small" color="#fff" style={StyleSheet.absoluteFill} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Stays black — this is the live camera/AR passthrough backdrop, not brand chrome.
  screen: { flex: 1, backgroundColor: "#000" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(8,28,38,0.82)",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  headerRightGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  doneBtn: { width: 48, alignItems: "center" },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  centerPrompt: {
    position: "absolute",
    top: "35%",
    left: 24,
    right: 24,
    alignItems: "center",
    gap: 16,
  },
  promptText: {
    color: "#fff",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 480,
    alignSelf: "center",
  },
  startBtn: {
    backgroundColor: PRIMARY,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
  },
  startBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#ff8080", fontSize: 13, textAlign: "center" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(8,28,38,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: TEXT_DARK },
  modalMessage: { fontSize: 14, color: TEXT_MUTED, textAlign: "center", lineHeight: 20 },
  modalBtn: {
    backgroundColor: PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
    marginTop: 4,
  },
  modalBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  tourDotsRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  tourDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D8D8D3" },
  tourDotActive: { backgroundColor: PRIMARY, width: 16 },
  tourButtonRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  tourSkipBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  tourSkipBtnText: { color: TEXT_MUTED, fontSize: 14, fontWeight: "600" },

  statusPanel: {
    position: "absolute",
    top: 90,
    left: 16,
    width: 230,
    backgroundColor: "rgba(8,28,38,0.82)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  // 2x2 grid — two status readouts per row instead of one long stacked column.
  statusGrid: { flexDirection: "row", flexWrap: "wrap" },
  statusCell: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotOk: { backgroundColor: "#4CAF50" },
  statusDotBad: { backgroundColor: "#FFAA00" },
  statusLabel: { color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: "600" },
  statusValue: { color: "#fff", fontSize: 9, fontWeight: "700" },
  statusValueBad: { color: "#FFD27A" },
  statusDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: 6,
    marginBottom: 8,
  },
  // Hint text now lives at the bottom of the same card as the 2x2 status
  // grid above, instead of being a separate floating banner.
  statusHintRow: { alignItems: "center" },
  statusHintText: { color: "#fff", fontSize: 12, textAlign: "center" },

  scanPulseWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -20,
    marginTop: -20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  scanPulseRing: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: PRIMARY,
  },
  scanPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },

  hintErrorText: {
    marginTop: 6,
    color: "#FF8A80",
  },

  measurementLabel: {
    position: "absolute",
    transform: [{ translateX: "-50%" }, { translateY: "-100%" }],
    backgroundColor: "rgba(8,28,38,0.85)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    marginTop: -8,
  },
  measurementLabelText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  controlPanel: {
    position: "absolute",
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: "rgba(8,28,38,0.92)",
    borderRadius: 14,
    padding: 10,
    gap: 6,
  },
  controlLabel: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
  controlRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 4 },
  carouselItem: { alignItems: "center", gap: 3 },
  carouselItemLabel: { color: "#fff", fontSize: 10, fontWeight: "600" },
  controlBtnPair: { flexDirection: "row", gap: 6 },
  controlBtn: {
    backgroundColor: PRIMARY_DARK,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  controlBtnDisabled: { opacity: 0.4 },
  controlBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  deleteBtn: { backgroundColor: DANGER },

  catalogScroll: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(8,28,38,0.82)",
  },
  catalogRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  catalogThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: SURFACE,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  catalogThumbActive: { borderColor: ACCENT },
  catalogThumbImage: { width: "100%", height: "100%" },

  webScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: BG,
  },
  webTitle: { fontSize: 24, fontWeight: "bold", marginBottom: 12, textAlign: "center", color: TEXT_DARK },
  webMsg: { fontSize: 15, color: TEXT_MUTED, textAlign: "center", marginBottom: 24 },
  webCloseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 10,
  },
  webCloseBtnText: { fontSize: 15, color: PRIMARY, fontWeight: "600" },
});
