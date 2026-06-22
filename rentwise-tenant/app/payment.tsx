import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  ActivityIndicator,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";

import { auth } from "../shared/firebaseConfig";

import { createPayment } from "../services/paymentService";

import * as ImagePicker from "expo-image-picker";

import { router } from "expo-router";

import { CLOUDINARY_NAME, CLOUDINARY_PRESET } from "../shared/cloudinary";

export default function Payment() {
  const insets = useSafeAreaInsets();

  const [method, setMethod] = useState("");

  const [amount, setAmount] = useState("");

  const [receiptUrl, setReceiptUrl] = useState("");

  const [receiptName, setReceiptName] = useState("");

  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  async function uploadReceipt() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"] as any,
        quality: 0.8,
        base64: true,
      });

      if (result.canceled) return;

      const image = result.assets[0];

      if (!image.base64) {
        Alert.alert("Error", "Could not read image");
        return;
      }

      setUploading(true);

      const formData = new FormData();
      formData.append("file", `data:image/jpeg;base64,${image.base64}`);
      formData.append("upload_preset", CLOUDINARY_PRESET);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/image/upload`,
        { method: "POST", body: formData },
      );

      const data = await response.json();

      if (!data.secure_url) {
        throw new Error("Upload failed");
      }

      setReceiptUrl(data.secure_url);
      setReceiptName(image.fileName || "receipt.jpg");
      Alert.alert("Success", "Receipt uploaded");
    } catch (error) {
      console.log("UPLOAD ERROR:", error);

      Alert.alert("Error", "Receipt upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submitPayment() {
    try {
      const user = auth.currentUser;

      if (!user) {
        Alert.alert("Error", "User not logged in");

        return;
      }

      if (!amount) {
        Alert.alert("Missing Amount", "Please enter payment amount");

        return;
      }

      if (Number(amount) <= 0) {
        Alert.alert("Invalid Amount", "Enter a valid amount");

        return;
      }

      if (!method) {
        Alert.alert("Payment Method", "Please select payment method");

        return;
      }

      if (!receiptUrl) {
        Alert.alert(
          "Receipt Required",

          "Please upload receipt first",
        );

        return;
      }

      setSubmitting(true);

      await createPayment({
        userId: user.uid,

        amount: Number(amount),

        rentAmount: Number(amount),

        method,

        status: "pending",

        receipt: receiptUrl,

        paymentId: null,

        createdAt: new Date(),
      });

      Alert.alert(
        "Success",

        "Payment submitted for approval",
      );

      setAmount("");

      setMethod("");

      setReceiptUrl("");

      setReceiptName("");

      router.back();
    } catch (error) {
      console.log(error);

      Alert.alert(
        "Error",

        "Unable to submit payment",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View
      style={[
        styles.container,

        {
          paddingTop: insets.top,

          paddingBottom: insets.bottom,
        },
      ]}
    >
      <Text style={styles.title}>Payment</Text>

      <Text style={styles.label}>Amount</Text>

      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="Enter amount"
      />

      <Text style={styles.label}>Select Payment Method</Text>

      <TouchableOpacity
        style={[styles.option, method === "cash" && styles.selected]}
        onPress={() => setMethod("cash")}
      >
        <Text>💵 Cash Payment</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.option, method === "online" && styles.selected]}
        onPress={() => setMethod("online")}
      >
        <Text>💳 Online Payment</Text>
      </TouchableOpacity>

      <Text style={styles.selectedText}>
        Selected:
        {method || "None"}
      </Text>

      <TouchableOpacity style={styles.option} onPress={uploadReceipt}>
        <Text>{uploading ? "Uploading..." : "📄 Upload Receipt"}</Text>
      </TouchableOpacity>

      <Text>{receiptName || "No receipt uploaded"}</Text>

      <TouchableOpacity
        style={styles.submitButton}
        onPress={submitPayment}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>
          {submitting ? "Submitting..." : "Submit Payment"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => router.back()}
      >
        <Text style={styles.buttonText}>Cancel</Text>
      </TouchableOpacity>
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
    fontSize: 30,

    fontWeight: "bold",

    marginBottom: 30,
  },

  label: {
    fontSize: 16,

    fontWeight: "600",

    marginBottom: 10,
  },

  input: {
    borderWidth: 1,

    borderRadius: 10,

    padding: 15,

    marginBottom: 20,
  },

  option: {
    padding: 20,

    borderWidth: 1,

    borderRadius: 10,

    marginBottom: 15,
  },

  selected: {
    borderWidth: 2,
  },

  selectedText: {
    marginVertical: 20,

    fontWeight: "bold",
  },

  submitButton: {
    padding: 15,

    borderWidth: 1,

    borderRadius: 10,

    alignItems: "center",

    marginTop: 20,
  },

  cancelButton: {
    padding: 15,

    borderWidth: 1,

    borderRadius: 10,

    alignItems: "center",

    marginTop: 15,
  },

  buttonText: {
    fontWeight: "bold",
  },
});
