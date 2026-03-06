import * as SQLite from "expo-sqlite";

// UUID v4 generator tanpa crypto (kompatibel dengan Hermes/React Native)
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
        catatan TEXT,
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
        } catch (e) { }
      }

      // Tambah kolom 'alamat' untuk piutang jika belum ada
      if (table === 'piutang' && !existingCols.includes('alamat')) {
        try {
          await db.runAsync(`ALTER TABLE piutang ADD COLUMN alamat TEXT`);
        } catch (e) { }
      }

      // Tambah kolom 'catatan' untuk piutang jika belum ada
      if (table === 'piutang' && !existingCols.includes('catatan')) {
        try {
          await db.runAsync(`ALTER TABLE piutang ADD COLUMN catatan TEXT`);
          console.log(`Kolom catatan ditambahkan ke piutang`);
        } catch (e) { }
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
// CRUD PIUTANG
// =============================================

/**
 * Tambah piutang baru.
 */
export async function addPiutang(db, { nama_pembeli, alamat, tanggal, total, detail, catatan }) {
  const newUuid = uuidv4();
  const updated_at = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO piutang (uuid, nama_pembeli, alamat, tanggal, total, detail, catatan, status, sync_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'belum lunas', 'pending_insert', ?)`,
    [newUuid, nama_pembeli, alamat || '', tanggal, total || 0, detail || null, catatan || null, updated_at]
  );
}

/**
 * Hapus piutang (soft-delete).
 */
export async function deletePiutang(db, id) {
  const updated_at = new Date().toISOString();
  await db.runAsync(
    "UPDATE piutang SET sync_status = 'deleted', updated_at = ? WHERE id = ?",
    [updated_at, id]
  );
}

/**
 * Tandai piutang sebagai lunas.
 * Melakukan: update status, kurangi stok produk, tambah riwayat transaksi.
 */
export async function markPiutangLunas(db, piutang) {
  const updated_at = new Date().toISOString();
  const transactionId = uuidv4();

  // 1. Update status piutang
  await db.runAsync(
    "UPDATE piutang SET status = 'lunas', sync_status = 'pending_update', updated_at = ? WHERE id = ?",
    [updated_at, piutang.id]
  );

  // 2. Kurangi stok produk & Generate riwayat transaksi (jika ada detail produk)
  if (piutang.detail) {
    try {
      const details = JSON.parse(piutang.detail);
      if (Array.isArray(details)) {
        for (const item of details) {
          // Kurangi stok per produk
          // Catatan: item.nama atau uuid produk sebaiknya digunakan, tapi di sini diasumsikan 
          // filter berdasarkan nama cukup atau jika ada id_produk/uuid_produk di detail.
          // Menggunakan nama karena itu yang ada di detail JSON saat ini.
          if (item.nama) {
            await db.runAsync(
              `UPDATE products SET stok = stok - ?, sync_status = CASE WHEN sync_status = 'pending_insert' THEN 'pending_insert' ELSE 'pending_update' END, updated_at = ? WHERE nama = ?`,
              [item.qty || 0, updated_at, item.nama]
            );
          }
        }
      }
    } catch (e) {
      console.error("Error parsing piutang detail for stock update:", e);
    }
  }

  // 3. Masukkan ke riwayat transaksi
  await db.runAsync(
    `INSERT INTO transactions (uuid, tanggal, total, detail, sync_status, updated_at)
     VALUES (?, ?, ?, ?, 'pending_insert', ?)`,
    [transactionId, piutang.tanggal, piutang.total, piutang.detail, updated_at]
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
