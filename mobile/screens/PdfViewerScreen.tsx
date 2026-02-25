import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import { WebView } from "react-native-webview";
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from "expo-audio";
import * as Haptics from "expo-haptics";
import { api } from "../services/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";

type Props = NativeStackScreenProps<RootStackParamList, "PdfViewer">;

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

const SCREEN_HEIGHT = Dimensions.get("window").height;
const PAGES_OPTIONS = [3, 5, 10, 20];

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// Binary search for current word index
function findWordIndex(timings: WordTiming[], posMs: number): number {
  if (!timings.length) return -1;
  let lo = 0;
  let hi = timings.length - 1;
  // If before first word
  if (posMs < timings[0].start) return -1;
  // If after last word
  if (posMs >= timings[hi].start) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (posMs >= timings[mid].start && posMs < timings[mid].end) return mid;
    if (posMs < timings[mid].start) hi = mid - 1;
    else lo = mid + 1;
  }
  // Fallback: closest word that started before position
  return Math.max(0, lo - 1);
}

export default function PdfViewerScreen({ route }: Props) {
  const { pdfId, filename, totalPages } = route.params;

  // PDF
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // TTS
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [startPage, setStartPage] = useState(1);
  const [numPages, setNumPages] = useState(5);
  const [pagesRead, setPagesRead] = useState<number[]>([]);

  // Word highlighting
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const currentWordRef = useRef(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [showReader, setShowReader] = useState(false);

  // Audio
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const player = useAudioPlayer(audioUri);
  const playerStatus = useAudioPlayerStatus(player);
  const [audioLoaded, setAudioLoaded] = useState(false);

  const isPlaying = playerStatus.playing;
  const duration = (playerStatus.duration || 0) * 1000; // convert to ms
  const position = (playerStatus.currentTime || 0) * 1000; // convert to ms

  // Auto-scroll
  const scrollViewRef = useRef<ScrollView>(null);
  const wordYPositions = useRef<Float64Array | null>(null);
  const lastScrollY = useRef(0);

  // Progress animation
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Load PDF URL
  useEffect(() => {
    api.getPdfFileUrl(pdfId).then(setPdfUrl).catch(() => {});
  }, [pdfId]);

  // Cleanup
  useEffect(() => {
    return () => { player.remove(); };
  }, [player]);

  // Generation progress animation
  useEffect(() => {
    if (generating) {
      setGenProgress(0);
      progressAnim.setValue(0);
      Animated.sequence([
        Animated.timing(progressAnim, {
          toValue: 0.6, duration: 2000,
          easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }),
        Animated.timing(progressAnim, {
          toValue: 0.92, duration: 10000,
          easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }),
      ]).start();
      const id = progressAnim.addListener(({ value }) => setGenProgress(Math.round(value * 100)));
      return () => progressAnim.removeListener(id);
    }
    progressAnim.setValue(0);
  }, [generating]);

  // Word tracking from audio position
  const wordTimingsRef = useRef<WordTiming[]>([]);
  useEffect(() => { wordTimingsRef.current = wordTimings; }, [wordTimings]);

  // Track word highlighting based on player position
  useEffect(() => {
    const timings = wordTimingsRef.current;
    if (!timings.length) return;
    const pos = position;
    const idx = findWordIndex(timings, pos);
    if (idx !== currentWordRef.current) {
      currentWordRef.current = idx;
      setCurrentWordIndex(idx);
    }
  }, [position]);

  // Auto-play when audio loads
  useEffect(() => {
    if (audioUri && playerStatus.duration && playerStatus.duration > 0 && !playerStatus.playing) {
      player.play();
    }
  }, [audioUri, playerStatus.duration]);

  // Handle playback finished
  useEffect(() => {
    if (playerStatus.didJustFinish) {
      currentWordRef.current = -1;
      setCurrentWordIndex(-1);
    }
  }, [playerStatus.didJustFinish]);

  // Auto-scroll when word changes
  useEffect(() => {
    if (currentWordIndex < 0 || !showReader) return;
    const positions = wordYPositions.current;
    if (!positions || currentWordIndex >= positions.length) return;
    const targetY = positions[currentWordIndex];
    if (targetY === 0 && currentWordIndex > 5) return; // not measured yet
    // Center the word on screen
    const scrollTarget = Math.max(0, targetY - SCREEN_HEIGHT * 0.35);
    // Only scroll if moved significantly (avoid jitter)
    if (Math.abs(scrollTarget - lastScrollY.current) > 20) {
      lastScrollY.current = scrollTarget;
      scrollViewRef.current?.scrollTo({ y: scrollTarget, animated: true });
    }
  }, [currentWordIndex, showReader]);

  const loadAndPlayAudio = useCallback(async (url: string) => {
    try {
      await AudioModule.setAudioModeAsync({ playsInSilentModeIOS: true });
      setAudioUri(url);
      setAudioLoaded(true);
      setShowReader(true);
    } catch (err) {
      console.error("Audio load error:", err);
      Alert.alert("Error", "Failed to play audio");
    }
  }, []);

  const handleRead = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(true);
    setShowReader(false);
    currentWordRef.current = -1;
    setCurrentWordIndex(-1);
    wordYPositions.current = null;
    lastScrollY.current = 0;

    try {
      const data = await api.tts({
        pdf_id: pdfId,
        start_page: startPage,
        num_pages: numPages,
        voice: "en-US-AriaNeural",
        rate: "+0%",
      });

      progressAnim.setValue(1);
      setGenProgress(100);

      const audioUrl = api.getAudioUrl(data.audio_url.replace("/audio/", ""));
      setPagesRead(data.pages_read || []);

      const timings: WordTiming[] = data.word_timings || [];
      setWordTimings(timings);
      wordTimingsRef.current = timings;
      // Pre-allocate position array
      wordYPositions.current = new Float64Array(timings.length);

      if (data.next_page) setStartPage(data.next_page);

      setTimeout(() => {
        setGenerating(false);
        loadAndPlayAudio(audioUrl);
      }, 200);
    } catch (err: unknown) {
      setGenerating(false);
      Alert.alert("TTS Failed", err instanceof Error ? err.message : "Please try again");
    }
  };

  const togglePlayPause = async () => {
    if (!audioLoaded) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) player.pause();
    else player.play();
  };

  const seekTo = async (ratio: number) => {
    if (!audioLoaded || !duration) return;
    player.seekTo(ratio * duration / 1000); // seekTo takes seconds
  };

  const closeAudio = useCallback(async () => {
    player.pause();
    setAudioUri(null);
    setAudioLoaded(false);
    setPagesRead([]);
    setWordTimings([]);
    wordTimingsRef.current = [];
    currentWordRef.current = -1;
    setCurrentWordIndex(-1);
    setShowReader(false);
    wordYPositions.current = null;
    lastScrollY.current = 0;
  }, [player]);

  const progressRatio = duration > 0 ? position / duration : 0;

  return (
    <View style={styles.container}>
      {/* Main content */}
      {showReader && wordTimings.length > 0 ? (
        <View style={styles.readerContainer}>
          <View style={styles.readerHeader}>
            <Text style={styles.readerPages}>Pages {pagesRead.join(", ")}</Text>
            <TouchableOpacity style={styles.switchBtn} onPress={() => setShowReader(false)}>
              <Text style={styles.switchBtnText}>View PDF</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            ref={scrollViewRef}
            style={styles.readerScroll}
            contentContainerStyle={styles.readerContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.wordWrap}>
              {wordTimings.map((wt, i) => (
                <Text
                  key={i}
                  onLayout={(e) => {
                    if (wordYPositions.current && i < wordYPositions.current.length) {
                      wordYPositions.current[i] = e.nativeEvent.layout.y;
                    }
                  }}
                  style={[
                    styles.word,
                    i === currentWordIndex && styles.wordActive,
                    i < currentWordIndex && i >= currentWordIndex - 3 && styles.wordRecent,
                    i < currentWordIndex - 3 && styles.wordPast,
                  ]}
                >
                  {wt.word}{" "}
                </Text>
              ))}
            </View>
            {/* Extra space at bottom so last words can scroll to center */}
            <View style={{ height: SCREEN_HEIGHT * 0.4 }} />
          </ScrollView>
        </View>
      ) : (
        <>
          {pdfUrl ? (
            <WebView
              source={{ uri: pdfUrl }}
              style={styles.webview}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#4F46E5" />
                </View>
              )}
            />
          ) : (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#4F46E5" />
            </View>
          )}
          {audioLoaded && (
            <TouchableOpacity style={styles.floatingReaderBtn} onPress={() => setShowReader(true)}>
              <Text style={styles.floatingReaderBtnText}>Show Reader</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        {/* Generation progress */}
        {generating && (
          <View style={styles.genContainer}>
            <View style={styles.genRow}>
              <ActivityIndicator size="small" color="#D97706" />
              <Text style={styles.genText}>Generating audio... {genProgress}%</Text>
            </View>
            <View style={styles.genBarBg}>
              <Animated.View
                style={[styles.genBarFill, {
                  width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                }]}
              />
            </View>
          </View>
        )}

        {/* Audio player */}
        {audioLoaded && !generating && (
          <View style={styles.playerContainer}>
            <TouchableOpacity
              style={styles.timeline}
              activeOpacity={0.8}
              onPress={(e) => seekTo(Math.max(0, Math.min(1, e.nativeEvent.locationX / (Dimensions.get("window").width - 32))))}
            >
              <View style={styles.timelineBg}>
                <View style={[styles.timelineFill, { width: `${progressRatio * 100}%` }]} />
                <View style={[styles.timelineThumb, { left: `${progressRatio * 100}%` }]} />
              </View>
            </TouchableOpacity>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
            <View style={styles.controlsRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { closeAudio().then(handleRead); }}>
                <Text style={styles.secondaryBtnText}>Next</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.playBtn} onPress={togglePlayPause}>
                {isPlaying ? (
                  <View style={styles.pauseIcon}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
                ) : (
                  <View style={styles.playIcon} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={closeAudio}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Read controls */}
        {!generating && !audioLoaded && (
          <View>
            {/* Page range selector */}
            <View style={styles.readRow}>
              <View style={styles.pageControl}>
                <TouchableOpacity style={styles.pageBtn} onPress={() => setStartPage(Math.max(1, startPage - 1))}>
                  <Text style={styles.pageBtnText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.pageLabel}>Page {startPage}</Text>
                <TouchableOpacity style={styles.pageBtn} onPress={() => setStartPage(Math.min(totalPages, startPage + 1))}>
                  <Text style={styles.pageBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.readBtn} onPress={handleRead}>
                <Text style={styles.readBtnIcon}>&#9654;</Text>
                <Text style={styles.readBtnText}>Read Aloud</Text>
              </TouchableOpacity>
            </View>
            {/* Pages count chips */}
            <View style={styles.chipRow}>
              {PAGES_OPTIONS.map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.chip, numPages === n && styles.chipActive]}
                  onPress={() => setNumPages(n)}
                >
                  <Text style={[styles.chipText, numPages === n && styles.chipTextActive]}>
                    {n} pages
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  webview: { flex: 1 },
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center", alignItems: "center", backgroundColor: "#fff",
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  // Reader
  readerContainer: { flex: 1, backgroundColor: "#FFFBEB" },
  readerHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#FDE68A", backgroundColor: "#FEF3C7",
  },
  readerPages: { fontSize: 13, fontWeight: "600", color: "#92400E" },
  switchBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#FDE68A",
  },
  switchBtnText: { fontSize: 12, fontWeight: "600", color: "#92400E" },
  readerScroll: { flex: 1 },
  readerContent: { padding: 24, paddingTop: 20 },
  wordWrap: { flexDirection: "row", flexWrap: "wrap" },

  // Words
  word: { fontSize: 21, lineHeight: 38, color: "#A8A29E", fontWeight: "400" },
  wordActive: {
    color: "#1C1917", fontWeight: "700",
    backgroundColor: "#FDE68A", borderRadius: 3, overflow: "hidden",
  },
  wordRecent: { color: "#57534E", fontWeight: "400" },
  wordPast: { color: "#78716C" },

  // Floating button
  floatingReaderBtn: {
    position: "absolute", top: 12, right: 12,
    backgroundColor: "#D97706", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  floatingReaderBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // Bottom bar
  bottomBar: {
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB",
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 28,
  },

  // Generation
  genContainer: { marginBottom: 4 },
  genRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  genText: { fontSize: 13, color: "#92400E", fontWeight: "600" },
  genBarBg: { height: 6, backgroundColor: "#FEF3C7", borderRadius: 3, overflow: "hidden" },
  genBarFill: { height: 6, backgroundColor: "#D97706", borderRadius: 3 },

  // Player
  playerContainer: {},
  timeline: { paddingVertical: 6 },
  timelineBg: { height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, position: "relative" },
  timelineFill: { height: 4, backgroundColor: "#4F46E5", borderRadius: 2 },
  timelineThumb: {
    position: "absolute", top: -5, width: 14, height: 14, borderRadius: 7,
    backgroundColor: "#4F46E5", marginLeft: -7,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 2, elevation: 3,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, marginBottom: 8 },
  timeText: { fontSize: 11, color: "#9CA3AF", fontWeight: "500" },
  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  playBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#4F46E5", justifyContent: "center", alignItems: "center",
  },
  playIcon: {
    width: 0, height: 0,
    borderLeftWidth: 16, borderTopWidth: 10, borderBottomWidth: 10,
    borderLeftColor: "#fff", borderTopColor: "transparent", borderBottomColor: "transparent",
    marginLeft: 4,
  },
  pauseIcon: { flexDirection: "row", gap: 5 },
  pauseBar: { width: 5, height: 18, backgroundColor: "#fff", borderRadius: 1 },
  secondaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: "#FEF3C7" },
  secondaryBtnText: { fontSize: 13, color: "#92400E", fontWeight: "700" },
  closeBtnText: { fontSize: 13, color: "#6B7280", fontWeight: "600" },

  // Read controls
  readRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pageControl: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F9FAFB", borderRadius: 10,
    paddingHorizontal: 4, paddingVertical: 4, borderWidth: 1, borderColor: "#E5E7EB",
  },
  pageBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "#fff", justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  pageBtnText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  pageLabel: { fontSize: 13, fontWeight: "600", color: "#374151", minWidth: 55, textAlign: "center" },
  readBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#D97706", borderRadius: 12, paddingVertical: 14,
  },
  readBtnIcon: { fontSize: 14, color: "#fff" },
  readBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },

  // Page count chips
  chipRow: { flexDirection: "row", gap: 8, marginTop: 10, justifyContent: "center" },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: "#E5E7EB",
  },
  chipActive: { backgroundColor: "#D97706", borderColor: "#D97706" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  chipTextActive: { color: "#fff" },
});
