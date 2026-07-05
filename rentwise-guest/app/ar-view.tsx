import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { getARObjects, getModelDownloadUrl } from "../services/modelService";
import type { ARObject } from "../shared/types/arObject";
import ModelViewer from "../features/ar/ModelViewer";

export default function ARView() {
  const [objects, setObjects] = useState<ARObject[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    getARObjects()
      .then(async (data) => {
        setObjects(data);
        if (data.length > 0) setSelectedId(data[0].id);

        const entries = await Promise.all(
          data.map(async (o) => [o.id, await getModelDownloadUrl(o.thumbnailStoragePath)] as const)
        );
        setThumbnailUrls(Object.fromEntries(entries));
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedObject = objects.find((o) => o.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedObject) return;
    let cancelled = false;
    setModelUrl(null);

    getModelDownloadUrl(selectedObject.modelStoragePath).then((url) => {
      if (!cancelled) setModelUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedObject?.id]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(objects.map((o) => o.category)))],
    [objects]
  );

  const filteredObjects = useMemo(
    () =>
      selectedCategory === "All"
        ? objects
        : objects.filter((o) => o.category === selectedCategory),
    [objects, selectedCategory]
  );

  if (Platform.OS === "web" && loading) {
    return (
      <View style={styles.webLoading}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (Platform.OS !== "web") {
    return (
      <View style={styles.webScreen}>
        <Text style={styles.webTitle}>Open on Your Phone's Browser</Text>
        <Text style={styles.webMsg}>
          AR viewing works right in your mobile browser — no app install needed.
        </Text>
        <TouchableOpacity style={styles.webCloseBtn} onPress={() => router.back()}>
          <Text style={styles.webCloseBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.hamburger} onPress={() => router.back()}>
          <Text style={styles.hamburgerIcon}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AR Viewing</Text>
        <View style={styles.hamburger} />
      </View>

      {/* 3D preview area */}
      <View style={styles.cameraArea}>
        {objects.length === 0 ? (
          <Text style={styles.emptyText}>No items available to view yet.</Text>
        ) : modelUrl ? (
          <ModelViewer
            src={modelUrl}
            poster={selectedObject ? thumbnailUrls[selectedObject.id] : undefined}
          />
        ) : (
          <ActivityIndicator size="small" color="#fff" style={styles.previewLoading} />
        )}
      </View>

      {/* Arrange in AR bar */}
      <View style={styles.captureBar}>
        <TouchableOpacity
          style={[styles.arBtn, objects.length === 0 && styles.arBtnDisabled]}
          disabled={objects.length === 0}
          onPress={() => router.push("/ar-scene")}
        >
          <Text style={styles.arBtnText}>Arrange in AR →</Text>
        </TouchableOpacity>
      </View>

      {/* Category pills */}
      <View style={styles.categoryRow}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.categoryPill,
              selectedCategory === cat && styles.categoryPillActive,
            ]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text
              style={[
                styles.categoryText,
                selectedCategory === cat && styles.categoryTextActive,
              ]}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Object selection row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.objectRow}
        style={styles.objectScroll}
      >
        {filteredObjects.map((o) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.objectThumb, selectedId === o.id && styles.objectThumbActive]}
            onPress={() => setSelectedId(o.id)}
          >
            {thumbnailUrls[o.id] && (
              <Image source={{ uri: thumbnailUrls[o.id] }} style={styles.objectThumbImage} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#1a1a1a" },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
  },
  hamburger: { width: 36, alignItems: "center" },
  hamburgerIcon: { color: "#fff", fontSize: 22 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  /* Preview area */
  cameraArea: {
    flex: 1,
    backgroundColor: "#d4d4d4",
    overflow: "hidden",
  },
  previewLoading: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -10,
    marginLeft: -10,
  },
  emptyText: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#555",
    fontSize: 14,
  },

  /* View in AR bar */
  captureBar: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: "#2e2e2e",
    alignItems: "center",
  },
  arBtn: {
    backgroundColor: "#8b7355",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 24,
  },
  arBtnDisabled: {
    opacity: 0.5,
  },
  arBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  /* Category pills */
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#1a1a1a",
  },
  categoryPill: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#6b5b45",
  },
  categoryPillActive: {
    backgroundColor: "#8b7355",
  },
  categoryText: { color: "#fff", fontSize: 13 },
  categoryTextActive: { fontWeight: "bold" },

  /* Object thumbnails */
  objectScroll: { backgroundColor: "#1a1a1a" },
  objectRow: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  objectThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: "#fff",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  objectThumbActive: {
    borderColor: "#8b7355",
  },
  objectThumbImage: { width: "100%", height: "100%" },

  /* Web loading */
  webLoading: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
  },

  /* Native fallback */
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
