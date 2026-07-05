import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";

import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import Sidebar from "./components/Sidebar";
import UpdatesReportFAB from "./components/UpdatesReportFAB";
import NotificationBell from "./components/NotificationBell";

type StallDoc = {
  id: string;
  buildingNumber: number;
  spaceId: string;
  name: string;
  price: number;
  paymentSchedule: string;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantId: string | null;
};

type TenantInfo = {
  firstName: string;
  lastName: string;
};

export default function Building() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [allStalls, setAllStalls] = useState<StallDoc[]>([]);

  const [tenantMap, setTenantMap] = useState<Map<string, TenantInfo>>(
    new Map(),
  );

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);

  const [filter, setFilter] = useState<"All" | "Unoccupied" | "Occupied">(
    "All",
  );
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const [sidebarVisible, setSidebarVisible] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      setChecking(false);
      fetchData();
    });

    return unsubscribe;
  }, []);

  const fetchData = async () => {
    setLoading(true);

    try {
      const [stallsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "stalls")),

        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
      ]);

      const stalls: StallDoc[] = stallsSnap.docs.map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,

          buildingNumber: Number(data.buildingNumber ?? 0),

          spaceId: data.spaceId ?? "",

          name: data.name ?? "",

          price: Number(data.price ?? 0),

          paymentSchedule: data.paymentSchedule ?? "",

          status: data.status ?? "unoccupied",

          tenantId: data.tenantId ?? null,
        };
      });

      setAllStalls(stalls);

      const buildings = [...new Set(stalls.map((s) => s.buildingNumber))].sort(
        (a, b) => a - b,
      );

      if (buildings.length > 0) {
        setSelectedBuilding((prev) => (prev !== null ? prev : buildings[0]));
      }

      const map = new Map<string, TenantInfo>();

      usersSnap.docs.forEach((doc) => {
        const data = doc.data();

        map.set(doc.id, {
          firstName: data.firstName ?? "",

          lastName: data.lastName ?? "",
        });
      });

      setTenantMap(map);
    } catch (error) {
      console.log("BUILDING ERROR:", error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!checking) {
        fetchData();
      }
    }, [checking]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const buildingNumbers = [
    ...new Set(allStalls.map((s) => s.buildingNumber)),
  ].sort((a, b) => a - b);

  const displayedStalls = allStalls

    .filter(
      (stall) =>
        selectedBuilding === null || stall.buildingNumber === selectedBuilding,
    )

    .filter((stall) => {
      if (filter === "All") return true;

      if (filter === "Occupied") return stall.status === "occupied";

      return stall.status === "unoccupied";
    })

    .sort((a, b) => {
      if (a.buildingNumber !== b.buildingNumber)
        return a.buildingNumber - b.buildingNumber;
      const numA = Number(a.spaceId.split("-")[1] ?? 0);
      const numB = Number(b.spaceId.split("-")[1] ?? 0);
      return numA - numB;
    });

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator size="large" color="#0C2D6B" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <View
        style={[styles.header, { paddingTop: insets.top + 14 }]}
      >
        <TouchableOpacity onPress={() => setSidebarVisible(true)}>
          <Ionicons name="menu" size={24} color="#E6F1FB" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Building Management</Text>

        <NotificationBell />
      </View>

      {/* BANNER */}
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Ka Domeng Talipapa Wet and Dry Market
        </Text>
      </View>

      {/* BODY */}
      <View style={styles.body}>
        {/* DROPDOWN + FILTER — same row, elevated when a dropdown is open */}
        <View
          style={[
            styles.topRow,
            sheetVisible || filterSheetVisible ? { zIndex: 150 } : undefined,
          ]}
        >
          {/* BUILDING DROPDOWN */}
          <View style={styles.dropdownWrapper}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => {
                setFilterSheetVisible(false);
                setSheetVisible((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <Text
                style={styles.dropdownTriggerText}
                numberOfLines={1}
              >
                {selectedBuilding !== null
                  ? `Building ${selectedBuilding}`
                  : "Building"}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#2E6FD9" />
            </TouchableOpacity>

            {sheetVisible && (
              <View style={styles.dropdown}>
                <View style={styles.dropdownInner}>
                  {buildingNumbers.map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.dropdownItem,
                        selectedBuilding === num && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedBuilding(num);
                        setSheetVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selectedBuilding === num &&
                            styles.dropdownItemTextActive,
                        ]}
                      >
                        Building {num}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* STATUS FILTER DROPDOWN */}
          <View style={styles.filterDropdownWrapper}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => {
                setSheetVisible(false);
                setFilterSheetVisible((v) => !v);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                {filter}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#2E6FD9" />
            </TouchableOpacity>

            {filterSheetVisible && (
              <View style={styles.dropdown}>
                <View style={styles.dropdownInner}>
                  {(["All", "Unoccupied", "Occupied"] as const).map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.dropdownItem,
                        filter === item && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setFilter(item);
                        setFilterSheetVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          filter === item && styles.dropdownItemTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* STALL LIST — all spaces live in one card; the card itself scrolls
            internally as more stalls get added over time */}
        <View style={[styles.listCard, { marginBottom: insets.bottom + 64 }]}>
          {loading ? (
            <View style={styles.listCardCenteredBox}>
              <ActivityIndicator size="large" color="#0C2D6B" />
            </View>
          ) : displayedStalls.length === 0 ? (
            <View style={styles.listCardCenteredBox}>
              <Ionicons
                name="business-outline"
                size={40}
                color="#B5D4F4"
                style={{ marginBottom: 10 }}
              />
              <Text style={styles.emptyText}>No stalls found.</Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              {displayedStalls.map((item) => (
                <StallRow key={item.id} stall={item} tenantMap={tenantMap} />
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* DROPDOWN BACKDROP */}
      {(sheetVisible || filterSheetVisible) && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
          onPress={() => {
            setSheetVisible(false);
            setFilterSheetVisible(false);
          }}
          activeOpacity={1}
        />
      )}

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />

      <UpdatesReportFAB disabled={sidebarVisible} />
    </View>
  );
}

function StallRow({
  stall,
  tenantMap,
}: {
  stall: StallDoc;
  tenantMap: Map<string, TenantInfo>;
}) {
  const tenant = stall.tenantId ? tenantMap.get(stall.tenantId) : undefined;
  const tenantName = tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "";

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowBuilding}>Building: {stall.buildingNumber}</Text>
        <Text style={styles.rowSpace}>Space: {stall.spaceId}</Text>
        {tenantName && (
          <Text style={styles.rowTenantName}>Name: {tenantName}</Text>
        )}
      </View>

      <View style={styles.rowDividerVertical} />

      <View style={styles.stallBtns}>
        {/* UNOCCUPIED */}
        {stall.status === "unoccupied" && (
          <Pressable
            style={({ pressed }) => [
              styles.btnRegister,
              pressed && styles.btnRegisterPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: "/account",
                params: {
                  mode: "create",
                  stallId: stall.id,
                },
              } as any)
            }
          >
            <Text style={styles.btnText}>Register</Text>
          </Pressable>
        )}

        {/* OCCUPIED */}
        {stall.status === "occupied" && (
          <>
            {/* MANAGE ACCOUNT */}
            <Pressable
              style={({ pressed }) => [
                styles.btnManage,
                pressed && styles.btnManagePressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: "/account",
                  params: {
                    mode: "manage",
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.btnText}>Manage</Text>
            </Pressable>

            {/* EDIT RENTAL INFO */}
            <Pressable
              style={({ pressed }) => [
                styles.btnEditRental,
                pressed && styles.btnEditRentalPressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: "/edit-rental-info",
                  params: {
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.btnText}>Edit Rental</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F0F4FA",
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  header: {
    backgroundColor: "#0C2D6B",
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
    flex: 1,
    textAlign: "center",
  },

  // ── Banner ────────────────────────────────────────────────────────────────────

  banner: {
    backgroundColor: "#1A4DA0",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  bannerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── Top row (building dropdown + filter tabs) ─────────────────────────────────

  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 16,
  },

  // ── Building dropdown ─────────────────────────────────────────────────────────

  dropdownWrapper: {
    position: "relative",
    width: 110,
  },

  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  dropdownTriggerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: "#0C2D6B",
  },

  dropdown: {
    position: "absolute",
    top: 42,
    left: 0,
    minWidth: 150,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#B5D4F4",
    borderRadius: 10,
    zIndex: 200,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },

  // Clips item highlights (dropdownItemActive) to the panel's rounded
  // corners. Kept separate from `dropdown` so the outer view's shadow isn't
  // clipped along with it (overflow: hidden hides iOS shadows on the same view).
  dropdownInner: {
    borderRadius: 10,
    overflow: "hidden",
  },

  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },

  dropdownItemActive: {
    backgroundColor: "#E6F1FB",
  },

  dropdownItemText: {
    fontSize: 14,
    color: "#444441",
  },

  dropdownItemTextActive: {
    fontWeight: "600",
    color: "#0C2D6B",
  },

  // ── Status filter dropdown ─────────────────────────────────────────────────────

  filterDropdownWrapper: {
    position: "relative",
    width: 120,
  },

  // ── Stall list card ──────────────────────────────────────────────────────────

  listCard: {
    maxHeight: 650,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: "#B5D4F4",
    overflow: "hidden",
  },

  listCardCenteredBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },

  // ── Stall row ─────────────────────────────────────────────────────────────────

  row: {
    backgroundColor: "#fff",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderColor: "#E6F1FB",
    flexDirection: "row",
    alignItems: "center",
  },

  rowInfo: {
    flex: 1,
  },

  rowBuilding: {
    fontSize: 14,
    color: "#888780",
  },

  rowSpace: {
    fontSize: 15,
    fontWeight: "500",
    color: "#0C2D6B",
    marginTop: 2,
  },

  rowTenantName: {
    fontSize: 13,
    color: "#444441",
    marginTop: 2,
  },

  rowDividerVertical: {
    width: 1,
    height: "100%",
    backgroundColor: "#E6F1FB",
    marginHorizontal: 14,
  },

  stallBtns: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    width: 110,
  },

  // ── Action buttons ────────────────────────────────────────────────────────────

  btnText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#fff",
    textAlign: "center",
  },

  btnManage: {
    backgroundColor: "#0C2D6B",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  btnManagePressed: {
    backgroundColor: "#091f4a",
    transform: [{ scale: 0.97 }],
  },

  btnEditRental: {
    backgroundColor: "#1A4DA0",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  btnEditRentalPressed: {
    backgroundColor: "#0C2D6B",
    transform: [{ scale: 0.97 }],
  },

  btnRegister: {
    backgroundColor: "#2E6FD9",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
    alignItems: "center",
    transform: [{ scale: 1 }],
  },

  btnRegisterPressed: {
    backgroundColor: "#1A4DA0",
    transform: [{ scale: 0.97 }],
  },

  // ── Empty state ───────────────────────────────────────────────────────────────

  emptyText: {
    fontSize: 15,
    color: "#888780",
    textAlign: "center",
  },
});
