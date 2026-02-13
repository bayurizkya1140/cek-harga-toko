import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";

const DB_NAME = "toko_mobile.db";

let _db = null;

/**
 * Mendapatkan koneksi database yang sudah terbuka.
 * Jika belum ada, akan membuka koneksi baru.
 * Mengembalikan null jika file database belum ada.
 */
export async function getDatabase() {
  try {
    if (!FileSystem.documentDirectory) return null;

    const sqliteFolder = `${FileSystem.documentDirectory}SQLite`;
    const targetPath = `${sqliteFolder}/${DB_NAME}`;

    const fileInfo = await FileSystem.getInfoAsync(targetPath);
    if (!fileInfo.exists) {
      return null;
    }

    // Jika sudah ada koneksi, gunakan yang ada
    if (_db) {
      return _db;
    }

    // Buka koneksi baru
    _db = await SQLite.openDatabaseAsync(DB_NAME);
    return _db;
  } catch (e) {
    console.log("Error getDatabase:", e);
    return null;
  }
}

/**
 * Menutup koneksi database dan reset.
 * Dipanggil saat import database baru.
 */
export async function closeDatabase() {
  if (_db) {
    try {
      await _db.closeAsync();
    } catch (e) {
      console.log("Error closeDatabase:", e);
    }
    _db = null;
  }
}

/**
 * Reset koneksi (tutup lalu buka ulang).
 * Dipanggil setelah import database baru.
 */
export async function resetDatabase() {
  await closeDatabase();
  return await getDatabase();
}
