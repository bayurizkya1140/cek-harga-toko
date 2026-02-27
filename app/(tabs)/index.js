import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
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
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";

import {
  addProduct,
  deleteProduct,
  getProducts,
  openDB,
  updateProduct,
} from "../../helpers/database";
import { performFullSync } from "../../helpers/syncService";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// Daftar satuan yang sama dengan versi desktop
const SATUAN_OPTIONS = [
  "pcs", "kg", "meter", "sak", "dus", "roll", "btg", "lembar", "set", "liter", "galon"
];

// Helper: format angka dengan titik ribuan (1000 → 1.000)
const formatRibuan = (num) => {
  if (!num && num !== 0) return "";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Helper: hapus titik dari string harga (1.000 → 1000)
const parseHarga = (str) => {
  if (!str) return 0;
  return parseInt(str.replace(/\./g, "")) || 0;
};

export default function App() {
  const [dataProduk, setDataProduk] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle, syncing, success, error

  // State untuk modal foto preview
  const [fotoModalVisible, setFotoModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  // State untuk modal form (tambah / edit)
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null); // null = tambah, object = edit
  const [formData, setFormData] = useState({
    nama: "",
    stok: "",
    satuan: "pcs",
    harga: "",
    lokasi: "",
    foto: null,
  });

  // State untuk satuan picker
  const [satuanPickerVisible, setSatuanPickerVisible] = useState(false);

  // --- AUTO LOAD SAAT TAB DIFOKUSKAN ---
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    let database = null;
    try {
      setLoading(true);
      database = await openDB();

      if (!database) {
        setLoading(false);
        setDataProduk([]);
        setFilterData([]);
        return;
      }

      const result = await getProducts(database);
      setDataProduk(result);

      // Jika sedang ada pencarian, filter ulang
      if (search) {
        applySearch(result, search);
      } else {
        setFilterData(result);
      }
      setLoading(false);
    } catch (e) {
      console.log("Gagal load data:", e);
      setLoading(false);
      setDataProduk([]);
      setFilterData([]);
    } finally {
      if (database) {
        try {
          await database.closeAsync();
        } catch (e) { }
      }
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
        const freshData = await getProducts(database);
        setDataProduk(freshData);
        if (search) {
          applySearch(freshData, search);
        } else {
          setFilterData(freshData);
        }
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

  // --- SEARCH ---
  const applySearch = (data, text) => {
    if (text) {
      const newData = data.filter((item) => {
        const itemData = item.nama ? item.nama.toUpperCase() : "";
        const textData = text.toUpperCase();
        return itemData.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(data);
    }
  };

  const searchFilter = (text) => {
    setSearch(text);
    applySearch(dataProduk, text);
  };

  // --- FOTO PREVIEW MODAL ---
  const openFotoModal = (product) => {
    setSelectedProduct(product);
    setImageLoading(true);
    setFotoModalVisible(true);
  };

  const closeFotoModal = () => {
    setFotoModalVisible(false);
    setSelectedProduct(null);
  };

  // --- FORM MODAL (TAMBAH / EDIT) ---
  const openAddForm = () => {
    setEditingProduct(null);
    setFormData({
      nama: "",
      stok: "",
      satuan: "pcs",
      harga: "",
      lokasi: "",
      foto: null,
    });
    setSatuanPickerVisible(false);
    setFormModalVisible(true);
  };

  const openEditForm = (product) => {
    setEditingProduct(product);
    setFormData({
      nama: product.nama || "",
      stok: product.stok?.toString() || "0",
      satuan: product.satuan || "pcs",
      harga: product.harga ? formatRibuan(product.harga) : "0",
      lokasi: product.lokasi || "",
      foto: product.foto || null,
    });
    setSatuanPickerVisible(false);
    setFormModalVisible(true);
  };

  const closeFormModal = () => {
    setFormModalVisible(false);
    setEditingProduct(null);
    setSatuanPickerVisible(false);
  };

  // --- PILIH FOTO ---
  // Konfigurasi sama dengan desktop: max 800px, quality 85%, tanpa crop kotak
  const IMAGE_PICKER_OPTIONS = {
    mediaTypes: ['images'],
    quality: 0.85,        // Sama dengan desktop (canvas.toDataURL quality: 0.85)
    base64: true,
    allowsEditing: true,  // Bisa crop manual tapi tidak dipaksa kotak
    maxWidth: 800,        // Max width 800px
    maxHeight: 800,       // Max height 800px
    // Tidak pakai aspect ratio agar proporsional seperti desktop
  };

  const pickImage = async (source) => {
    try {
      let result;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Izin Ditolak", "Izin kamera diperlukan untuk mengambil foto.");
          return;
        }
        result = await ImagePicker.launchCameraAsync(IMAGE_PICKER_OPTIONS);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Izin Ditolak", "Izin galeri diperlukan untuk memilih foto.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync(IMAGE_PICKER_OPTIONS);
      }

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        const base64 = `data:image/jpeg;base64,${asset.base64}`;
        setFormData((prev) => ({ ...prev, foto: base64 }));
      }
    } catch (err) {
      console.log("Error pick image:", err);
      Alert.alert("Error", "Gagal mengambil foto");
    }
  };

  const showImagePickerOptions = () => {
    Alert.alert("Pilih Foto", "Ambil foto dari mana?", [
      { text: "📷 Kamera", onPress: () => pickImage("camera") },
      { text: "🖼️ Galeri", onPress: () => pickImage("gallery") },
      ...(!editingProduct && formData.foto
        ? [
          {
            text: "🗑️ Hapus Foto",
            style: "destructive",
            onPress: () => setFormData((prev) => ({ ...prev, foto: null })),
          },
        ]
        : []),
      { text: "Batal", style: "cancel" },
    ]);
  };

  // --- SIMPAN PRODUK ---
  const handleSaveProduct = async () => {
    if (!formData.nama.trim()) {
      Alert.alert("Error", "Nama produk harus diisi!");
      return;
    }

    let database = null;
    try {
      database = await openDB();
      if (!database) {
        Alert.alert("Error", "Gagal membuka database");
        return;
      }

      const productData = {
        nama: formData.nama.trim(),
        stok: parseFloat(formData.stok) || 0,
        satuan: formData.satuan || "pcs",
        harga: parseHarga(formData.harga),
        lokasi: formData.lokasi.trim(),
        foto: formData.foto,
      };

      if (editingProduct) {
        await updateProduct(database, editingProduct.id, productData);
        Alert.alert("Sukses", "Produk berhasil diperbarui! ✏️");
      } else {
        await addProduct(database, productData);
        Alert.alert("Sukses", "Produk berhasil ditambahkan! ✅");
      }

      closeFormModal();

      // Reload data
      const freshData = await getProducts(database);
      setDataProduk(freshData);
      if (search) {
        applySearch(freshData, search);
      } else {
        setFilterData(freshData);
      }
    } catch (err) {
      console.log("Error save product:", err);
      Alert.alert("Error", "Gagal menyimpan produk: " + err.message);
    } finally {
      if (database) {
        try {
          await database.closeAsync();
        } catch (e) { }
      }
    }
  };

  // --- HAPUS PRODUK ---
  const handleDeleteProduct = (product) => {
    Alert.alert(
      "Hapus Produk",
      `Apakah Anda yakin ingin menghapus "${product.nama}"?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: async () => {
            let database = null;
            try {
              database = await openDB();
              if (!database) return;

              await deleteProduct(database, product.id);

              // Reload data
              const freshData = await getProducts(database);
              setDataProduk(freshData);
              if (search) {
                applySearch(freshData, search);
              } else {
                setFilterData(freshData);
              }
            } catch (err) {
              console.log("Error delete:", err);
              Alert.alert("Error", "Gagal menghapus produk");
            } finally {
              if (database) {
                try {
                  await database.closeAsync();
                } catch (e) { }
              }
            }
          },
        },
      ]
    );
  };

  // --- SYNC STATUS INDICATOR ---
  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing":
        return "⏳ Menyinkronkan...";
      case "success":
        return "✅ Tersinkronisasi";
      case "error":
        return "❌ Gagal Sync";
      default:
        return `📦 ${dataProduk.length} Produk`;
    }
  };

  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case "syncing":
        return "#f39c12";
      case "success":
        return "#27ae60";
      case "error":
        return "#e74c3c";
      default:
        return "#bdc3c7";
    }
  };

  // --- RENDER ITEM ---
  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.headerCard}>
        <Text style={styles.namaBarang} numberOfLines={5}>
          {item.nama}
        </Text>
        {item.lokasi ? (
          <Text style={styles.lokasi}>📍 {item.lokasi}</Text>
        ) : null}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Harga:</Text>
        <Text style={styles.harga}>
          Rp {item.harga ? item.harga.toLocaleString("id-ID") : 0}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Stok:</Text>
        <Text style={styles.stok}>
          {item.stok} {item.satuan}
        </Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {item.foto ? (
          <TouchableOpacity
            style={[styles.btnAction, styles.btnFoto]}
            onPress={() => openFotoModal(item)}
          >
            <Text style={[styles.btnActionText, { color: "#fff" }]}>📷 Foto</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.btnAction, styles.btnEdit]}
          onPress={() => openEditForm(item)}
        >
          <Text style={styles.btnActionText}>✏️ Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnAction, styles.btnDelete]}
          onPress={() => handleDeleteProduct(item)}
        >
          <Text style={[styles.btnActionText, { color: "#fff" }]}>🗑️ Hapus</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#2c3e50" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>SiCek Bangunan</Text>
        <Text style={[styles.subtitle, { color: getSyncStatusColor() }]}>
          {getSyncStatusText()}
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

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Cari Barang..."
          placeholderTextColor="#95a5a6"
          selectionColor="#2c3e50"
          value={search}
          onChangeText={(text) => searchFilter(text)}
        />
      </View>

      {/* Product List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2c3e50" />
          <Text style={styles.loadingText}>Memuat data...</Text>
        </View>
      ) : (
        <FlatList
          data={filterData}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 80, paddingHorizontal: 15 }}
          ListEmptyComponent={
            <View style={{ marginTop: 50, alignItems: "center" }}>
              <Text style={{ fontSize: 48, marginBottom: 10 }}>📦</Text>
              <Text style={{ color: "#888", textAlign: "center" }}>
                {dataProduk.length > 0
                  ? "Barang tidak ditemukan"
                  : "Data belum ada.\nTekan tombol 🔄 Sync Data untuk mengambil data dari cloud, atau ➕ untuk menambah produk baru."}
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Tombol Tambah Produk */}
      <TouchableOpacity style={styles.fab} onPress={openAddForm}>
        <Text style={styles.fabText}>➕</Text>
      </TouchableOpacity>

      {/* ========== MODAL: FOTO PREVIEW ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={fotoModalVisible}
        onRequestClose={closeFotoModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {selectedProduct?.nama}
              </Text>
              <TouchableOpacity
                style={styles.btnClose}
                onPress={closeFotoModal}
              >
                <Text style={styles.btnCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.imageContainer}>
              {imageLoading && (
                <View style={styles.imgLoadingContainer}>
                  <ActivityIndicator size="large" color="#27ae60" />
                  <Text style={styles.imgLoadingText}>Memuat gambar...</Text>
                </View>
              )}
              {selectedProduct?.foto && (
                <Image
                  source={{ uri: selectedProduct.foto }}
                  style={styles.modalImage}
                  resizeMode="contain"
                  onLoadStart={() => setImageLoading(true)}
                  onLoadEnd={() => setImageLoading(false)}
                  onError={() => {
                    setImageLoading(false);
                    Alert.alert("Error", "Gagal memuat gambar");
                  }}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== MODAL: FORM TAMBAH / EDIT ========== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={formModalVisible}
        onRequestClose={closeFormModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
        >
          <View style={styles.formOverlay}>
            <View style={styles.formContent}>
              {/* Header */}
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>
                  {editingProduct ? "✏️ Edit Produk" : "➕ Tambah Produk"}
                </Text>
                <TouchableOpacity
                  style={styles.btnClose}
                  onPress={closeFormModal}
                >
                  <Text style={styles.btnCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.formBody}
                showsVerticalScrollIndicator={false}
              >
                {/* Nama */}
                <Text style={styles.formLabel}>Nama Produk *</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.nama}
                  onChangeText={(t) =>
                    setFormData((prev) => ({ ...prev, nama: t }))
                  }
                  placeholder="Contoh: Paku 5cm"
                  placeholderTextColor="#95a5a6"
                  selectionColor="#2c3e50"
                />

                {/* Stok & Satuan */}
                <View style={styles.formRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.formLabel}>Stok</Text>
                    <TextInput
                      style={styles.formInput}
                      value={formData.stok}
                      onChangeText={(t) =>
                        setFormData((prev) => ({ ...prev, stok: t }))
                      }
                      placeholder="0"
                      placeholderTextColor="#95a5a6"
                      selectionColor="#2c3e50"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8, zIndex: 10 }}>
                    <Text style={styles.formLabel}>Satuan</Text>
                    <TouchableOpacity
                      style={[styles.formInput, styles.satuanPicker]}
                      onPress={() => setSatuanPickerVisible(!satuanPickerVisible)}
                    >
                      <Text style={styles.satuanPickerText}>
                        {formData.satuan ? formData.satuan.charAt(0).toUpperCase() + formData.satuan.slice(1) : "Pilih Satuan"}
                      </Text>
                      <Text style={styles.satuanPickerArrow}>
                        {satuanPickerVisible ? "▲" : "▼"}
                      </Text>
                    </TouchableOpacity>
                    {satuanPickerVisible && (
                      <View style={styles.satuanDropdown}>
                        {SATUAN_OPTIONS.map((s) => (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.satuanOption,
                              formData.satuan === s && styles.satuanOptionActive,
                            ]}
                            onPress={() => {
                              setFormData((prev) => ({ ...prev, satuan: s }));
                              setSatuanPickerVisible(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.satuanOptionText,
                                formData.satuan === s && styles.satuanOptionTextActive,
                              ]}
                            >
                              {s.charAt(0).toUpperCase() + s.slice(1)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {/* Harga */}
                <Text style={styles.formLabel}>Harga (Rp)</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.harga}
                  onChangeText={(t) => {
                    // Hanya terima angka, auto format dengan titik ribuan
                    const angkaMurni = t.replace(/\D/g, "");
                    const formatted = formatRibuan(angkaMurni);
                    setFormData((prev) => ({ ...prev, harga: formatted }));
                  }}
                  placeholder="0"
                  placeholderTextColor="#95a5a6"
                  selectionColor="#2c3e50"
                  keyboardType="numeric"
                />

                {/* Lokasi */}
                <Text style={styles.formLabel}>Lokasi</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.lokasi}
                  onChangeText={(t) =>
                    setFormData((prev) => ({ ...prev, lokasi: t }))
                  }
                  placeholder="Rak A / Gudang Belakang"
                  placeholderTextColor="#95a5a6"
                  selectionColor="#2c3e50"
                />

                {/* Foto — tampil untuk TAMBAH dan EDIT */}
                <>
                  <Text style={styles.formLabel}>Foto Produk</Text>
                  <TouchableOpacity
                    style={styles.fotoPicker}
                    onPress={showImagePickerOptions}
                  >
                    {formData.foto ? (
                      <Image
                        source={{ uri: formData.foto }}
                        style={styles.fotoPreview}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.fotoPlaceholder}>
                        <Text style={{ fontSize: 32 }}>📷</Text>
                        <Text style={{ color: "#95a5a6", marginTop: 5, fontSize: 12 }}>
                          Ketuk untuk pilih foto
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </>

                {/* Tombol Simpan */}
                <TouchableOpacity
                  style={styles.btnSave}
                  onPress={handleSaveProduct}
                >
                  <Text style={styles.btnSaveText}>
                    {editingProduct ? "💾 Perbarui Produk" : "💾 Simpan Produk"}
                  </Text>
                </TouchableOpacity>

                <View style={{ height: 80 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f6fa" },
  header: {
    backgroundColor: "#2c3e50",
    padding: 10,
    paddingTop: Platform.OS === "android" ? 30 : 10,
    alignItems: "center",
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
  },
  title: { color: "white", fontSize: 18, fontWeight: "bold" },
  subtitle: { fontSize: 11, marginBottom: 5, marginTop: 2 },
  btnSync: {
    backgroundColor: "#3498db",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    elevation: 2,
    minWidth: 120,
    alignItems: "center",
  },
  btnSyncDisabled: {
    backgroundColor: "#7f8c8d",
  },
  btnSyncText: { color: "white", fontWeight: "bold", fontSize: 12 },

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
  headerCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    paddingBottom: 8,
  },
  namaBarang: { fontSize: 15, fontWeight: "bold", color: "#2c3e50", flex: 1 },
  lokasi: {
    fontSize: 11,
    color: "#d35400",
    fontWeight: "bold",
    backgroundColor: "#ffe0b2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginLeft: 5,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  label: { color: "#95a5a6", fontSize: 12 },
  harga: { color: "#27ae60", fontWeight: "bold", fontSize: 16 },
  stok: { color: "#2c3e50", fontWeight: "bold", fontSize: 13 },

  // Action buttons
  actionRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 8,
  },
  btnAction: {
    flex: 1,
    backgroundColor: "#ecf0f1",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  btnFoto: {
    backgroundColor: "#3498db",
  },
  btnEdit: {
    backgroundColor: "#ebf5fb",
  },
  btnDelete: {
    backgroundColor: "#e74c3c",
  },
  btnActionText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#2c3e50",
  },

  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#27ae60",
    justifyContent: "center",
    alignItems: "center",
    elevation: 6,
    shadowColor: "#27ae60",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  fabText: { fontSize: 24 },

  // Modal Foto Preview
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 15,
    width: screenWidth * 0.9,
    maxHeight: screenHeight * 0.8,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#2c3e50",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "white",
    flex: 1,
    marginRight: 10,
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
  imageContainer: {
    width: "100%",
    height: screenHeight * 0.6,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  modalImage: {
    width: "100%",
    height: "100%",
  },
  imgLoadingContainer: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  imgLoadingText: {
    marginTop: 10,
    color: "#666",
    fontSize: 14,
  },

  // Modal Form
  formOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  formContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: screenHeight * 0.85,
    overflow: "hidden",
  },
  formHeader: {
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
  formTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "white",
  },
  formBody: {
    padding: 20,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 5,
    marginTop: 12,
  },
  formInput: {
    height: 44,
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 14,
    color: "#2c3e50",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  formRow: {
    flexDirection: "row",
  },

  // Foto picker in form
  fotoPicker: {
    marginTop: 5,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    borderStyle: "dashed",
  },
  fotoPreview: {
    width: "100%",
    height: 180,
  },
  fotoPlaceholder: {
    width: "100%",
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },

  // Save button
  btnSave: {
    backgroundColor: "#27ae60",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
    elevation: 3,
  },
  btnSaveText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Satuan picker styles
  satuanPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  satuanPickerText: {
    fontSize: 14,
    color: "#2c3e50",
  },
  satuanPickerArrow: {
    fontSize: 10,
    color: "#95a5a6",
  },
  satuanDropdown: {
    position: "absolute",
    top: 75,
    left: 0,
    right: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    overflow: "hidden",
    zIndex: 20,
  },
  satuanOption: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  satuanOptionActive: {
    backgroundColor: "#ebf5fb",
  },
  satuanOptionText: {
    fontSize: 14,
    color: "#2c3e50",
  },
  satuanOptionTextActive: {
    fontWeight: "bold",
    color: "#3498db",
  },
});
