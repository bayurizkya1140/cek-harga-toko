import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { openDB } from "../../helpers/database";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

export default function PiutangScreen() {
  const [dataPiutang, setDataPiutang] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [activeTab, setActiveTab] = useState("belum_lunas");
  const [totalPiutang, setTotalPiutang] = useState(0);
  const [jumlahOrang, setJumlahOrang] = useState(0);

  // State untuk modal detail
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPiutang, setSelectedPiutang] = useState(null);

  // Auto load saat fokus ke tab ini
  useFocusEffect(
    useCallback(() => {
      loadAll("belum_lunas");
      setActiveTab("belum_lunas");
      setSearch("");
    }, [])
  );

  // Fungsi utama: buka DB baru, query, lalu tutup
  const loadAll = async (tab) => {
    let database = null;
    try {
      setLoading(true);

      database = await openDB();

      if (!database) {
        setLoading(false);
        setDbReady(false);
        setDataPiutang([]);
        setFilterData([]);
        return;
      }

      setDbReady(true);

      // Cek apakah tabel piutang ada
      const tableCheck = await database.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='piutang'"
      );

      if (tableCheck.length === 0) {
        console.log("Tabel piutang tidak ditemukan");
        setLoading(false);
        setDataPiutang([]);
        setFilterData([]);
        Alert.alert(
          "Info",
          "Tabel piutang tidak ditemukan dalam database. Pastikan database yang di-import memiliki tabel piutang."
        );
        return;
      }

      // Query berdasarkan tab
      let result;
      if (tab === "belum_lunas") {
        result = await database.getAllAsync(
          "SELECT * FROM piutang WHERE LOWER(TRIM(status)) = 'belum lunas' ORDER BY tanggal DESC"
        );
      } else {
        result = await database.getAllAsync(
          "SELECT * FROM piutang WHERE LOWER(TRIM(status)) IN ('lunas', 'sudah lunas') ORDER BY tanggal DESC"
        );
      }

      console.log(`Piutang [${tab}]: ${result.length} data ditemukan`);

      setDataPiutang(result);
      setFilterData(result);

      // Hitung total & jumlah
      const total = result.reduce((sum, item) => sum + (item.total || 0), 0);
      setTotalPiutang(total);
      setJumlahOrang(result.length);

      setLoading(false);
    } catch (error) {
      console.log("Error piutang:", error);
      setLoading(false);
      setDataPiutang([]);
      setFilterData([]);
    } finally {
      if (database) {
        try { await database.closeAsync(); } catch (e) {}
      }
    }
  };

  // Saat tab berubah
  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSearch("");
    loadAll(tab);
  };

  const applySearch = (data, text) => {
    if (text) {
      const newData = data.filter((item) => {
        const nama = item.nama_pembeli
          ? item.nama_pembeli.toUpperCase()
          : "";
        const alamat = item.alamat ? item.alamat.toUpperCase() : "";
        const textData = text.toUpperCase();
        return nama.indexOf(textData) > -1 || alamat.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(data);
    }
  };

  const searchFilter = (text) => {
    setSearch(text);
    applySearch(dataPiutang, text);
  };

  const openDetail = (item) => {
    setSelectedPiutang(item);
    setModalVisible(true);
  };

  const closeDetail = () => {
    setModalVisible(false);
    setSelectedPiutang(null);
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
      const options = { day: "numeric", month: "long", year: "numeric" };
      return date.toLocaleDateString("id-ID", options);
    } catch {
      return tgl;
    }
  };

  const getStatusColor = (status) => {
    if (!status) return "#e74c3c";
    const s = status.toLowerCase().trim();
    if (s === "lunas" || s === "sudah lunas") return "#27ae60";
    return "#e74c3c";
  };

  // Parse detail JSON menjadi array barang
  const parseDetail = (detail) => {
    if (!detail) return [];
    try {
      const parsed = JSON.parse(detail);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  };

  // Preview singkat detail untuk card
  const getDetailPreview = (detail) => {
    const items = parseDetail(detail);
    if (items.length > 0) {
      const firstName = items[0].nama || "Barang";
      if (items.length === 1) return firstName;
      return `${firstName} +${items.length - 1} barang lainnya`;
    }
    // Jika bukan JSON, tampilkan sebagai text biasa
    return detail;
  };

  const renderPiutangItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openDetail(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardTop}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {item.nama_pembeli
              ? item.nama_pembeli.charAt(0).toUpperCase()
              : "?"}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.namaPembeli} numberOfLines={1}>
            {item.nama_pembeli}
          </Text>
          {item.alamat ? (
            <Text style={styles.alamat} numberOfLines={1}>
              📍 {item.alamat}
            </Text>
          ) : null}
          <Text style={styles.tanggal}>
            📅 {formatTanggal(item.tanggal)}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.totalAmount}>{formatRupiah(item.total)}</Text>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  activeTab === "belum_lunas"
                    ? "rgba(231, 76, 60, 0.15)"
                    : "rgba(39, 174, 96, 0.15)",
              },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    activeTab === "belum_lunas" ? "#e74c3c" : "#27ae60",
                },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                {
                  color:
                    activeTab === "belum_lunas" ? "#e74c3c" : "#27ae60",
                },
              ]}
            >
              {activeTab === "belum_lunas" ? "Belum Lunas" : "Lunas"}
            </Text>
          </View>
        </View>
      </View>
      {item.detail ? (
        <View style={styles.cardDetail}>
          <Text style={styles.detailPreview} numberOfLines={1}>
            📝 {getDetailPreview(item.detail)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#2c3e50" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>💰 Daftar Piutang</Text>
        <Text style={styles.headerSubtitle}>Kelola piutang toko Anda</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryContainer}>
        <View style={[styles.summaryCard, styles.summaryCardTotal]}>
          <Text style={styles.summaryLabel}>Total Piutang</Text>
          <Text style={styles.summaryValue}>{formatRupiah(totalPiutang)}</Text>
        </View>
        <View style={[styles.summaryCard, styles.summaryCardCount]}>
          <Text style={styles.summaryLabel}>Jumlah</Text>
          <Text style={styles.summaryValue}>{jumlahOrang} orang</Text>
        </View>
      </View>

      {/* Tab Filter */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "belum_lunas" && styles.tabButtonActiveBelum,
          ]}
          onPress={() => switchTab("belum_lunas")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "belum_lunas" && styles.tabTextActive,
            ]}
          >
            🔴 Belum Lunas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "lunas" && styles.tabButtonActiveLunas,
          ]}
          onPress={() => switchTab("lunas")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "lunas" && styles.tabTextActive,
            ]}
          >
            🟢 Sudah Lunas
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Cari nama / alamat..."
          value={search}
          onChangeText={(text) => searchFilter(text)}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2c3e50" />
          <Text style={styles.loadingText}>Memuat data piutang...</Text>
        </View>
      ) : (
        <FlatList
          data={filterData}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderPiutangItem}
          contentContainerStyle={{ paddingBottom: 30, paddingHorizontal: 15 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>
                {!dbReady
                  ? "📂"
                  : activeTab === "belum_lunas"
                  ? "✅"
                  : "📋"}
              </Text>
              <Text style={styles.emptyText}>
                {!dbReady
                  ? "Database belum ada.\nSilakan Import di tab Home terlebih dahulu."
                  : activeTab === "belum_lunas"
                  ? "Tidak ada piutang yang belum lunas"
                  : "Belum ada piutang yang sudah lunas"}
              </Text>
            </View>
          }
        />
      )}

      {/* Modal Detail */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeDetail}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Detail Piutang</Text>
              <TouchableOpacity
                style={styles.btnClose}
                onPress={closeDetail}
              >
                <Text style={styles.btnCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedPiutang && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.modalProfile}>
                  <View style={styles.modalAvatar}>
                    <Text style={styles.modalAvatarText}>
                      {selectedPiutang.nama_pembeli
                        ? selectedPiutang.nama_pembeli
                            .charAt(0)
                            .toUpperCase()
                        : "?"}
                    </Text>
                  </View>
                  <Text style={styles.modalNama}>
                    {selectedPiutang.nama_pembeli}
                  </Text>
                  <View
                    style={[
                      styles.modalStatusBadge,
                      {
                        backgroundColor:
                          getStatusColor(selectedPiutang.status) === "#27ae60"
                            ? "rgba(39, 174, 96, 0.15)"
                            : "rgba(231, 76, 60, 0.15)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalStatusText,
                        {
                          color: getStatusColor(selectedPiutang.status),
                        },
                      ]}
                    >
                      {selectedPiutang.status
                        ? selectedPiutang.status.charAt(0).toUpperCase() +
                          selectedPiutang.status.slice(1)
                        : "Belum Lunas"}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalInfoSection}>
                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalInfoLabel}>📍 Alamat</Text>
                    <Text style={styles.modalInfoValue}>
                      {selectedPiutang.alamat || "-"}
                    </Text>
                  </View>

                  <View style={styles.modalDivider} />

                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalInfoLabel}>📅 Tanggal</Text>
                    <Text style={styles.modalInfoValue}>
                      {formatTanggal(selectedPiutang.tanggal)}
                    </Text>
                  </View>

                  <View style={styles.modalDivider} />

                  <View style={styles.modalInfoRow}>
                    <Text style={styles.modalInfoLabel}>💰 Total</Text>
                    <Text style={[styles.modalInfoValue, styles.modalTotal]}>
                      {formatRupiah(selectedPiutang.total)}
                    </Text>
                  </View>

                  {selectedPiutang.detail ? (
                    <>
                      <View style={styles.modalDivider} />
                      <View style={styles.modalInfoRow}>
                        <Text style={styles.modalInfoLabel}>📝 Detail Barang</Text>
                      </View>
                      {parseDetail(selectedPiutang.detail).length > 0 ? (
                        parseDetail(selectedPiutang.detail).map((barang, index) => (
                          <View key={index} style={styles.detailItemCard}>
                            <View style={styles.detailItemHeader}>
                              <View style={styles.detailItemNumber}>
                                <Text style={styles.detailItemNumberText}>{index + 1}</Text>
                              </View>
                              <Text style={styles.detailItemNama} numberOfLines={2}>
                                {barang.nama || "-"}
                              </Text>
                            </View>
                            <View style={styles.detailItemBody}>
                              <View style={styles.detailItemRow}>
                                <Text style={styles.detailItemLabel}>Harga</Text>
                                <Text style={styles.detailItemValue}>{formatRupiah(barang.harga)}</Text>
                              </View>
                              <View style={styles.detailItemRow}>
                                <Text style={styles.detailItemLabel}>Qty</Text>
                                <Text style={styles.detailItemValue}>{barang.qty || 0} {barang.satuan || "pcs"}</Text>
                              </View>
                              <View style={[styles.detailItemRow, styles.detailItemSubtotalRow]}>
                                <Text style={styles.detailItemLabel}>Subtotal</Text>
                                <Text style={styles.detailItemSubtotal}>{formatRupiah(barang.subtotal)}</Text>
                              </View>
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.modalInfoValue}>{selectedPiutang.detail}</Text>
                      )}
                    </>
                  ) : null}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
    paddingTop: Platform.OS === "android" ? 35 : 12,
    alignItems: "center",
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
  },
  title: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    color: "#95a5a6",
    fontSize: 11,
    marginTop: 2,
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
  summaryCardCount: {
    backgroundColor: "#34495e",
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
  tabButtonActiveBelum: {
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#e74c3c",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  tabButtonActiveLunas: {
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#27ae60",
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
    alignItems: "center",
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
  namaPembeli: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  alamat: {
    fontSize: 11,
    color: "#7f8c8d",
    marginTop: 2,
  },
  tanggal: {
    fontSize: 11,
    color: "#95a5a6",
    marginTop: 2,
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
    marginTop: 4,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: screenHeight * 0.75,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#2c3e50",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "white",
  },
  btnClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#e74c3c",
    justifyContent: "center",
    alignItems: "center",
  },
  btnCloseText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalBody: {
    padding: 20,
  },
  modalProfile: {
    alignItems: "center",
    marginBottom: 20,
  },
  modalAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#2c3e50",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  modalAvatarText: {
    color: "white",
    fontSize: 28,
    fontWeight: "bold",
  },
  modalNama: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 6,
    textAlign: "center",
  },
  modalStatusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  modalStatusText: {
    fontSize: 13,
    fontWeight: "bold",
  },
  modalInfoSection: {
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 16,
  },
  modalInfoRow: {
    paddingVertical: 8,
  },
  modalInfoLabel: {
    fontSize: 12,
    color: "#95a5a6",
    fontWeight: "600",
    marginBottom: 4,
  },
  modalInfoValue: {
    fontSize: 15,
    color: "#2c3e50",
    fontWeight: "500",
  },
  modalTotal: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#e67e22",
  },
  modalDivider: {
    height: 1,
    backgroundColor: "#e8ecef",
  },

  // Detail Item Styles
  detailItemCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e8ecef",
    overflow: "hidden",
  },
  detailItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f2f5",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  detailItemNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#2c3e50",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  detailItemNumberText: {
    color: "white",
    fontSize: 11,
    fontWeight: "bold",
  },
  detailItemNama: {
    flex: 1,
    fontSize: 13,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  detailItemBody: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  detailItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
  },
  detailItemLabel: {
    fontSize: 12,
    color: "#95a5a6",
  },
  detailItemValue: {
    fontSize: 13,
    color: "#2c3e50",
    fontWeight: "500",
  },
  detailItemSubtotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    marginTop: 4,
    paddingTop: 6,
  },
  detailItemSubtotal: {
    fontSize: 14,
    color: "#e67e22",
    fontWeight: "bold",
  },
});
