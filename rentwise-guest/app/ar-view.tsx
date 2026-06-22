import { View, Text, StyleSheet } from "react-native";

import * as Device from "expo-device";

import { useEffect, useState } from "react";

export default function ARView() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    checkAR();
  }, []);

  function checkAR() {
    const isMobile = Device.osName === "Android" || Device.osName === "iOS";

    const market = "ka-domeng";

    if (isMobile && market === "ka-domeng") {
      setAvailable(true);
    }
  }

  return (
    <View style={styles.container}>
      {available ? (
        <>
          <Text style={styles.title}>Ka Domeng AR View</Text>

          <Text>AR Camera Preview</Text>

          <Text>3D Stall Model will appear here</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>AR Unavailable</Text>

          <Text>AR viewing is only available on mobile devices.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",

    padding: 20,
  },

  title: {
    fontSize: 28,

    fontWeight: "bold",

    marginBottom: 20,
  },
});
