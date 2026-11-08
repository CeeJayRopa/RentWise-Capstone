import AsyncStorage from "@react-native-async-storage/async-storage";

const CHECKOUT_SESSION_KEY = "tenant:pendingCheckoutSessionId";
const PAYMENT_METHOD_KEY = "tenant:pendingPaymentMethod";

export async function setPendingCheckoutSession(id: string): Promise<void> {
  await AsyncStorage.setItem(CHECKOUT_SESSION_KEY, id);
}

export async function getPendingCheckoutSession(): Promise<string | null> {
  return AsyncStorage.getItem(CHECKOUT_SESSION_KEY);
}

export async function clearPendingCheckoutSession(): Promise<void> {
  await AsyncStorage.removeItem(CHECKOUT_SESSION_KEY);
}

// Remembers the PayMongo method selected before handing off to checkout so
// the payment record created afterward can show the actual method.
export async function setPendingPaymentMethod(method: string): Promise<void> {
  await AsyncStorage.setItem(PAYMENT_METHOD_KEY, method);
}

export async function getPendingPaymentMethod(): Promise<string | null> {
  return AsyncStorage.getItem(PAYMENT_METHOD_KEY);
}

export async function clearPendingPaymentMethod(): Promise<void> {
  await AsyncStorage.removeItem(PAYMENT_METHOD_KEY);
}
