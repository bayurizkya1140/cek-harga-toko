import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
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
import { addPiutang, deletePiutang, getProducts, markPiutangLunas, openDB } from "../../helpers/database";
import { performFullSync } from "../../helpers/syncService";

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

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle, syncing, success, error

  // State untuk modal detail
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPiutang, setSelectedPiutang] = useState(null);

  // State untuk modal Tambah Piutang
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [formData, setFormData] = useState({
    nama_pembeli: "",
    alamat: "",
    tanggal: new Date().toLocaleString('id-ID'),
    catatan: "",
    items: [], // [{uuid, nama, harga, qty, satuan, subtotal}]
  });

  // State untuk Product Picker (di dalam Add Modal)
  const [productPickerVisible, setProductPickerVisible] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductForQty, setSelectedProductForQty] = useState(null);
  const [qtyInput, setQtyInput] = useState("1");
  const [qtyModalVisible, setQtyModalVisible] = useState(false);

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

      // Query berdasarkan tab (filter out soft-deleted records)
      let result;
      if (tab === "belum_lunas") {
        result = await database.getAllAsync(
          "SELECT * FROM piutang WHERE LOWER(TRIM(status)) = 'belum lunas' AND (sync_status IS NULL OR sync_status != 'deleted') ORDER BY tanggal DESC"
        );
      } else {
        result = await database.getAllAsync(
          "SELECT * FROM piutang WHERE LOWER(TRIM(status)) IN ('lunas', 'sudah lunas') AND (sync_status IS NULL OR sync_status != 'deleted') ORDER BY tanggal DESC"
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
        try { await database.closeAsync(); } catch (e) { }
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
        const catatan = item.catatan ? item.catatan.toUpperCase() : "";
        const textData = text.toUpperCase();
        return (
          nama.indexOf(textData) > -1 ||
          alamat.indexOf(textData) > -1 ||
          catatan.indexOf(textData) > -1
        );
      });
      setFilterData(newData);
    } else {
      setFilterData(data);
    }
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
        // Reload data setelah sync
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
      // Reset status setelah 3 detik
      setTimeout(() => setSyncStatus("idle"), 3000);
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

  // --- ACTIONS: ADD PIUTANG ---
  const openAddForm = async () => {
    setFormData({
      nama_pembeli: "",
      alamat: "",
      tanggal: new Date().toLocaleString('id-ID'),
      catatan: "",
      items: [],
    });

    // Load products for picker
    let database = null;
    try {
      database = await openDB();
      if (database) {
        const prods = await getProducts(database);
        setAllProducts(prods);
        setFilteredProducts(prods);
      }
    } catch (e) {
      console.log("Error loading products for picker:", e);
    } finally {
      if (database) await database.closeAsync();
    }

    setFormModalVisible(true);
  };

  const closeFormModal = () => {
    setFormModalVisible(false);
  };

  const handleProductSearch = (text) => {
    setProductSearch(text);
    if (text) {
      const filtered = allProducts.filter(p => p.nama.toUpperCase().includes(text.toUpperCase()));
      setFilteredProducts(filtered);
    } else {
      setFilteredProducts(allProducts);
    }
  };

  const openQtyModal = (product) => {
    setSelectedProductForQty(product);
    setQtyInput("1");
    setQtyModalVisible(true);
  };

  const addProductToItems = () => {
    const qty = parseFloat(qtyInput) || 0;
    if (qty <= 0) {
      Alert.alert("Error", "Jumlah harus lebih besar dari 0");
      return;
    }

    const newItem = {
      uuid: selectedProductForQty.uuid,
      nama: selectedProductForQty.nama,
      harga: selectedProductForQty.harga || 0,
      qty: qty,
      satuan: selectedProductForQty.satuan || "pcs",
      subtotal: (selectedProductForQty.harga || 0) * qty
    };

    setFormData(prev => ({
      ...prev,
      items: [...prev.items, newItem]
    }));

    setQtyModalVisible(false);
    setProductPickerVisible(false);
    setProductSearch("");
  };

  const removeItem = (index) => {
    const newItems = [...formData.items];
    newItems.splice(index, 1);
    setFormData(prev => ({ ...prev, items: newItems }));
  };

  const calculateTotal = () => {
    return formData.items.reduce((sum, item) => sum + item.subtotal, 0);
  };

  const handleSavePiutang = async () => {
    if (!formData.nama_pembeli.trim()) {
      Alert.alert("Error", "Nama pembeli harus diisi");
      return;
    }
    if (formData.items.length === 0) {
      Alert.alert("Error", "Pilih minimal 1 barang");
      return;
    }

    let database = null;
    try {
      database = await openDB();
      if (!database) return;

      await addPiutang(database, {
        nama_pembeli: formData.nama_pembeli.trim(),
        alamat: formData.alamat.trim(),
        tanggal: formData.tanggal,
        total: calculateTotal(),
        detail: JSON.stringify(formData.items),
        catatan: formData.catatan.trim()
      });

      Alert.alert("Sukses", "Piutang berhasil ditambahkan");
      closeFormModal();
      loadAll(activeTab);
    } catch (e) {
      Alert.alert("Error", "Gagal menyimpan piutang: " + e.message);
    } finally {
      if (database) await database.closeAsync();
    }
  };

  // --- ACTIONS: LUNAS & HAPUS ---
  const handleMarkLunas = async () => {
    Alert.alert(
      "Konfirmasi Lunas",
      `Tandai piutang ${selectedPiutang.nama_pembeli} sebagai LUNAS?\n\nAksi ini akan:\n1. Mengurangi stok produk\n2. Menambah riwayat transaksi`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Ya, Lunas",
          onPress: async () => {
            let database = null;
            try {
              database = await openDB();
              if (database) {
                await markPiutangLunas(database, selectedPiutang);
                Alert.alert("Sukses", "Piutang telah dilunasi ✅");
                closeDetail();
                loadAll(activeTab);
              }
            } catch (e) {
              Alert.alert("Error", "Gagal melunasi piutang: " + e.message);
            } finally {
              if (database) await database.closeAsync();
            }
          }
        }
      ]
    );
  };

  const handleDeletePiutang = async () => {
    Alert.alert(
      "Hapus Piutang",
      `Apakah Anda yakin ingin menghapus piutang ${selectedPiutang.nama_pembeli}?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: async () => {
            let database = null;
            try {
              database = await openDB();
              if (database) {
                await deletePiutang(database, selectedPiutang.id);
                Alert.alert("Sukses", "Piutang berhasil dihapus");
                closeDetail();
                loadAll(activeTab);
              }
            } catch (e) {
              Alert.alert("Error", "Gagal menghapus piutang: " + e.message);
            } finally {
              if (database) await database.closeAsync();
            }
          }
        }
      ]
    );
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
      {item.catatan ? (
        <View style={[styles.cardDetail, { borderTopWidth: item.detail ? 0 : 1, marginTop: item.detail ? 4 : 8, paddingTop: item.detail ? 0 : 8 }]}>
          <Text style={styles.detailPreview} numberOfLines={1}>
            📌 {item.catatan}
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
                : "Kelola piutang toko Anda"}
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
          placeholderTextColor="#95a5a6"
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

                  {selectedPiutang.catatan ? (
                    <>
                      <View style={styles.modalDivider} />
                      <View style={styles.modalInfoRow}>
                        <Text style={styles.modalInfoLabel}>📌 Catatan</Text>
                        <Text style={styles.modalInfoValue}>
                          {selectedPiutang.catatan}
                        </Text>
                      </View>
                    </>
                  ) : null}

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

                {/* MODAL ACTIONS: LUNAS & HAPUS */}
                <View style={styles.modalActions}>
                  {selectedPiutang.status?.toLowerCase() === "belum lunas" && (
                    <TouchableOpacity
                      style={[styles.btnActionLarge, styles.btnLunasLarge]}
                      onPress={handleMarkLunas}
                    >
                      <Text style={styles.btnActionLargeText}>✅ Tandai Lunas & Potong Stok</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.btnActionLarge, styles.btnHapusLarge]}
                    onPress={handleDeletePiutang}
                  >
                    <Text style={styles.btnActionLargeText}>🗑️ Hapus Piutang</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 80 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* FAB ADD PIUTANG */}
      <TouchableOpacity style={styles.fab} onPress={openAddForm}>
        <Text style={styles.fabText}>➕</Text>
      </TouchableOpacity>

      {/* ========== MODAL: TAMBAH PIUTANG ========== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={formModalVisible}
        onRequestClose={closeFormModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: screenHeight * 0.9 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>➕ Tambah Piutang Baru</Text>
              <TouchableOpacity style={styles.btnClose} onPress={closeFormModal}>
                <Text style={styles.btnCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.formLabel}>Nama Pembeli *</Text>
              <TextInput
                style={styles.formInput}
                value={formData.nama_pembeli}
                onChangeText={(t) => setFormData(p => ({ ...p, nama_pembeli: t }))}
                placeholder="Contoh: Budi Santoso"
                placeholderTextColor="#95a5a6"
              />

              <Text style={styles.formLabel}>Alamat</Text>
              <TextInput
                style={styles.formInput}
                value={formData.alamat}
                onChangeText={(t) => setFormData(p => ({ ...p, alamat: t }))}
                placeholder="Jl. Merdeka No. 123"
                placeholderTextColor="#95a5a6"
              />

              <Text style={styles.formLabel}>Tanggal</Text>
              <TextInput
                style={[styles.formInput, { backgroundColor: "#e8ecef", color: "#7f8c8d" }]}
                value={formData.tanggal}
                editable={false}
                placeholder="DD/MM/YYYY, HH.mm.ss"
                placeholderTextColor="#95a5a6"
              />

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>📝 Daftar Barang *</Text>
                <TouchableOpacity
                  style={styles.btnAddItem}
                  onPress={() => setProductPickerVisible(true)}
                >
                  <Text style={styles.btnAddItemText}>+ Pilih Produk</Text>
                </TouchableOpacity>
              </View>

              {formData.items.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.nama}</Text>
                    <Text style={styles.itemSubText}>{item.qty} {item.satuan} x {formatRupiah(item.harga)}</Text>
                  </View>
                  <Text style={styles.itemSubtotal}>{formatRupiah(item.subtotal)}</Text>
                  <TouchableOpacity onPress={() => removeItem(index)} style={styles.btnRemove}>
                    <Text style={styles.btnRemoveText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <View style={styles.totalContainer}>
                <Text style={styles.totalLabel}>Total Piutang:</Text>
                <Text style={styles.totalValue}>{formatRupiah(calculateTotal())}</Text>
              </View>

              <Text style={styles.formLabel}>Catatan</Text>
              <TextInput
                style={[styles.formInput, { height: 80, textAlignVertical: 'top' }]}
                value={formData.catatan}
                onChangeText={(t) => setFormData(p => ({ ...p, catatan: t }))}
                placeholder="Contoh: Janji bayar akhir bulan"
                placeholderTextColor="#95a5a6"
                multiline
              />

              <TouchableOpacity style={styles.btnSave} onPress={handleSavePiutang}>
                <Text style={styles.btnSaveText}>💾 Simpan Piutang</Text>
              </TouchableOpacity>
              <View style={{ height: 80 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ========== MODAL: PRODUCT PICKER ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={productPickerVisible}
        onRequestClose={() => setProductPickerVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: screenHeight * 0.8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pilih Produk dari Gudang</Text>
              <TouchableOpacity style={styles.btnClose} onPress={() => setProductPickerVisible(false)}>
                <Text style={styles.btnCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.searchPickerContainer}>
              <TextInput
                style={styles.searchPickerInput}
                placeholder="🔍 Cari nama barang..."
                placeholderTextColor="#95a5a6"
                value={productSearch}
                onChangeText={handleProductSearch}
              />
            </View>
            <FlatList
              data={filteredProducts}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => openQtyModal(item)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerItemName}>{item.nama}</Text>
                    <Text style={styles.pickerItemStok}>Stok: {item.stok} {item.satuan}</Text>
                  </View>
                  <Text style={styles.pickerItemHarga}>{formatRupiah(item.harga)}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyPicker}>Produk tidak ditemukan</Text>}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ========== MODAL: QTY INPUT ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={qtyModalVisible}
        onRequestClose={() => setQtyModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlayCenter}
        >
          <View style={styles.qtyModalContent}>
            <Text style={styles.qtyTitle}>Jumlah Barang</Text>
            <Text style={styles.qtyProdName}>{selectedProductForQty?.nama}</Text>
            <TextInput
              style={styles.qtyInput}
              value={qtyInput}
              onChangeText={setQtyInput}
              keyboardType="numeric"
              autoFocus
            />
            <View style={styles.qtyActions}>
              <TouchableOpacity style={styles.btnCancelQty} onPress={() => setQtyModalVisible(false)}>
                <Text style={styles.btnCancelQtyText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnConfirmQty} onPress={addProductToItems}>
                <Text style={styles.btnConfirmQtyText}>Tambah</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    alignItems: "center",
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
    fontSize: 11,
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

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 25,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2c3e50",
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    fontSize: 24,
    color: "white",
  },

  // Form Styles
  formLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2c3e50",
    marginTop: 15,
    marginBottom: 5,
  },
  formInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dcdde1",
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: "#2c3e50",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  btnAddItem: {
    backgroundColor: "#3498db",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btnAddItemText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  itemRow: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f0f2f5",
  },
  itemName: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  itemSubText: {
    fontSize: 12,
    color: "#7f8c8d",
  },
  itemSubtotal: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#e67e22",
    marginHorizontal: 10,
  },
  btnRemove: {
    padding: 5,
  },
  btnRemoveText: {
    fontSize: 16,
  },
  totalContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f1f2f6",
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#dcdde1",
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#e67e22",
  },
  btnSave: {
    backgroundColor: "#27ae60",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 25,
    elevation: 3,
  },
  btnSaveText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Modal Detail Actions
  modalActions: {
    marginTop: 25,
    gap: 12,
  },
  btnActionLarge: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    elevation: 2,
    borderWidth: 1,
  },
  btnLunasLarge: {
    backgroundColor: "#27ae60",
    borderColor: "#2ecc71",
  },
  btnHapusLarge: {
    backgroundColor: "#e74c3c",
    borderColor: "#c0392b",
  },
  btnActionLargeText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "white",
  },

  // Picker Styles
  searchPickerContainer: {
    padding: 15,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f2f6",
  },
  searchPickerInput: {
    backgroundColor: "#f1f2f6",
    padding: 10,
    borderRadius: 10,
    fontSize: 14,
    color: "#2c3e50",
  },
  pickerItem: {
    flexDirection: "row",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f2f6",
    alignItems: "center",
  },
  pickerItemName: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  pickerItemStok: {
    fontSize: 12,
    color: "#7f8c8d",
  },
  pickerItemHarga: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#27ae60",
  },
  emptyPicker: {
    textAlign: "center",
    marginTop: 20,
    color: "#95a5a6",
  },

  // Qty Modal
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  qtyModalContent: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 300,
  },
  qtyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    color: "#2c3e50",
  },
  qtyProdName: {
    fontSize: 14,
    textAlign: "center",
    color: "#7f8c8d",
    marginTop: 5,
    marginBottom: 15,
  },
  qtyInput: {
    borderWidth: 1,
    borderColor: "#dcdde1",
    borderRadius: 10,
    fontSize: 24,
    textAlign: "center",
    padding: 10,
    color: "#2c3e50",
    fontWeight: "bold",
  },
  qtyActions: {
    flexDirection: "row",
    marginTop: 20,
    gap: 10,
  },
  btnCancelQty: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f1f2f6",
  },
  btnConfirmQty: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#2c3e50",
  },
  btnCancelQtyText: {
    fontWeight: "bold",
    color: "#7f8c8d",
  },
  btnConfirmQtyText: {
    fontWeight: "bold",
    color: "white",
  },
});
