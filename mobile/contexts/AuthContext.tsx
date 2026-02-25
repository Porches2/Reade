import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithCredential,
} from "firebase/auth";
import { Alert, Platform } from "react-native";
import { auth } from "../firebase.config";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => void;
  googleLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Reverse a Google client ID: "XXX.apps.googleusercontent.com" → "com.googleusercontent.apps.XXX"
function reverseClientId(clientId: string): string {
  return clientId.split(".").reverse().join(".");
}

// Reversed iOS client ID scheme - ASWebAuthenticationSession intercepts this
function getRedirectUri(): string {
  const clientId = Platform.OS === "ios" && GOOGLE_IOS_CLIENT_ID
    ? GOOGLE_IOS_CLIENT_ID
    : GOOGLE_WEB_CLIENT_ID;
  return `${reverseClientId(clientId)}:/oauthredirect`;
}

// Generate PKCE code verifier and challenge
async function generatePKCE() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const verifier = Array.from(bytes, (b: number) => b.toString(16).padStart(2, "0")).join("");

  // SHA256 hash the verifier for the challenge
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  // Convert base64 to base64url
  const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return { verifier, challenge };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const handleGoogleSignIn = useCallback(async () => {
    // Use iOS client ID on iOS (supports PKCE without client secret)
    const clientId = Platform.OS === "ios" && GOOGLE_IOS_CLIENT_ID
      ? GOOGLE_IOS_CLIENT_ID
      : GOOGLE_WEB_CLIENT_ID;

    if (!clientId) {
      Alert.alert("Setup Required", "Google client IDs not configured in .env");
      return;
    }

    setGoogleLoading(true);
    try {
      const redirectUri = getRedirectUri();
      const { verifier, challenge } = await generatePKCE();

      // Build Google OAuth URL with PKCE (authorization code flow)
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid profile email",
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      // ASWebAuthenticationSession handles the custom scheme redirect even in Expo Go
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      if (result.type === "success" && result.url) {
        // Parse authorization code from redirect URL
        const url = new URL(result.url);
        const code = url.searchParams.get("code");

        if (!code) {
          Alert.alert("Error", "No authorization code received.");
          return;
        }

        // Exchange code for tokens using PKCE (no client secret needed for iOS/mobile clients)
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }).toString(),
        });

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
          console.error("Token exchange error:", tokenData);
          Alert.alert("Error", tokenData.error_description || "Failed to exchange code.");
          return;
        }

        const { id_token, access_token } = tokenData;
        if (id_token) {
          const credential = GoogleAuthProvider.credential(id_token, access_token);
          await signInWithCredential(auth, credential);
        } else {
          Alert.alert("Error", "No ID token received.");
        }
      }
      // type === "cancel" or "dismiss" - user closed the browser, do nothing
    } catch (err) {
      console.error("Google sign-in error:", err);
      Alert.alert("Error", "Google sign-in failed. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        signUp,
        signInWithGoogle: handleGoogleSignIn,
        googleLoading,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
