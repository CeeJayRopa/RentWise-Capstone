import { ARSceneView, type GeometryNode, type ModelNode, type PlaneDetectedEvent, type TapEvent } from "@sceneview-sdk/react-native";
import { router } from "expo-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  ChevronLeft,
  HelpCircle,
  Minus,
  Plus,
  RotateCw,
  ScanLine,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  type NativeSyntheticEvent,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getTenantARCatalog, type ResolvedARCatalogObject } from "../services/arService";
import { colors, fontFamily, radius, shadow, spacing } from "../shared/theme";

type AxisScale = [number, number, number];

type PlacedObject = {
  id: string;
  catalog: ResolvedARCatalogObject;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: AxisScale;
};

type NativeModelNode = ModelNode & { axisScale: AxisScale };

type TrackingUpdatedEvent = {
  x: number;
  y: number;
  z: number;
  placementValid: boolean;
  trackingState: string;
  lightingGood: boolean;
  cameraAngleGood: boolean;
};

type ToolMode = "rotate" | "resize" | null;

const TenantARSceneView = ARSceneView as React.ComponentType<React.ComponentProps<typeof ARSceneView> & {
  onTrackingUpdated?: (event: NativeSyntheticEvent<TrackingUpdatedEvent>) => void;
}>;

const BASE_MODEL_SIZE = 0.55;
const SCALE_STEP = 0.1;
const MOVE_STEP = 0.08;

function modelNameFromUrl(url: string) {
  const clean = url.split("?")[0].split("#")[0];
  return clean.substring(clean.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

export default function ARDesignerScreen() {
  const [cameraGranted, setCameraGranted] = useState<boolean | null>(null);
  const [catalog, setCatalog] = useState<ResolvedARCatalogObject[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [armed, setArmed] = useState<ResolvedARCatalogObject | null>(null);
  const [placed, setPlaced] = useState<PlacedObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planeFound, setPlaneFound] = useState(false);
  const [placementValid, setPlacementValid] = useState(false);
  const [trackingState, setTrackingState] = useState("PAUSED");
  const [lightingGood, setLightingGood] = useState(false);
  const [cameraAngleGood, setCameraAngleGood] = useState(false);
  const [placementPoint, setPlacementPoint] = useState<[number, number, number] | null>(null);
  const [detectedPlanes, setDetectedPlanes] = useState<Array<PlaneDetectedEvent>>([]);
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [resizeAxis, setResizeAxis] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (Platform.OS !== "android") {
      setCameraGranted(false);
      return;
    }
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then((result) => {
      setCameraGranted(result === PermissionsAndroid.RESULTS.GRANTED);
    });
  }, []);

  useEffect(() => {
    getTenantARCatalog()
      .then((items) => {
        setCatalog(items);
        setArmed(items[0] ?? null);
      })
      .catch(() => Alert.alert("Catalog unavailable", "The AR object catalog could not be loaded. Please check your connection and try again."))
      .finally(() => setCatalogLoading(false));
  }, []);

  const modelNodes = useMemo<NativeModelNode[]>(
    () => placed.map((item) => ({
      src: item.catalog.modelUrl,
      position: item.position,
      rotation: item.rotation,
      scale: BASE_MODEL_SIZE,
      axisScale: item.scale,
    })),
    [placed],
  );

  const floorNodes = useMemo<GeometryNode[]>(
    () => detectedPlanes.map((plane) => ({
      type: "cube",
      size: [Math.max(plane.extent[0], 0.2), 0.004, Math.max(plane.extent[1], 0.2)],
      position: [plane.center[0], plane.center[1] + 0.002, plane.center[2]],
      color: "#3309A66D",
      unlit: true,
    })),
    [detectedPlanes],
  );

  const selected = placed.find((item) => item.id === selectedId) ?? null;
  const arReady = trackingState === "TRACKING" && lightingGood && planeFound && cameraAngleGood && placementValid;

  function handleSceneTap(event: { nativeEvent: TapEvent }) {
    const { x, y, z, nodeName } = event.nativeEvent;
    if (nodeName) {
      const match = [...placed].reverse().find((item) => modelNameFromUrl(item.catalog.modelUrl) === nodeName);
      if (match) setSelectedId(match.id);
      return;
    }
    if (!armed || !arReady || (x === 0 && y === 0 && z === 0)) return;
    const next: PlacedObject = {
      id: `${armed.id}-${Date.now()}`,
      catalog: armed,
      position: [x, y, z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    setPlaced((current) => [...current, next]);
    setSelectedId(next.id);
  }

  function handleTrackingUpdated(event: NativeSyntheticEvent<TrackingUpdatedEvent>) {
    const update = event.nativeEvent;
    setPlacementValid(update.placementValid);
    setTrackingState(update.trackingState);
    setLightingGood(update.lightingGood);
    setCameraAngleGood(update.cameraAngleGood);
    setPlacementPoint(update.placementValid ? [update.x, update.y, update.z] : null);
  }

  function handlePlaneDetected(event: NativeSyntheticEvent<PlaneDetectedEvent>) {
    const plane = event.nativeEvent;
    if (plane.type !== "horizontal") return;
    setPlaneFound(true);
    setDetectedPlanes((current) => current.some((item) => item.id === plane.id) ? current : [...current, plane]);
  }

  function moveSelectedToReticle() {
    if (!placementPoint) return;
    updateSelected((item) => ({ ...item, position: placementPoint }));
  }

  function updateSelected(updater: (item: PlacedObject) => PlacedObject) {
    if (!selectedId) return;
    setPlaced((current) => current.map((item) => item.id === selectedId ? updater(item) : item));
  }

  function adjustScale(axis: 0 | 1 | 2, amount: number) {
    updateSelected((item) => {
      const next = [...item.scale] as AxisScale;
      next[axis] = Math.max(0.2, Math.min(3, Number((next[axis] + amount).toFixed(2))));
      return { ...item, scale: next };
    });
  }

  function moveSelected(dx: number, dz: number) {
    updateSelected((item) => ({
      ...item,
      position: [item.position[0] + dx, item.position[1], item.position[2] + dz],
    }));
  }

  function removeSelected() {
    if (!selectedId) return;
    setPlaced((current) => current.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  }

  if (cameraGranted === null) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.emeraldBright} /></View>;
  }

  if (!cameraGranted) {
    return (
      <SafeAreaView style={styles.unsupported}>
        <Box size={52} color={colors.emerald} />
        <Text style={styles.unsupportedTitle}>Camera access is required</Text>
        <Text style={styles.unsupportedText}>Allow RentWise to use the camera, then reopen the AR designer.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#071A15" />
      <TenantARSceneView
        style={StyleSheet.absoluteFill}
        planeDetection={false}
        depthOcclusion
        instantPlacement={false}
        modelNodes={modelNodes}
        geometryNodes={floorNodes}
        onPlaneDetected={handlePlaneDetected}
        onTrackingUpdated={handleTrackingUpdated}
        onTap={handleSceneTap}
      />

      <SafeAreaView pointerEvents="box-none" style={styles.overlay}>
        <View style={styles.topBar}>
          <Pressable style={styles.circleButton} onPress={() => router.back()}>
            <ChevronLeft size={25} color={colors.white} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>TENANT TOOLS</Text>
            <Text style={styles.title}>AR Stall Designer</Text>
          </View>
          <Pressable style={styles.helpButton} onPress={() => setHelpOpen(true)}>
            <Text style={styles.helpText}>Help</Text>
            <HelpCircle size={21} color={colors.white} />
          </Pressable>
        </View>

        {!planeFound && (
          <View style={styles.scanBanner}>
            <ScanLine size={20} color={colors.white} />
            <Text style={styles.scanText}>Move your phone slowly to scan the floor.</Text>
          </View>
        )}

        <View pointerEvents="none" style={styles.diagnosticsPanel}>
          <View style={styles.diagnosticsTitleRow}>
            <View style={[styles.statusDot, arReady ? styles.statusDotReady : styles.statusDotSearching]} />
            <Text style={styles.diagnosticsTitle}>{arReady ? "Ready to place" : "Scanning surroundings"}</Text>
          </View>
          <View style={styles.diagnosticsItems}>
            {[
              ["Tracking", trackingState === "TRACKING", trackingState === "TRACKING" ? "Stable" : "Lost"],
              ["Lighting", lightingGood, lightingGood ? "Good" : "Too dark"],
              ["Surface", planeFound && placementValid, planeFound && placementValid ? "Found" : "Searching"],
              ["Camera angle", cameraAngleGood, cameraAngleGood ? "Good" : "Point down more"],
            ].map(([label, ok, value]) => (
              <View key={String(label)} style={styles.diagnosticsCell}>
                <View style={[styles.miniStatusDot, ok ? styles.statusDotReady : styles.statusDotSearching]} />
                <Text style={styles.diagnosticsItem}>{String(label)} {String(value)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.diagnosticsHint}>
            {arReady
              ? armed
                ? `Tap the green floor to place: ${armed.name}`
                : "Tap an item below to place it"
              : !lightingGood
              ? "Try a brighter area"
              : !cameraAngleGood
              ? "Point your camera down toward the floor"
              : "Move your phone slowly to find a surface…"}
          </Text>
        </View>

        {arReady && (
          <View pointerEvents="none" style={[styles.reticle, styles.reticleReady]}>
            <View style={[styles.reticleCenter, styles.reticleCenterReady]} />
          </View>
        )}

        <View style={styles.flexSpacer} />

        {selected && (
          <View style={styles.controls}>
            <View style={styles.controlHeader}>
              <View>
                <Text style={styles.controlEyebrow}>SELECTED ITEM</Text>
                <Text style={styles.controlTitle}>{selected.catalog.name}</Text>
              </View>
              {toolMode && <Pressable style={styles.backToToolsButton} onPress={() => setToolMode(null)}><Text style={styles.backToToolsText}>Back to controls</Text></Pressable>}
            </View>

            {toolMode === "resize" ? (
              <View style={styles.toolPanel}>
                <View style={styles.axisTabs}>
                  {([0, 1, 2] as const).map((axis) => (
                    <Pressable key={axis} style={[styles.axisTab, resizeAxis === axis && styles.axisTabActive]} onPress={() => setResizeAxis(axis)}>
                      <Text style={[styles.axisTabText, resizeAxis === axis && styles.axisTabTextActive]}>{["Length", "Height", "Width"][axis]}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.largeStepper}>
                  <Pressable style={styles.stepButton} onPress={() => adjustScale(resizeAxis, -SCALE_STEP)}><Minus size={22} color={colors.white} /></Pressable>
                  <Text style={styles.largeScaleValue}>{Math.round(selected.scale[resizeAxis] * 100)}%</Text>
                  <Pressable style={styles.stepButton} onPress={() => adjustScale(resizeAxis, SCALE_STEP)}><Plus size={22} color={colors.white} /></Pressable>
                </View>
              </View>
            ) : toolMode === "rotate" ? (
              <View style={styles.toolPanel}>
                <Text style={styles.toolTitle}>Rotate object</Text>
                <View style={styles.largeStepper}>
                  <Pressable style={styles.stepButton} onPress={() => updateSelected((item) => ({ ...item, rotation: [0, item.rotation[1] - 15, 0] }))}><RotateCw size={22} color={colors.white} style={{ transform: [{ scaleX: -1 }] }} /></Pressable>
                  <Text style={styles.largeScaleValue}>{Math.round(selected.rotation[1])}°</Text>
                  <Pressable style={styles.stepButton} onPress={() => updateSelected((item) => ({ ...item, rotation: [0, item.rotation[1] + 15, 0] }))}><RotateCw size={22} color={colors.white} /></Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.actionRow}>
                <Pressable style={styles.actionButton} onPress={() => setToolMode("rotate")}><RotateCw size={21} color={colors.white} /><Text style={styles.actionText}>Rotate</Text></Pressable>
                <Pressable style={styles.actionButton} onPress={() => setToolMode("resize")}><Box size={21} color={colors.white} /><Text style={styles.actionText}>Resize</Text></Pressable>
                <Pressable style={[styles.actionButton, !arReady && styles.actionButtonDisabled]} disabled={!arReady} onPress={moveSelectedToReticle}><ScanLine size={21} color={colors.white} /><Text style={styles.actionText}>Move</Text></Pressable>
                <Pressable style={[styles.actionButton, styles.deleteAction]} onPress={removeSelected}><Trash2 size={21} color="#FF817A" /><Text style={[styles.actionText, styles.deleteActionText]}>Delete</Text></Pressable>
              </View>
            )}
          </View>
        )}

        <View style={styles.catalogPanel}>
          <View style={styles.catalogHeader}>
            <View>
              <Text style={styles.controlEyebrow}>ADD TO SCENE</Text>
              <Text style={styles.catalogTitle}>Market fixtures</Text>
            </View>
            <Pressable onPress={() => setCatalogOpen((open) => !open)}>
              <Text style={styles.catalogToggle}>{catalogOpen ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          {catalogOpen && (
            catalogLoading ? <ActivityIndicator color={colors.emeraldBright} style={{ marginVertical: 18 }} /> :
            <FlatList
              horizontal
              data={catalog}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catalogList}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.catalogItem, armed?.id === item.id && styles.catalogItemActive]}
                  onPress={() => setArmed(item)}
                >
                  <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
                  <Text numberOfLines={1} style={styles.catalogName}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
          <Text style={styles.placeHint}>
            {armed
              ? arReady
                ? `Tap the green floor to place ${armed.name}.`
                : "Aim the reticle at a clear floor area."
              : "Choose an object to begin."}
          </Text>
        </View>
      </SafeAreaView>

      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={() => setHelpOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>AR Designer Help</Text>
              <Pressable onPress={() => setHelpOpen(false)}><X size={23} color={colors.ink} /></Pressable>
            </View>
            <Text style={styles.helpStep}>1. Move your phone slowly until a floor is detected.</Text>
            <Text style={styles.helpStep}>2. Select an item from Market fixtures.</Text>
            <Text style={styles.helpStep}>3. Tap the detected floor to place it.</Text>
            <Text style={styles.helpStep}>4. Tap an object to select, move, rotate, resize, or delete it.</Text>
            <Pressable style={styles.primaryButton} onPress={() => setHelpOpen(false)}>
              <Text style={styles.primaryButtonText}>Continue Designing</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#071A15" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: spacing.md },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: "rgba(7,26,21,0.88)", borderRadius: radius.lg, padding: spacing.sm },
  circleButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  titleBlock: { flex: 1 },
  eyebrow: { color: "rgba(255,255,255,0.58)", fontSize: 9, fontFamily: fontFamily.bold, letterSpacing: 1 },
  title: { color: colors.white, fontSize: 17, fontFamily: fontFamily.bold },
  helpButton: { flexDirection: "row", gap: 5, alignItems: "center", paddingHorizontal: 10, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.12)" },
  helpText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 13 },
  scanBanner: { alignSelf: "center", marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(14,107,84,0.92)", borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  scanText: { color: colors.white, fontFamily: fontFamily.medium, fontSize: 12 },
  diagnosticsPanel: { alignSelf: "center", width: "92%", marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: "rgba(7,26,21,0.86)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  diagnosticsTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  statusDotReady: { backgroundColor: "#45D483" },
  statusDotSearching: { backgroundColor: "#F2B84B" },
  diagnosticsTitle: { color: colors.white, fontFamily: fontFamily.bold, fontSize: 13 },
  diagnosticsItems: { marginTop: 7, flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 5 },
  diagnosticsCell: { width: "48%", flexDirection: "row", alignItems: "center", gap: 5 },
  miniStatusDot: { width: 6, height: 6, borderRadius: 3 },
  diagnosticsItem: { color: "rgba(255,255,255,0.72)", fontFamily: fontFamily.medium, fontSize: 9 },
  diagnosticsHint: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 11, textAlign: "center", marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" },
  reticle: { position: "absolute", left: "50%", top: "50%", width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: 26, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  reticleReady: { borderColor: "#45D483", backgroundColor: "rgba(69,212,131,0.12)" },
  reticleSearching: { borderColor: "rgba(255,255,255,0.75)", backgroundColor: "rgba(7,26,21,0.16)" },
  reticleCenter: { width: 8, height: 8, borderRadius: 4 },
  reticleCenterReady: { backgroundColor: "#45D483" },
  reticleCenterSearching: { backgroundColor: colors.white },
  flexSpacer: { flex: 1 },
  controls: { backgroundColor: "rgba(7,26,21,0.94)", borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  controlHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  controlEyebrow: { color: "rgba(255,255,255,0.5)", fontSize: 9, fontFamily: fontFamily.bold, letterSpacing: 1 },
  controlTitle: { color: colors.white, fontSize: 15, fontFamily: fontFamily.bold },
  deleteButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(178,64,59,0.2)" },
  backToToolsButton: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  backToToolsText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 10 },
  toolPanel: { gap: spacing.sm },
  toolTitle: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 13 },
  axisTabs: { flexDirection: "row", gap: 7 },
  axisTab: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  axisTabActive: { backgroundColor: "rgba(93,231,194,0.2)", borderColor: "#5DE7C2" },
  axisTabText: { color: "rgba(255,255,255,0.65)", fontFamily: fontFamily.semibold, fontSize: 11 },
  axisTabTextActive: { color: "#5DE7C2" },
  largeStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.07)", padding: 7 },
  stepButton: { width: 46, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.1)" },
  largeScaleValue: { color: colors.white, fontFamily: fontFamily.bold, fontSize: 16 },
  actionRow: { flexDirection: "row", gap: 7 },
  actionButton: { flex: 1, minHeight: 52, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.09)", borderWidth: 1, borderColor: "rgba(255,255,255,0.17)", alignItems: "center", justifyContent: "center", gap: 3 },
  actionButtonDisabled: { opacity: 0.38 },
  actionText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 10 },
  deleteAction: { backgroundColor: "rgba(178,64,59,0.15)" },
  deleteActionText: { color: "#FF817A" },
  scaleRow: { flexDirection: "row", gap: 7 },
  scaleControl: { flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radius.sm, padding: 8 },
  scaleLabel: { color: "rgba(255,255,255,0.7)", fontFamily: fontFamily.medium, fontSize: 10, textAlign: "center", marginBottom: 6 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scaleValue: { color: colors.white, fontFamily: fontFamily.bold, fontSize: 11 },
  transformRow: { flexDirection: "row", gap: 7, marginTop: spacing.sm },
  transformButton: { width: 39, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  rotateButton: { flex: 1, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: colors.emerald },
  rotateText: { color: colors.white, fontFamily: fontFamily.semibold, fontSize: 12 },
  catalogPanel: { backgroundColor: "rgba(7,26,21,0.96)", borderRadius: radius.lg, paddingTop: spacing.md, overflow: "hidden" },
  catalogHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md },
  catalogTitle: { color: colors.white, fontSize: 15, fontFamily: fontFamily.bold },
  catalogToggle: { color: colors.emeraldBright, fontFamily: fontFamily.bold, fontSize: 12 },
  catalogList: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  catalogItem: { width: 78, padding: 5, borderRadius: radius.md, borderWidth: 1.5, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.07)" },
  catalogItemActive: { borderColor: colors.emeraldBright, backgroundColor: "rgba(23,166,127,0.18)" },
  thumbnail: { width: 65, height: 52, borderRadius: radius.sm, backgroundColor: colors.mist },
  catalogName: { color: colors.white, fontFamily: fontFamily.medium, fontSize: 10, marginTop: 5, textAlign: "center" },
  placeHint: { color: "rgba(255,255,255,0.68)", fontFamily: fontFamily.regular, fontSize: 10, textAlign: "center", paddingBottom: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: spacing.xl },
  modalCard: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xl, ...shadow.raised },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  modalTitle: { color: colors.ink, fontFamily: fontFamily.bold, fontSize: 20 },
  helpStep: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21, marginBottom: spacing.sm },
  primaryButton: { backgroundColor: colors.emerald, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center", marginTop: spacing.lg },
  primaryButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: 14 },
  unsupported: { flex: 1, backgroundColor: colors.parchment, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  unsupportedTitle: { color: colors.ink, fontFamily: fontFamily.bold, fontSize: 21, textAlign: "center", marginTop: spacing.lg },
  unsupportedText: { color: colors.textSecondary, fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: spacing.sm },
});
