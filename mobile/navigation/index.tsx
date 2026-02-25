import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import LibraryScreen from "../screens/LibraryScreen";
import PdfViewerScreen from "../screens/PdfViewerScreen";
import ExploreScreen from "../screens/ExploreScreen";

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Library: undefined;
  PdfViewer: { pdfId: string; filename: string; totalPages: number };
  Explore: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen
              name="PdfViewer"
              component={PdfViewerScreen}
              options={{ headerShown: true, headerBackTitle: "Library", title: "PDF" }}
            />
            <Stack.Screen
              name="Explore"
              component={ExploreScreen}
              options={{ headerShown: true, headerBackTitle: "Library", title: "Explore" }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
