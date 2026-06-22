import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

import { useEffect, useState } from "react";

import { getStalls } from "../services/stallService";

export default function StallDetails() {
  const [vacantStalls, setVacantStalls] = useState<any[]>([]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    loadVacant();
  }, []);

  async function loadVacant() {
    const data = await getStalls();

    const result = data.filter((stall: any) => stall.status === "vacant");

    setVacantStalls(result);
  }

  if (vacantStalls.length === 0) {
    return (
      <View style={styles.center}>
        <Text>No vacant stalls available</Text>
      </View>
    );
  }

  const stall = vacantStalls[index];

  return (
    <View style={styles.overlay}>
      <View style={styles.popup}>
        <Text style={styles.title}>Vacant Stall</Text>

        <Text style={styles.name}>{stall.name}</Text>

        <Text>Price: ₱{stall.price}</Text>

        <Text>Status: {stall.status}</Text>

        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              setIndex(index === 0 ? vacantStalls.length - 1 : index - 1)
            }
          >
            <Text>◀</Text>
          </TouchableOpacity>

          <Text>
            {index + 1} / {vacantStalls.length}
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => setIndex((index + 1) % vacantStalls.length)}
          >
            <Text>▶</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,

    backgroundColor: "rgba(0,0,0,0.4)",

    justifyContent: "center",

    alignItems: "center",
  },

  popup: {
    width: "85%",

    padding: 25,

    backgroundColor: "#fff",

    borderRadius: 15,

    borderWidth: 1,
  },

  title: {
    fontSize: 25,

    fontWeight: "bold",
  },

  name: {
    fontSize: 22,

    marginTop: 20,

    fontWeight: "bold",
  },

  controls: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",

    marginTop: 30,
  },

  button: {
    padding: 15,

    borderWidth: 1,

    borderRadius: 10,
  },

  center: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",
  },
});
