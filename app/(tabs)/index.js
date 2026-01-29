import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// --- IMPORT LIBRARY ---
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
// ----------------------

import { StatusBar } from 'expo-status-bar';

export default function App() {
  const [dataProduk, setDataProduk] = useState([]);
  const [filterData, setFilterData] = useState([]);
  const [search, setSearch] = useState('');
  const [dbName, setDbName] = useState('Memuat data...');
  const [db, setDb] = useState(null);

  // --- AUTO LOAD SAAT APLIKASI DIBUKA ---
  useEffect(() => {
    cekDatabaseTersimpan();
  }, []);

  const cekDatabaseTersimpan = async () => {
    try {
      if (!FileSystem.documentDirectory) return;

      const internalDbName = 'toko_mobile.db';
      const sqliteFolder = `${FileSystem.documentDirectory}SQLite`;
      const targetPath = `${sqliteFolder}/${internalDbName}`;

      const fileInfo = await FileSystem.getInfoAsync(targetPath);
      
      if (fileInfo.exists) {
        // Buka database
        const database = await SQLite.openDatabaseAsync(internalDbName);
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
        type: '*/*', 
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const internalDbName = 'toko_mobile.db'; 
      
      if (!FileSystem.documentDirectory) {
        Alert.alert("Error", "Gagal membaca sistem file HP.");
        return;
      }
      
      const sqliteFolder = `${FileSystem.documentDirectory}SQLite`;
      const folderInfo = await FileSystem.getInfoAsync(sqliteFolder);
      if (!folderInfo.exists) {
        await FileSystem.makeDirectoryAsync(sqliteFolder, { intermediates: true });
      }

      const targetPath = `${sqliteFolder}/${internalDbName}`;

      // --- PERBAIKAN UTAMA: TUTUP KONEKSI LAMA DULU ---
      if (db) {
        try {
            await db.closeAsync(); // Tutup koneksi agar file dilepas
            setDb(null); // Kosongkan state
        } catch (e) {
            console.log("Gagal menutup db lama:", e);
        }
      }
      // ------------------------------------------------

      // Hapus database lama
      const fileInfo = await FileSystem.getInfoAsync(targetPath);
      if (fileInfo.exists) {
          await FileSystem.deleteAsync(targetPath, { idempotent: true });
      }

      // Copy file baru
      await FileSystem.copyAsync({
        from: file.uri,
        to: targetPath
      });

      // Buka koneksi BARU
      const database = await SQLite.openDatabaseAsync(internalDbName);
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

      const result = await database.getAllAsync('SELECT * FROM products ORDER BY nama ASC');
      setDataProduk(result);
      setFilterData(result);
      
      // Jika sedang ada pencarian, langsung filter ulang
      if (search) {
         const newData = result.filter(item => {
            const itemData = item.nama ? item.nama.toUpperCase() : ''.toUpperCase();
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
      const newData = dataProduk.filter(item => {
        const itemData = item.nama ? item.nama.toUpperCase() : ''.toUpperCase();
        const textData = text.toUpperCase();
        return itemData.indexOf(textData) > -1;
      });
      setFilterData(newData);
    } else {
      setFilterData(dataProduk);
    }
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
        <Text style={styles.harga}>Rp {item.harga ? item.harga.toLocaleString('id-ID') : 0}</Text>
      </View>
      
      <View style={styles.row}>
        <Text style={styles.label}>Stok:</Text>
        <Text style={styles.stok}>{item.stok} {item.satuan}</Text>
      </View>
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
        contentContainerStyle={{ paddingBottom: 50 }}
        ListEmptyComponent={
          <View style={{marginTop: 50, alignItems:'center'}}>
             <Text style={{color:'#888'}}>
               {db ? "Barang tidak ditemukan" : "Data belum ada. Silakan Import."}
             </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6fa' },
  header: { 
    backgroundColor: '#2c3e50', padding: 20, 
    paddingTop: Platform.OS === 'android' ? 40 : 20, 
    alignItems: 'center', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 
  },
  title: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: '#bdc3c7', fontSize: 12, marginBottom: 15, marginTop: 5 },
  btnImport: { backgroundColor: '#27ae60', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 25, elevation: 3 },
  btnText: { color: 'white', fontWeight: 'bold' },
  
  searchContainer: { padding: 15 },
  searchInput: { 
    height: 50, backgroundColor: 'white', borderRadius: 10, 
    paddingHorizontal: 15, fontSize: 16, elevation: 2 
  },

  card: { backgroundColor: 'white', marginHorizontal: 15, marginBottom: 10, padding: 15, borderRadius: 12, elevation: 2 },
  headerCard: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f1f1', paddingBottom: 8 },
  namaBarang: { fontSize: 18, fontWeight: 'bold', color: '#333', flex: 1 },
  lokasi: { fontSize: 12, color: '#d35400', fontWeight: 'bold', backgroundColor: '#ffe0b2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start', marginLeft: 5 },
  
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  label: { color: '#7f8c8d' },
  harga: { color: '#27ae60', fontWeight: 'bold', fontSize: 18 },
  stok: { color: '#333', fontWeight: 'bold', fontSize: 14 }
});