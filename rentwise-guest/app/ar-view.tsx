import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useState } from "react";

const CATEGORIES = ["All", "Category 1", "Category 2"];

// Placeholder object thumbnails (4 items)
const OBJECTS = [0, 1, 2, 3];

export default function ARView() {
  const [selectedCategory, setSelectedCategory] = useState("All");

  if (Platform.OS === "web") {
    return (
      <View style={styles.webScreen}>
        <Text style={styles.webTitle}>AR Unavailable</Text>
        <Text style={styles.webMsg}>
          AR viewing requires a mobile device for the best experience.
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
        <TouchableOpacity style={styles.hamburger}>
          <Text style={styles.hamburgerIcon}>≡</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AR Viewing</Text>
        <View style={styles.hamburger} />
      </View>

      {/* Camera preview area */}
      <View style={styles.cameraArea}>
        <View style={styles.xLine1} />
        <View style={styles.xLine2} />
      </View>

      {/* Camera capture bar */}
      <View style={styles.captureBar}>
        <TouchableOpacity style={styles.captureBtn}>
          <Text style={styles.cameraIcon}>📷</Text>
        </TouchableOpacity>
      </View>

      {/* Category pills */}
      <View style={styles.categoryRow}>
        {CATEGORIES.map((cat) => (
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
        {OBJECTS.map((i) => (
          <TouchableOpacity key={i} style={styles.objectThumb} />
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
  hamburgerIcon: { color: "#fff", fontSize: 26 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  /* Camera area */
  cameraArea: {
    flex: 1,
    backgroundColor: "#d4d4d4",
    overflow: "hidden",
  },
  xLine1: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "34deg" }, { scaleX: 3 }],
  },
  xLine2: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#aaa",
    transform: [{ rotate: "-34deg" }, { scaleX: 3 }],
  },

  /* Capture bar */
  captureBar: {
    height: 72,
    backgroundColor: "#2e2e2e",
    justifyContent: "center",
    alignItems: "center",
  },
  captureBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1a1a1a",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#555",
  },
  cameraIcon: { fontSize: 22 },

  /* Category pills */
  categoryRow: {
    flexDirection: "row",
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
  },

  /* Web fallback */
  webScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  webTitle: { fontSize: 24, fontWeight: "bold", marginBottom: 12 },
  webMsg: { fontSize: 15, color: "#555", textAlign: "center", marginBottom: 24 },
  webCloseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderRadius: 10,
  },
  webCloseBtnText: { fontSize: 15 },
});
