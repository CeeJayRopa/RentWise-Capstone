import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, } from "react-native";
import { useEffect, useState } from "react";
import { getStalls } from "../services/stallService";
import { router } from "expo-router";

export default function Index() {
  const [stalls, setStalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStalls();
  }, []);

  async function loadStalls() {
    try {
      const data = await getStalls();

      setStalls(data);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>RentWise</Text>

      <Text style={styles.market}>Ka Domeng Talipapa</Text>

      <TouchableOpacity
        style={styles.mapButton}
        onPress={() => router.push("/market-map")}
      >
        <Text style={styles.mapButtonText}>View 2D Market View</Text>
      </TouchableOpacity>

      <Text style={styles.subtitle}>Available Market Spaces</Text>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        stalls.map((stall) => (
          <TouchableOpacity
            key={stall.id}
            style={styles.card}
            onPress={() =>
              router.push({
                pathname: "/stall-details",

                params: {
                  id: stall.id,
                  name: stall.name,
                  price: String(stall.price),
                  status: stall.status,
                },
              })
            }
          >
            <Text style={styles.stallName}>{stall.name}</Text>
            <Text>Price: ₱{stall.price}</Text>
            <Text>Status: {stall.status}</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff",
  },

  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginTop: 40,
  },

  market: {
    fontSize: 18,
    marginTop: 5,
  },

  mapButton: {
    marginTop: 20,
    padding: 15,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
  },

  mapButtonText: {
    fontSize: 16,
    fontWeight: "bold",
  },

  subtitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 30,
  },

  card: {
    marginTop: 15,
    padding: 20,
    borderWidth: 1,
    borderRadius: 12,
  },

  stallName: {
    fontSize: 20,
    fontWeight: "bold",
  },
});
