import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCoMlzPFlTMx7xpdx2GZGk-fsmPQEQbKUQ",
  authDomain: "reade-71704.firebaseapp.com",
  projectId: "reade-71704",
  storageBucket: "reade-71704.firebasestorage.app",
  messagingSenderId: "557293025540",
  appId: "1:557293025540:web:f9e1122586a09e0d987851",
};

const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Use AsyncStorage for auth persistence in React Native
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

export { auth };
export default app;
