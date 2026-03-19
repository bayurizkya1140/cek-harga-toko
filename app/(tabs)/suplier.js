import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import {
  addSupplier,
  deleteSupplier,
  getSuppliers,
  openDB,
  updateSupplier,
} from "../../helpers/database";
import { performFullSync } from "../../helpers/syncService";

export default function SuplierTab() {
  const [dataSuplier, setDataSuplier] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");

  // State untuk form modal
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingSuplier, setEditingSuplier] = useState(null);
  const [formData, setFormData] = useState({
    nama: "",
    kategori_produk: "",
    alamat: "",
    telepon: "",
    catatan: "",
  });

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
        setDataSuplier([]);
        setFilterData([]);
        return;
      }

      const result = await getSuppliers(database);
      setDataSuplier(result);

      if (search) {
        applySearch(result, search);
      } else {
        setFilterData(result);
      }
      setLoading(false);
    } catch (e) {
      console.log("Gagal load data suplier:", e);
      setLoading(false);
      setDataSuplier([]);
      setFilterData([]);
    } finally {
      if (database) {
        try {
          await database.closeAsync();
        } catch (e) { }
      }
    }
  };

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
        const freshData = await getSuppliers(database);
        setDataSuplier(freshData);
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
      setTimeout(() => setSyncStatus("idle"), 3000);
    }
  };

  const applySearch = (data, text) => {
    if (text) {
      const textData = text.toUpperCase();
      const newData = data.filter((item) => {
        const itemName = item.nama ? item.nama.toUpperCase() : "";
        const itemCategory = item.kategori_produk ? item.kategori_produk.toUpperCase() : "";
        return itemName.indexOf(textData) > -1 || itemCategory.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(data);
    }
  };

  const searchFilter = (text) => {
    setSearch(text);
    applySearch(dataSuplier, text);
  };

  const openAddForm = () => {
    setEditingSuplier(null);
    setFormData({
      nama: "",
      kategori_produk: "",
      alamat: "",
      telepon: "",
      catatan: "",
    });
    setFormModalVisible(true);
  };

  const openEditForm = (item) => {
    setEditingSuplier(item);
    setFormData({
      nama: item.nama || "",
      kategori_produk: item.kategori_produk || "",
      alamat: item.alamat || "",
      telepon: item.telepon || "",
      catatan: item.catatan || "",
    });
    setFormModalVisible(true);
  };

  const closeFormModal = () => {
    setFormModalVisible(false);
    setEditingSuplier(null);
  };

  const handleSaveSuplier = async () => {
    if (!formData.nama.trim()) {
      Alert.alert("Error", "Nama suplier harus diisi!");
      return;
    }

    let database = null;
    try {
      database = await openDB();
      if (!database) {
        Alert.alert("Error", "Gagal membuka database");
        return;
      }

      const suplierData = {
        nama: formData.nama.trim(),
        kategori_produk: formData.kategori_produk.trim(),
        alamat: formData.alamat.trim(),
        telepon: formData.telepon.trim(),
        catatan: formData.catatan.trim(),
      };

      if (editingSuplier) {
        await updateSupplier(database, editingSuplier.id, suplierData);
        Alert.alert("Sukses", "Suplier berhasil diperbarui! ✏️");
      } else {
        await addSupplier(database, suplierData);
        Alert.alert("Sukses", "Suplier berhasil ditambahkan! ✅");
      }

      closeFormModal();
      const freshData = await getSuppliers(database);
      setDataSuplier(freshData);
      applySearch(freshData, search);
    } catch (err) {
      console.log("Error save suplier:", err);
      Alert.alert("Error", "Gagal menyimpan suplier: " + err.message);
    } finally {
      if (database) {
        try {
          await database.closeAsync();
        } catch (e) { }
      }
    }
  };

  const handleDeleteSuplier = (item) => {
    Alert.alert(
      "Hapus Suplier",
      `Apakah Anda yakin ingin menghapus suplier "${item.nama}"?`,
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

              await deleteSupplier(database, item.id);
              const freshData = await getSuppliers(database);
              setDataSuplier(freshData);
              applySearch(freshData, search);
            } catch (err) {
              console.log("Error delete suplier:", err);
              Alert.alert("Error", "Gagal menghapus suplier");
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

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing":
        return "⏳ Menyinkronkan...";
      case "success":
        return "✅ Tersinkronisasi";
      case "error":
        return "❌ Gagal Sync";
      default:
        return `🏭 ${dataSuplier.length} Suplier`;
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

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.headerCard}>
        <Text style={styles.namaSuplier} numberOfLines={2}>
          {item.nama}
        </Text>
        {item.kategori_produk ? (
          <View style={styles.badgeKategori}>
            <Text style={styles.badgeKategoriText}>{item.kategori_produk}</Text>
          </View>
        ) : null}
      </View>

      {item.telepon ? (
        <View style={styles.row}>
          <Text style={styles.rowIcon}>📞</Text>
          <Text style={styles.rowText}>{item.telepon}</Text>
        </View>
      ) : null}

      {item.alamat ? (
        <View style={styles.row}>
          <Text style={styles.rowIcon}>📍</Text>
          <Text style={styles.rowText}>{item.alamat}</Text>
        </View>
      ) : null}

      {item.catatan ? (
        <View style={styles.row}>
          <Text style={styles.rowIcon}>📝</Text>
          <Text style={styles.rowText}>{item.catatan}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.btnAction, styles.btnEdit]} onPress={() => openEditForm(item)}>
          <Text style={styles.btnActionText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnAction, styles.btnDelete]} onPress={() => handleDeleteSuplier(item)}>
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
        <Text style={styles.title}>Data Suplier</Text>
        <Text style={[styles.subtitle, { color: getSyncStatusColor() }]}>{getSyncStatusText()}</Text>
        <TouchableOpacity style={[styles.btnSync, syncing && styles.btnSyncDisabled]} onPress={handleSync} disabled={syncing}>
          {syncing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnSyncText}>🔄 Sync Data</Text>}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Cari Suplier atau Kategori"
          placeholderTextColor="#95a5a6"
          selectionColor="#2c3e50"
          value={search}
          onChangeText={(text) => searchFilter(text)}
        />
      </View>

      {/* List */}
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
              <Text style={{ fontSize: 48, marginBottom: 10 }}>🏭</Text>
              <Text style={{ color: "#888", textAlign: "center" }}>
                {dataSuplier.length > 0
                  ? "Suplier tidak ditemukan"
                  : "Belum ada data suplier.\nTekan ➕ untuk tambah suplier."}
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openAddForm}>
        <Text style={styles.fabText}>➕</Text>
      </TouchableOpacity>

      {/* MODAL FORM */}
      <Modal animationType="slide" transparent={true} visible={formModalVisible} onRequestClose={closeFormModal}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.formOverlay}>
            <View style={styles.formContent}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{editingSuplier ? "✏️ Edit Suplier" : "➕ Tambah Suplier"}</Text>
                <TouchableOpacity style={styles.btnClose} onPress={closeFormModal}>
                  <Text style={styles.btnCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.formBody} showsVerticalScrollIndicator={false}>
                <Text style={styles.formLabel}>Nama Suplier *</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.nama}
                  onChangeText={(t) => setFormData((prev) => ({ ...prev, nama: t }))}
                  placeholder="Contoh: PT. Makmur Jaya"
                  placeholderTextColor="#bdc3c7"
                />

                <Text style={styles.formLabel}>Kategori Produk</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.kategori_produk}
                  onChangeText={(t) => setFormData((prev) => ({ ...prev, kategori_produk: t }))}
                  placeholder="Contoh: Makanan, Semen, Besi"
                  placeholderTextColor="#bdc3c7"
                />

                <Text style={styles.formLabel}>Telepon / WhatsApp</Text>
                <TextInput
                  style={styles.formInput}
                  value={formData.telepon}
                  onChangeText={(t) => setFormData((prev) => ({ ...prev, telepon: t }))}
                  placeholder="Contoh: 0812345678"
                  placeholderTextColor="#bdc3c7"
                  keyboardType="phone-pad"
                />

                <Text style={styles.formLabel}>Alamat Lengkap</Text>
                <TextInput
                  style={[styles.formInput, { height: 80, textAlignVertical: "top" }]}
                  value={formData.alamat}
                  onChangeText={(t) => setFormData((prev) => ({ ...prev, alamat: t }))}
                  placeholder="Alamat kantor / gudang suplier"
                  placeholderTextColor="#bdc3c7"
                  multiline
                />

                <Text style={styles.formLabel}>Catatan</Text>
                <TextInput
                  style={[styles.formInput, { height: 60, textAlignVertical: "top" }]}
                  value={formData.catatan}
                  onChangeText={(t) => setFormData((prev) => ({ ...prev, catatan: t }))}
                  placeholder="Termin pembayaran, info penting dll"
                  placeholderTextColor="#bdc3c7"
                  multiline
                />

                <TouchableOpacity style={styles.btnSave} onPress={handleSaveSuplier}>
                  <Text style={styles.btnSaveText}>{editingSuplier ? "💾 Perbarui Suplier" : "💾 Simpan Suplier"}</Text>
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
  subtitle: {
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

  searchContainer: { paddingHorizontal: 15, paddingTop: 10, paddingBottom: 5 },
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
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 10, color: "#7f8c8d" },

  card: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 2.22,
  },
  headerCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  namaSuplier: { fontSize: 16, fontWeight: "bold", color: "#2c3e50", flex: 1, marginRight: 10 },
  badgeKategori: { backgroundColor: "#3498db", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeKategoriText: { color: "white", fontSize: 10, fontWeight: "bold" },

  row: { flexDirection: "row", marginBottom: 6, alignItems: "flex-start" },
  rowIcon: { fontSize: 14, marginRight: 6, width: 20, textAlign: "center" },
  rowText: { fontSize: 14, color: "#34495e", flex: 1 },

  actionRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, gap: 10 },
  btnAction: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, minWidth: 70, alignItems: "center" },
  btnEdit: { backgroundColor: "#f1c40f", elevation: 1 },
  btnDelete: { backgroundColor: "#e74c3c", elevation: 1 },
  btnActionText: { fontWeight: "bold", fontSize: 12, color: "#2c3e50" },

  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    backgroundColor: "#27ae60",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabText: { fontSize: 24, color: "white" },

  formOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  formContent: { backgroundColor: "#f5f6fa", borderTopLeftRadius: 20, borderTopRightRadius: 20, height: "85%", elevation: 10 },
  formHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#ecf0f1",
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  formTitle: { fontSize: 18, fontWeight: "bold", color: "#2c3e50" },
  btnClose: { width: 30, height: 30, justifyContent: "center", alignItems: "center", backgroundColor: "#ecf0f1", borderRadius: 15 },
  btnCloseText: { fontSize: 16, color: "#7f8c8d", fontWeight: "bold" },
  formBody: { padding: 20 },
  formLabel: { fontSize: 14, fontWeight: "bold", color: "#34495e", marginBottom: 8, marginTop: 10 },
  formInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#bdc3c7",
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    color: "#2c3e50",
  },
  btnSave: { backgroundColor: "#27ae60", padding: 15, borderRadius: 10, alignItems: "center", marginTop: 25, elevation: 2 },
  btnSaveText: { color: "white", fontWeight: "bold", fontSize: 16 },
});
