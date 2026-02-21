import * as SQLite from "expo-sqlite";
import { v4 as uuidv4 } from "uuid";

const DB_NAME = "toko_mobile.db";

/**
 * Membuka koneksi database dan memastikan tabel siap (migrasi otomatis).
 * Caller HARUS memanggil closeAsync() setelah selesai.
 */
export async function openDB() {
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME, {
      useNewConnection: true,
    });

    // Pastikan tabel siap setiap kali buka
    await initDB(db);
    return db;
  } catch (e) {
    console.log("Error openDB:", e);
    return null;
  }
}

/**
 * Inisialisasi / migrasi tabel database.
 * Membuat tabel jika belum ada, dan menambah kolom sync jika diperlukan.
 */
async function initDB(db) {
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,
        nama TEXT NOT NULL,
        stok REAL DEFAULT 0,
        satuan TEXT,
        harga INTEGER DEFAULT 0,
        lokasi TEXT,
        foto TEXT,
        sync_status TEXT DEFAULT 'pending_insert',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,
        tanggal TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        detail TEXT,
        sync_status TEXT DEFAULT 'pending_insert',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS piutang (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE,
        nama_pembeli TEXT NOT NULL,
        alamat TEXT,
        tanggal TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        detail TEXT,
        status TEXT DEFAULT 'belum lunas',
        sync_status TEXT DEFAULT 'pending_insert',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // Migrasi: cek dan tambah kolom yang mungkin belum ada di database lama (yang di-import)
    const tables = ['products', 'transactions', 'piutang'];
    const newColumns = [
      { name: 'uuid', type: 'TEXT' },
      { name: 'sync_status', type: "TEXT DEFAULT 'pending_insert'" },
      { name: 'updated_at', type: 'TEXT' },
    ];

    for (const table of tables) {
      const columnsInfo = await db.getAllAsync(`PRAGMA table_info(${table})`);
      const existingCols = columnsInfo.map(c => c.name);

      for (const col of newColumns) {
        if (!existingCols.includes(col.name)) {
          try {
            await db.runAsync(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
            console.log(`Kolom ${col.name} ditambahkan ke ${table}`);
          } catch (e) {
            // Abaikan jika kolom sudah ada
          }
        }
      }

      // Tambah kolom 'foto' untuk products jika belum ada
      if (table === 'products' && !existingCols.includes('foto')) {
        try {
          await db.runAsync(`ALTER TABLE products ADD COLUMN foto TEXT`);
        } catch (e) {}
      }

      // Tambah kolom 'alamat' untuk piutang jika belum ada
      if (table === 'piutang' && !existingCols.includes('alamat')) {
        try {
          await db.runAsync(`ALTER TABLE piutang ADD COLUMN alamat TEXT`);
        } catch (e) {}
      }
    }
  } catch (e) {
    console.log("Error initDB:", e);
  }
}

// =============================================
// CRUD PRODUK
// =============================================

/**
 * Ambil semua produk yang belum dihapus (soft-delete).
 */
export async function getProducts(db) {
  return await db.getAllAsync(
    "SELECT * FROM products WHERE sync_status != 'deleted' ORDER BY nama ASC"
  );
}

/**
 * Tambah produk baru.
 */
export async function addProduct(db, { nama, stok, satuan, harga, lokasi, foto }) {
  const newUuid = uuidv4();
  const updated_at = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO products (uuid, nama, stok, satuan, harga, lokasi, foto, sync_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_insert', ?)`,
    [newUuid, nama, stok || 0, satuan || '', harga || 0, lokasi || '', foto || null, updated_at]
  );
}

/**
 * Update produk yang sudah ada.
 */
export async function updateProduct(db, id, { nama, stok, satuan, harga, lokasi, foto }) {
  const updated_at = new Date().toISOString();
  await db.runAsync(
    `UPDATE products SET nama = ?, stok = ?, satuan = ?, harga = ?, lokasi = ?, foto = ?,
     sync_status = CASE WHEN sync_status = 'pending_insert' THEN 'pending_insert' ELSE 'pending_update' END,
     updated_at = ? WHERE id = ?`,
    [nama, stok || 0, satuan || '', harga || 0, lokasi || '', foto || null, updated_at, id]
  );
}

/**
 * Hapus produk (soft-delete — tetap di DB tapi ditandai 'deleted').
 */
export async function deleteProduct(db, id) {
  const updated_at = new Date().toISOString();
  await db.runAsync(
    "UPDATE products SET sync_status = 'deleted', updated_at = ? WHERE id = ?",
    [updated_at, id]
  );
}

// =============================================
// FUNGSI SYNC HELPER (digunakan oleh syncService)
// =============================================

/**
 * Ambil SEMUA data dari tabel tertentu (termasuk yang deleted), untuk kebutuhan sync.
 */
export async function getLokalRawData(db, table) {
  return await db.getAllAsync(`SELECT * FROM ${table}`);
}

/**
 * Update status sync sebuah record.
 */
export async function updateSyncStatusLokal(db, table, id, status) {
  await db.runAsync(`UPDATE ${table} SET sync_status = ? WHERE id = ?`, [status, id]);
}

/**
 * Update UUID lokal (untuk menghubungkan data lokal lama dengan cloud).
 */
export async function updateUUIDLokal(db, table, id, newUuid) {
  await db.runAsync(`UPDATE ${table} SET uuid = ? WHERE id = ?`, [newUuid, id]);
}

/**
 * Hard delete — benar-benar hapus row dari database lokal (setelah berhasil sync delete ke cloud).
 */
export async function hardDeleteLokal(db, table, id) {
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

/**
 * Upsert data dari cloud ke lokal.
 * Jika UUID sudah ada → Update, jika belum → Insert.
 */
export async function upsertLokalFromCloud(db, table, data) {
  const existing = await db.getFirstAsync(
    `SELECT id FROM ${table} WHERE uuid = ?`,
    [data.uuid]
  );

  const keys = Object.keys(data);
  const values = Object.values(data);

  if (existing) {
    // UPDATE
    const setString = keys.map(k => `${k} = ?`).join(', ');
    values.push(existing.id);
    await db.runAsync(
      `UPDATE ${table} SET ${setString}, sync_status = 'synced' WHERE id = ?`,
      values
    );
  } else {
    // INSERT
    const placeholders = keys.map(() => '?').join(',');
    await db.runAsync(
      `INSERT INTO ${table} (${keys.join(',')}, sync_status) VALUES (${placeholders}, 'synced')`,
      values
    );
  }
}

/**
 * Clear semua data dari tabel tertentu (untuk fresh start sync).
 */
export async function clearTable(db, table) {
  await db.runAsync(`DELETE FROM ${table}`);
}

/**
 * Cek apakah mobile app pernah sync sebelumnya.
 * Menggunakan tabel sync_meta, bukan cek UUID (karena data import dari desktop sudah punya UUID).
 */
export async function isFirstSync(db) {
  try {
    const result = await db.getFirstAsync(
      "SELECT value FROM sync_meta WHERE key = 'last_sync_time'"
    );
    return !result || !result.value;
  } catch (e) {
    return true; // Jika tabel belum ada, berarti belum pernah sync
  }
}

/**
 * Simpan waktu sync terakhir.
 */
export async function setLastSyncTime(db) {
  const now = new Date().toISOString();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync_time', ?)",
    [now]
  );
}

/**
 * Ambil waktu sync terakhir.
 */
export async function getLastSyncTime(db) {
  try {
    const result = await db.getFirstAsync(
      "SELECT value FROM sync_meta WHERE key = 'last_sync_time'"
    );
    return result ? result.value : null;
  } catch (e) {
    return null;
  }
}
