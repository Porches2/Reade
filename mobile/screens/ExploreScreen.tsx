import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  ActivityIndicator,
} from "react-native";
import { api } from "../services/api";

interface Book {
  title: string;
  author: string;
  url: string;
  download_url?: string | null;
  description: string;
  category?: string;
  source?: string;
  cover_url?: string | null;
  tags?: string[];
}

export default function ExploreScreen() {
  const [categories, setCategories] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Book[]>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Book[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getExplore()
      .then((data) => {
        setCategories(data.categories || []);
        setCatalog(data.catalog || {});
        if (data.categories?.length > 0) setActiveCategory(data.categories[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const data = await api.searchExplore(searchQuery);
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const displayBooks =
    searchResults !== null
      ? searchResults
      : activeCategory
      ? catalog[activeCategory] || []
      : [];

  const renderBook = ({ item }: { item: Book }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => Linking.openURL(item.url)}
      activeOpacity={0.7}
    >
      <View style={styles.coverContainer}>
        {item.cover_url ? (
          <Image
            source={{ uri: item.cover_url }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Text style={styles.coverPlaceholderText} numberOfLines={2}>{item.title}</Text>
          </View>
        )}
        {item.source && (
          <View
            style={[
              styles.badge,
              item.source === "curated"
                ? styles.badgeCurated
                : item.source === "gutenberg"
                ? styles.badgeGutenberg
                : styles.badgeOL,
            ]}
          >
            <Text style={styles.badgeText}>
              {item.source === "curated"
                ? "Curated"
                : item.source === "gutenberg"
                ? "Gutenberg"
                : "Open Library"}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.bookAuthor} numberOfLines={1}>{item.author}</Text>
      {item.tags && item.tags.length > 0 && (
        <View style={styles.tagRow}>
          {item.tags.slice(0, 2).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          placeholder="Search ebooks..."
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>{searching ? "..." : "Search"}</Text>
        </TouchableOpacity>
        {searchResults !== null && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => {
              setSearchResults(null);
              setSearchQuery("");
            }}
          >
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category tabs */}
      {searchResults === null && (
        <View style={styles.categoryWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryContent}
          >
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryPill,
                  activeCategory === cat && styles.categoryPillActive,
                ]}
                onPress={() => setActiveCategory(cat)}
              >
                <Text
                  style={[
                    styles.categoryText,
                    activeCategory === cat && styles.categoryTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Book grid */}
      <FlatList
        data={displayBooks}
        keyExtractor={(item, i) => `${item.title}-${i}`}
        renderItem={renderBook}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching ? "Searching..." : "No books found"}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchRow: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  searchBtn: {
    backgroundColor: "#4F46E5",
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  clearBtn: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  clearBtnText: { color: "#6B7280", fontSize: 13 },
  categoryWrapper: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    minHeight: 52,
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: "center",
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  categoryPillActive: { backgroundColor: "#4F46E5", borderColor: "#4F46E5" },
  categoryText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  categoryTextActive: { color: "#fff" },
  list: { padding: 12, paddingBottom: 40 },
  gridRow: { justifyContent: "space-between" },
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },
  coverContainer: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: "#F3F4F6",
    position: "relative",
  },
  coverImage: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EEF2FF",
    padding: 12,
  },
  coverPlaceholderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#818CF8",
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeCurated: { backgroundColor: "rgba(238,242,255,0.95)" },
  badgeGutenberg: { backgroundColor: "rgba(254,243,199,0.95)" },
  badgeOL: { backgroundColor: "rgba(236,253,245,0.95)" },
  badgeText: { fontSize: 10, fontWeight: "600", color: "#374151" },
  bookTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  bookAuthor: {
    fontSize: 12,
    color: "#6B7280",
    paddingHorizontal: 10,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
    flexWrap: "wrap",
  },
  tag: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagText: { fontSize: 10, color: "#6B7280" },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 14 },
});
