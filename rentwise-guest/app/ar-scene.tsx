import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { getARObjects, getModelDownloadUrl } from "../services/modelService";
import type { ARObject } from "../shared/types/arObject";
import { ARSessionScene, PlacedState, ScaleAxis, SurfaceType } from "../features/ar/ARSessionScene";

const AXIS_LABELS: { axis: ScaleAxis; label: string }[] = [
  { axis: "x", label: "Width" },
  { axis: "y", label: "Height" },
  { axis: "z", label: "Depth" },
];

export default function ARScene() {
  const [objects, setObjects] = useState<ARObject[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [reticleVisible, setReticleVisible] = useState(false);
  const [surfaceType, setSurfaceType] = useState<SurfaceType | null>(null);
  const [placedState, setPlacedState] = useState<PlacedState>({ placed: [], selectedId: null });
  const [error, setError] = useState<string | null>(null);

  const canvasContainerRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const sceneRef = useRef<ARSessionScene | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    getARObjects()
      .then(async (data) => {
        setObjects(data);

        const entries = await Promise.all(
          data.map(async (o) => [o.id, await getModelDownloadUrl(o.thumbnailStoragePath)] as const)
        );
        setThumbnailUrls(Object.fromEntries(entries));
      })
      .finally(() => setLoading(false));
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
      setReticleVisible(visible);
      setSurfaceType(type);
    });
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
      setError(
        e?.message ?? "Could not start AR. Make sure you're on Chrome for Android over HTTPS."
      );
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
    if (!sceneRef.current) return;
    setArming(true);
    setError(null);
    try {
      const modelUrl = await getModelDownloadUrl(o.modelStoragePath);
      await sceneRef.current.armObject(o.id, modelUrl);
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

  const armedObject = objects.find((o) => o.id === armedId) ?? null;

  // If no surface has been found for a while, add a more actionable tip on top of the
  // basic "move your phone" hint — flat, textured, well-lit surfaces detect fastest.
  const [showSurfaceTip, setShowSurfaceTip] = useState(false);
  useEffect(() => {
    if (!sessionActive || reticleVisible) {
      setShowSurfaceTip(false);
      return;
    }
    const timer = setTimeout(() => setShowSurfaceTip(true), 6000);
    return () => clearTimeout(timer);
  }, [sessionActive, reticleVisible]);

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
            <Text style={styles.doneBtnText}>{sessionActive ? "Done" : "◀"}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Arrange in AR</Text>
          <View style={styles.doneBtn} />
        </View>

        {!sessionActive && (
          <View style={styles.centerPrompt} pointerEvents="box-none">
            {loading ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : objects.length === 0 ? (
              <Text style={styles.promptText}>No items available to arrange yet.</Text>
            ) : (
              <>
                <Text style={styles.promptText}>
                  Tap "Start AR", then point your camera at a flat surface. Pick items from the
                  tray below to place them — you can place as many as you like together.
                </Text>
                <TouchableOpacity style={styles.startBtn} onPress={startAR}>
                  <Text style={styles.startBtnText}>Start AR</Text>
                </TouchableOpacity>
                {error && <Text style={styles.errorText}>{error}</Text>}
              </>
            )}
          </View>
        )}

        {sessionActive && (
          <View style={styles.hintBanner} pointerEvents="none">
            <Text style={styles.hintText}>
              {arming
                ? `Loading ${armedObject?.name ?? "item"}…`
                : !reticleVisible
                ? showSurfaceTip
                  ? "Still looking… try a flat, well-lit, textured floor, tabletop, or wall (avoid glossy or plain white surfaces)"
                  : "Move your phone slowly to find a surface…"
                : armedObject
                ? `Tap the ${surfaceType === "wall" ? "wall" : "surface"} to place: ${armedObject.name}`
                : "Tap an item below to place it"}
            </Text>
            {error && (
              <Text style={[styles.hintText, styles.hintErrorText]}>{error}</Text>
            )}
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
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => sceneRef.current?.rotateSelected(15)}
                  >
                    <Text style={styles.controlBtnText}>↻</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.controlBtn}
                    onPressIn={suppressPressIn}
                    onPressOut={suppressPressOut}
                    onPress={() => sceneRef.current?.rotateSelected(-15)}
                  >
                    <Text style={styles.controlBtnText}>↺</Text>
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
  screen: { flex: 1, backgroundColor: "#000" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(26,26,26,0.7)",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  doneBtn: { width: 48, alignItems: "center" },
  doneBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "bold" },

  centerPrompt: {
    position: "absolute",
    top: "35%",
    left: 24,
    right: 24,
    alignItems: "center",
    gap: 16,
  },
  promptText: { color: "#fff", fontSize: 15, textAlign: "center", lineHeight: 22 },
  startBtn: {
    backgroundColor: "#8b7355",
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
  },
  startBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#ff8080", fontSize: 13, textAlign: "center" },

  hintBanner: {
    position: "absolute",
    top: 100,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  hintText: {
    color: "#fff",
    fontSize: 13,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: "hidden",
  },
  hintErrorText: {
    marginTop: 8,
    backgroundColor: "rgba(139,61,61,0.85)",
    color: "#fff",
  },

  controlPanel: {
    position: "absolute",
    bottom: 110,
    left: 16,
    right: 16,
    backgroundColor: "rgba(26,26,26,0.9)",
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
    backgroundColor: "#6b5b45",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  controlBtnDisabled: { opacity: 0.4 },
  controlBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  deleteBtn: { backgroundColor: "#8b3d3d" },

  catalogScroll: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(26,26,26,0.7)",
  },
  catalogRow: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  catalogThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: "#fff",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  catalogThumbActive: { borderColor: "#8b7355" },
  catalogThumbImage: { width: "100%", height: "100%" },

  webScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  webTitle: { fontSize: 24, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  webMsg: { fontSize: 15, color: "#555", textAlign: "center", marginBottom: 24 },
  webCloseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderRadius: 10,
  },
  webCloseBtnText: { fontSize: 15 },
});
