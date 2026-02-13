import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";

const DB_NAME = "toko_mobile.db";

/**
 * Cek apakah file database sudah ada.
 */
export async function isDatabaseExists() {
  try {
    if (!FileSystem.documentDirectory) return false;
    const sqliteFolder = `${FileSystem.documentDirectory}SQLite`;
    const targetPath = `${sqliteFolder}/${DB_NAME}`;
    const fileInfo = await FileSystem.getInfoAsync(targetPath);
    return fileInfo.exists;
  } catch (e) {
    return false;
  }
}

/**
 * Membuka koneksi database baru setiap kali dipanggil.
 * Menggunakan useNewConnection: true untuk menghindari NullPointerException di Android.
 * Caller HARUS memanggil closeAsync() setelah selesai menggunakan database.
 */
export async function openDB() {
  try {
    const exists = await isDatabaseExists();
    if (!exists) return null;

    const db = await SQLite.openDatabaseAsync(DB_NAME, {
      useNewConnection: true,
    });
    return db;
  } catch (e) {
    console.log("Error openDB:", e);
    return null;
  }
}
