import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { getProducts, openDB } from "../../helpers/database";
import { performFullSync } from "../../helpers/syncService";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

export default function MonitoringScreen() {
  const [dataProducts, setDataProducts] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [activeTab, setActiveTab] = useState("kadaluarsa");
  const [totalItems, setTotalItems] = useState(0);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle, syncing, success, error

  // Auto load saat fokus ke tab ini
  useFocusEffect(
    useCallback(() => {
      loadAll("kadaluarsa");
      setActiveTab("kadaluarsa");
      setSearch("");
    }, [])
  );

  const loadAll = async (tab) => {
    let database = null;
    try {
      setLoading(true);

      database = await openDB();

      if (!database) {
        setLoading(false);
        setDbReady(false);
        setDataProducts([]);
        setFilterData([]);
        return;
      }

      setDbReady(true);

      // Ambil produk dari tabel products yang belum di-delete
      const allProducts = await getProducts(database);

      let result = [];
      if (tab === "kadaluarsa") {
        // has_kadaluarsa = 1 and date <= 60 days from now
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        result = allProducts.filter((p) => {
          if (p.has_kadaluarsa !== 1 || !p.tanggal_kadaluarsa) return false;

          const date = new Date(p.tanggal_kadaluarsa);
          if (isNaN(date.getTime())) return false; // Invalid date
          date.setHours(0, 0, 0, 0);

          const diffTime = date - now;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // Only show expired or expiring within 60 days
          return diffDays <= 60;
        });

        // sort by tanggal_kadaluarsa ASC (yang paling mendekati)
        result.sort((a, b) => {
          return new Date(a.tanggal_kadaluarsa) - new Date(b.tanggal_kadaluarsa);
        });
      } else {
        // stok < 3
        result = allProducts.filter((p) => parseFloat(p.stok) < 3);
        // sort by stok ASC
        result.sort((a, b) => parseFloat(a.stok) - parseFloat(b.stok));
      }

      console.log(`Monitoring [${tab}]: ${result.length} data ditemukan`);

      setDataProducts(result);
      setFilterData(result);
      setTotalItems(result.length);

      setLoading(false);
    } catch (error) {
      console.log("Error monitoring:", error);
      setLoading(false);
      setDataProducts([]);
      setFilterData([]);
    } finally {
      if (database) {
        try { await database.closeAsync(); } catch (e) { }
      }
    }
  };

  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSearch("");
    // loadAll dipicu oleh useEffect jika re-focus, atau dipanggil manual jika masih di tab:
    // Panggil manual di sini juga agar langsung terupdate
    loadAll(tab);
  };

  const applySearch = (data, text) => {
    if (text) {
      const textData = text.toUpperCase();
      const newData = data.filter((item) => {
        const nama = item.nama ? item.nama.toUpperCase() : "";
        const lokasi = item.lokasi ? item.lokasi.toUpperCase() : "";
        return nama.indexOf(textData) > -1 || lokasi.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(data);
    }
  };

  const searchFilter = (text) => {
    setSearch(text);
    applySearch(dataProducts, text);
  };

  // --- SYNC ---
  const handleSync = async () => {
    if (syncing) return;
    let database = null;
    try {
      setSyncing(true);
      setSyncStatus("syncing");

      database = await openDB();
      if (!database) {
        Alert.alert("Error", "Gagal membuka database");
        setSyncStatus("error");
        return;
      }

      const result = await performFullSync(database);

      if (result.success) {
        setSyncStatus("success");
        loadAll(activeTab);
        Alert.alert("Sukses", "Sinkronisasi berhasil! ✅");
      } else {
        setSyncStatus("error");
        Alert.alert("Gagal", "Sync gagal: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      console.log("Sync error:", err);
      setSyncStatus("error");
      Alert.alert("Error", "Terjadi kesalahan saat sync: " + err.message);
    } finally {
      if (database) {
        try {
          await database.closeAsync();
        } catch (e) { }
      }
      setSyncing(false);
      setTimeout(() => setSyncStatus("idle"), 3000);
    }
  };

  const formatRupiah = (num) => {
    if (!num && num !== 0) return "Rp 0";
    return "Rp " + Number(num).toLocaleString("id-ID");
  };

  const formatTanggal = (tgl) => {
    if (!tgl) return "-";
    try {
      const date = new Date(tgl);
      if (isNaN(date.getTime())) return tgl;
      const options = { day: "numeric", month: "short", year: "numeric" };
      return date.toLocaleDateString("id-ID", options);
    } catch {
      return tgl;
    }
  };

  const getKadaluarsaStatus = (tgl) => {
    if (!tgl) return { text: "Tidak Diketahui", color: "#95a5a6", bgColor: "rgba(149, 165, 166, 0.15)" };

    const date = new Date(tgl);
    const now = new Date();
    date.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    const diffTime = date - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: "Sudah Kadaluarsa", color: "#e74c3c", bgColor: "rgba(231, 76, 60, 0.15)" };
    } else if (diffDays <= 60) {
      return { text: `Hampir Kadaluarsa (${diffDays} hr)`, color: "#f39c12", bgColor: "rgba(243, 156, 18, 0.15)" };
    } else {
      return { text: "Aman", color: "#27ae60", bgColor: "rgba(39, 174, 96, 0.15)" };
    }
  };

  const renderProductItem = ({ item }) => {
    const expiredStatus = activeTab === "kadaluarsa" ? getKadaluarsaStatus(item.tanggal_kadaluarsa) : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.cardInfo}>
            <Text style={styles.namaProduct} numberOfLines={2}>
              {item.nama}
            </Text>
            {item.lokasi ? (
              <Text style={styles.lokasi} numberOfLines={1}>
                📍 Rak/Lokasi: {item.lokasi}
              </Text>
            ) : null}
          </View>
          <View style={styles.cardRight}>
            <Text style={[
              styles.totalAmount,
              activeTab === "stok_menipis" ? { color: "#e67e22" } : {}
            ]}>
              {item.stok} {item.satuan || "pcs"}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    activeTab === "kadaluarsa"
                      ? expiredStatus.bgColor
                      : "rgba(243, 156, 18, 0.15)",
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      activeTab === "kadaluarsa" ? expiredStatus.color : "#f39c12",
                  },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color:
                      activeTab === "kadaluarsa" ? expiredStatus.color : "#f39c12",
                  },
                ]}
              >
                {activeTab === "kadaluarsa" ? expiredStatus.text : "Stok Menipis"}
              </Text>
            </View>
          </View>
        </View>

        {/* Jika kadaluarsa, tampilkan tanggalnya */}
        {activeTab === "kadaluarsa" && item.tanggal_kadaluarsa ? (
          <View style={styles.cardDetail}>
            <Text style={styles.detailPreview} numberOfLines={1}>
              📆 Tanggal Kadaluarsa: {formatTanggal(item.tanggal_kadaluarsa)}
            </Text>
          </View>
        ) : null}

        {/* Batch Number */}
        {item.batch_number ? (
          <View style={[styles.cardDetail, { borderTopWidth: activeTab === "kadaluarsa" && item.tanggal_kadaluarsa ? 0 : 1, marginTop: activeTab === "kadaluarsa" && item.tanggal_kadaluarsa ? 2 : 8, paddingTop: activeTab === "kadaluarsa" && item.tanggal_kadaluarsa ? 0 : 8 }]}>
            <Text style={styles.detailPreview} numberOfLines={1}>
              🏷️ Batch: {item.batch_number}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#2c3e50" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.title}>Monitoring Produk</Text>
        </View>
        <Text
          style={[
            styles.headerSubtitle,
            syncStatus === "syncing" && { color: "#f39c12" },
            syncStatus === "success" && { color: "#27ae60" },
            syncStatus === "error" && { color: "#e74c3c" },
          ]}
        >
          {syncStatus === "syncing"
            ? "⏳ Menyinkronkan..."
            : syncStatus === "success"
              ? "✅ Tersinkronisasi"
              : syncStatus === "error"
                ? "❌ Gagal Sync"
                : "Pantau kadaluarsa & stok"}
        </Text>
        <TouchableOpacity
          style={[styles.btnSync, syncing && styles.btnSyncDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.btnSyncText}>🔄 Sync Data</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryContainer}>
        <View style={[styles.summaryCard, styles.summaryCardTotal]}>
          <Text style={styles.summaryLabel}>Total Item</Text>
          <Text style={styles.summaryValue}>{totalItems} Produk</Text>
        </View>
      </View>

      {/* Tab Filter */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "kadaluarsa" && styles.tabButtonActiveKadaluarsa,
          ]}
          onPress={() => switchTab("kadaluarsa")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "kadaluarsa" && styles.tabTextActive,
            ]}
          >
            🔴 Kadaluarsa
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "stok_menipis" && styles.tabButtonActiveStok,
          ]}
          onPress={() => switchTab("stok_menipis")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "stok_menipis" && styles.tabTextActive,
            ]}
          >
            ⚠️ Stok Menipis
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Cari nama barang..."
          placeholderTextColor="#95a5a6"
          value={search}
          onChangeText={(text) => searchFilter(text)}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2c3e50" />
          <Text style={styles.loadingText}>Memuat data produk...</Text>
        </View>
      ) : (
        <FlatList
          data={filterData}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderProductItem}
          contentContainerStyle={{ paddingBottom: 30, paddingHorizontal: 15 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>
                {!dbReady
                  ? "📂"
                  : activeTab === "kadaluarsa"
                    ? "✨"
                    : "📦"}
              </Text>
              <Text style={styles.emptyText}>
                {!dbReady
                  ? "Database belum ada.\nSilakan Import di tab Home terlebih dahulu."
                  : activeTab === "kadaluarsa"
                    ? "Tidak ada produk yang mendekati masa kadaluarsa"
                    : "Tidak ada produk dengan stok menipis"}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f0f2f5",
  },
  header: {
    backgroundColor: "#2c3e50",
    padding: 12,
    paddingTop: Platform.OS === "android" ? 45 : 12,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    alignItems: "center",
  },
  title: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  headerSubtitle: {
    color: "#95a5a6",
    fontSize: 11,
    marginTop: 2,
    marginBottom: 5,
    textAlign: "center",
  },
  btnSync: {
    backgroundColor: "#3498db",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    minWidth: 120,
  },
  btnSyncDisabled: {
    backgroundColor: "#7f8c8d",
  },
  btnSyncText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 12,
  },
  summaryContainer: {
    flexDirection: "row",
    paddingHorizontal: 15,
    paddingTop: 12,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  summaryCardTotal: {
    backgroundColor: "#2c3e50",
  },
  summaryLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
  },
  summaryValue: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: "row",
    marginHorizontal: 15,
    marginTop: 12,
    backgroundColor: "#e8ecef",
    borderRadius: 12,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  tabButtonActiveKadaluarsa: {
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#e74c3c",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  tabButtonActiveStok: {
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#f39c12",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#7f8c8d",
  },
  tabTextActive: {
    color: "#2c3e50",
    fontWeight: "bold",
  },
  searchContainer: {
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 5,
  },
  searchInput: {
    height: 44,
    backgroundColor: "white",
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 14,
    color: "#2c3e50",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  card: {
    backgroundColor: "white",
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2c3e50",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  cardInfo: {
    flex: 1,
  },
  namaProduct: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  lokasi: {
    fontSize: 11,
    color: "#7f8c8d",
    marginTop: 4,
  },
  harga: {
    fontSize: 12,
    color: "#95a5a6",
    marginTop: 4,
  },
  cardRight: {
    alignItems: "flex-end",
    marginLeft: 8,
  },
  totalAmount: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "bold",
  },
  cardDetail: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  detailPreview: {
    fontSize: 12,
    color: "#95a5a6",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#7f8c8d",
    fontSize: 14,
  },
  emptyContainer: {
    marginTop: 60,
    alignItems: "center",
    paddingHorizontal: 30,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 15,
  },
  emptyText: {
    color: "#95a5a6",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
});
