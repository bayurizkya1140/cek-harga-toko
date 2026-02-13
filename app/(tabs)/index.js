import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// --- IMPORT LIBRARY ---
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
// ----------------------

import { StatusBar } from "expo-status-bar";
import { closeDatabase, getDatabase, resetDatabase } from "../../helpers/database";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

export default function App() {
  const [dataProduk, setDataProduk] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState("");
  const [dbName, setDbName] = useState("Memuat data...");
  const [db, setDb] = useState(null);

  // State untuk modal foto
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  // --- AUTO LOAD SAAT APLIKASI DIBUKA ---
  useEffect(() => {
    cekDatabaseTersimpan();
  }, []);

  const cekDatabaseTersimpan = async () => {
    try {
      const database = await getDatabase();

      if (database) {
        setDb(database);
        setDbName("Data Siap (Tersimpan)");
        await loadData(database);
      } else {
        setDbName("Database belum ada. Silakan Import.");
      }
    } catch (e) {
      console.log("Gagal auto-load:", e);
      setDbName("Silakan Import Database");
    }
  };

  // --- FUNGSI IMPORT (DIPERBAIKI) ---
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: "*/*",
      });

      if (result.canceled) return;

      const file = result.assets[0];

      if (!FileSystem.documentDirectory) {
        Alert.alert("Error", "Gagal membaca sistem file HP.");
        return;
      }

      const sqliteFolder = `${FileSystem.documentDirectory}SQLite`;
      const folderInfo = await FileSystem.getInfoAsync(sqliteFolder);
      if (!folderInfo.exists) {
        await FileSystem.makeDirectoryAsync(sqliteFolder, {
          intermediates: true,
        });
      }

      const targetPath = `${sqliteFolder}/toko_mobile.db`;

      // --- TUTUP KONEKSI LAMA DULU ---
      await closeDatabase();
      setDb(null);
      // --------------------------------

      // Hapus database lama
      const fileInfo = await FileSystem.getInfoAsync(targetPath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(targetPath, { idempotent: true });
      }

      // Copy file baru
      await FileSystem.copyAsync({
        from: file.uri,
        to: targetPath,
      });

      // Buka koneksi BARU melalui helper
      const database = await resetDatabase();
      setDb(database);
      setDbName(`Terupdate: ${file.name}`);

      // Load data baru
      await loadData(database);

      Alert.alert("Sukses", "Data berhasil diperbarui dan langsung muncul!");
    } catch (err) {
      console.log(err);
      Alert.alert("Gagal", "Error: " + err.message);
    }
  };

  const loadData = async (database) => {
    try {
      // Kosongkan dulu biar kelihatan reloadnya
      setDataProduk([]);
      setFilterData([]);

      const result = await database.getAllAsync(
        "SELECT * FROM products ORDER BY nama ASC",
      );
      setDataProduk(result);
      setFilterData(result);

      // Jika sedang ada pencarian, langsung filter ulang
      if (search) {
        const newData = result.filter((item) => {
          const itemData = item.nama
            ? item.nama.toUpperCase()
            : "".toUpperCase();
          const textData = search.toUpperCase();
          return itemData.indexOf(textData) > -1;
        });
        setFilterData(newData);
      }
    } catch (error) {
      console.log("Error SQL:", error);
    }
  };

  const searchFilter = (text) => {
    setSearch(text);
    if (text) {
      const newData = dataProduk.filter((item) => {
        const itemData = item.nama ? item.nama.toUpperCase() : "".toUpperCase();
        const textData = text.toUpperCase();
        return itemData.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(dataProduk);
    }
  };

  const openFotoModal = (product) => {
    setSelectedProduct(product);
    setImageLoading(true);
    setModalVisible(true);
  };

  const closeFotoModal = () => {
    setModalVisible(false);
    setSelectedProduct(null);
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.headerCard}>
        <Text style={styles.namaBarang}>{item.nama}</Text>
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

      {/* Tombol foto - hanya muncul jika foto tersedia */}
      {item.foto ? (
        <TouchableOpacity
          style={styles.btnFoto}
          onPress={() => openFotoModal(item)}
        >
          <Text style={styles.btnFotoText}>📷 Lihat Foto</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="#2c3e50" />

      <View style={styles.header}>
        <Text style={styles.title}>SiCek Bangunan</Text>
        <Text style={styles.subtitle}>{dbName}</Text>
        <TouchableOpacity style={styles.btnImport} onPress={pickDocument}>
          <Text style={styles.btnText}>📂 Update Database (Import)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Cari Barang..."
          value={search}
          onChangeText={(text) => searchFilter(text)}
        />
      </View>

      <FlatList
        data={filterData}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 30, paddingHorizontal: 15 }}
        ListEmptyComponent={
          <View style={{ marginTop: 50, alignItems: "center" }}>
            <Text style={{ color: "#888" }}>
              {db
                ? "Barang tidak ditemukan"
                : "Data belum ada. Silakan Import."}
            </Text>
          </View>
        }
      />

      {/* Modal untuk menampilkan foto */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeFotoModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header modal */}
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

            {/* Container gambar */}
            <View style={styles.imageContainer}>
              {imageLoading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#27ae60" />
                  <Text style={styles.loadingText}>Memuat gambar...</Text>
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
  subtitle: { color: "#bdc3c7", fontSize: 11, marginBottom: 5, marginTop: 2 },
  btnImport: {
    backgroundColor: "#27ae60",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    elevation: 2,
  },
  btnText: { color: "white", fontWeight: "bold", fontSize: 12 },

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

  // Style untuk tombol foto
  btnFoto: {
    backgroundColor: "#3498db",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginTop: 10,
    alignItems: "center",
  },
  btnFotoText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 14,
  },

  // Style untuk modal
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
  loadingContainer: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  loadingText: {
    marginTop: 10,
    color: "#666",
    fontSize: 14,
  },
});
