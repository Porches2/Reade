import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Library">;

interface PdfItem {
  pdf_id: string;
  filename: string;
  total_pages: number;
  thumbnail_url: string | null;
}

export default function LibraryScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  const loadLibrary = useCallback(async () => {
    try {
      const data = await api.getLibrary();
      setPdfs(data.pdfs || []);
    } catch (e) {
      if (!refreshing) Alert.alert("Error", "Failed to load library. Check your connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshing]);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary])
  );

  useEffect(() => {
    pdfs.forEach(async (pdf) => {
      if (!thumbUrls[pdf.pdf_id]) {
        try {
          const url = await api.getThumbnailUrl(pdf.pdf_id);
          setThumbUrls((prev) => ({ ...prev, [pdf.pdf_id]: url }));
        } catch {}
      }
    });
  }, [pdfs]);

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setUploading(true);
      const data = await api.uploadPdf(file.uri, file.name);
      setPdfs((prev) => [
        ...prev,
        {
          pdf_id: data.pdf_id,
          filename: data.filename,
          total_pages: data.total_pages,
          thumbnail_url: data.thumbnail_url,
        },
      ]);
    } catch (err: unknown) {
      Alert.alert("Upload Failed", err instanceof Error ? err.message : "Please try again");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (pdfId: string, filename: string) => {
    Alert.alert("Delete PDF", `Delete "${filename}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deletePdf(pdfId);
            setPdfs((prev) => prev.filter((p) => p.pdf_id !== pdfId));
          } catch {
            Alert.alert("Error", "Failed to delete PDF");
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: PdfItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate("PdfViewer", {
          pdfId: item.pdf_id,
          filename: item.filename,
          totalPages: item.total_pages,
        })
      }
      onLongPress={() => handleDelete(item.pdf_id, item.filename)}
    >
      {thumbUrls[item.pdf_id] ? (
        <Image
          source={{ uri: thumbUrls[item.pdf_id] }}
          style={styles.cardThumb}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.cardIcon}>
          <Text style={styles.cardIconText}>PDF</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.filename}
        </Text>
        <Text style={styles.cardSubtitle}>{item.total_pages} pages</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={styles.headerTitle}>Readit</Text>
          <Text style={styles.headerEmail} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.exploreButton}
            onPress={() => navigation.navigate("Explore")}
          >
            <Text style={styles.exploreButtonText}>Explore</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      ) : (
        <FlatList
          data={pdfs}
          keyExtractor={(item) => item.pdf_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLibrary(); }} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No PDFs yet</Text>
              <Text style={styles.emptySubtext}>Upload a PDF to get started</Text>
            </View>
          }
          ListFooterComponent={
            <Text style={styles.hint}>Long press a PDF to delete it</Text>
          }
        />
      )}

      {/* Upload FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 16 }, uploading && styles.fabDisabled]}
        onPress={handleUpload}
        disabled={uploading}
        activeOpacity={0.8}
      >
        {uploading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.fabText}>+ Upload</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  headerEmail: { fontSize: 12, color: "#6B7280", marginTop: 2, maxWidth: 180 },
  headerActions: { flexDirection: "row", gap: 8 },
  exploreButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
  },
  exploreButtonText: { fontSize: 13, color: "#4F46E5", fontWeight: "600" },
  logoutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
  },
  logoutText: { fontSize: 13, color: "#6B7280" },
  list: { padding: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardThumb: {
    width: 52,
    height: 68,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    marginRight: 14,
  },
  cardIcon: {
    width: 52,
    height: 68,
    borderRadius: 8,
    backgroundColor: "#EEF2FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  cardIconText: { fontSize: 12, fontWeight: "700", color: "#4F46E5" },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  cardSubtitle: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#9CA3AF" },
  emptySubtext: { fontSize: 13, color: "#D1D5DB", marginTop: 4 },
  hint: { textAlign: "center", fontSize: 11, color: "#D1D5DB", marginTop: 8, marginBottom: 80 },
  fab: {
    position: "absolute",
    right: 20,
    backgroundColor: "#4F46E5",
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  fabDisabled: { opacity: 0.5 },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
