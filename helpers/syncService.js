import * as FileSystem from "expo-file-system/legacy";
import {
  clearTable,
  getLokalRawData,
  hardDeleteLokal,
  isFirstSync,
  setLastSyncTime,
  updateSyncStatusLokal,
  updateUUIDLokal,
  upsertLokalFromCloud,
} from "./database";
import supabase, { supabaseKey, supabaseUrl } from "./supabaseClient";

// UUID v4 generator tanpa crypto (kompatibel dengan Hermes/React Native)
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =============================================
// KOLOM YANG VALID DI SUPABASE (whitelist)
// Hanya kolom ini yang boleh dikirim ke cloud.
// Kolom lokal seperti 'id', 'sync_status', 'is_dirty' TIDAK dikirim.
// =============================================

const SUPABASE_COLUMNS = {
  products: ['uuid', 'nama', 'stok', 'satuan', 'harga', 'lokasi', 'foto_url', 'updated_at', 'is_deleted', 'id_lokal'],
  transactions: ['uuid', 'tanggal', 'total', 'detail', 'updated_at', 'is_deleted', 'id_lokal'],
  piutang: ['uuid', 'nama_pembeli', 'alamat', 'tanggal', 'total', 'detail', 'status', 'updated_at', 'is_deleted', 'id_lokal'],
};

/**
 * Filter payload agar hanya berisi kolom yang ada di Supabase.
 * Mencegah error "Could not find column 'xxx' in the schema cache".
 */
function buildCloudPayload(tableName, row) {
  const allowedColumns = SUPABASE_COLUMNS[tableName] || [];
  const payload = {};
  for (const col of allowedColumns) {
    if (row[col] !== undefined) {
      payload[col] = row[col];
    }
  }
  return payload;
}

// =============================================
// FOTO HELPERS
// =============================================

/**
 * Upload foto base64 ke Supabase Storage, return public URL.
 * Menggunakan FileSystem.uploadAsync (native Expo) untuk reliability di React Native.
 */
async function uploadFoto(uuid, base64String) {
  if (!base64String || !base64String.startsWith("data:image")) return null;

  const tempPath = `${FileSystem.cacheDirectory}upload_${uuid}_${Date.now()}.jpg`;

  try {
    // 1. Ekstrak base64 murni (hapus prefix data:image/xxx;base64,)
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");

    // 2. Tulis base64 ke file temp
    await FileSystem.writeAsStringAsync(tempPath, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const fileName = `${uuid}.jpg`;

    // 3. Upload file via Expo FileSystem.uploadAsync (cara paling reliable di RN)
    //    Langsung ke Supabase Storage REST API
    const uploadUrl = `${supabaseUrl}/storage/v1/object/product-photos/${fileName}`;

    const uploadResult = await FileSystem.uploadAsync(uploadUrl, tempPath, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        "Content-Type": "image/jpeg",
        "x-upsert": "true",
      },
    });

    if (uploadResult.status !== 200) {
      throw new Error(`Upload status: ${uploadResult.status} - ${uploadResult.body}`);
    }

    // 4. Dapatkan public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("product-photos").getPublicUrl(fileName);

    const finalUrl = `${publicUrl}?t=${Date.now()}`;
    console.log(`[FOTO] Upload berhasil: ${finalUrl}`);
    return finalUrl;
  } catch (err) {
    console.error("[FOTO] Gagal upload foto:", err.message);
    return null;
  } finally {
    // Hapus file temp
    try {
      await FileSystem.deleteAsync(tempPath, { idempotent: true });
    } catch (e) {}
  }
}

/**
 * Download foto dari URL dan convert ke base64 untuk offline cache.
 */
async function downloadFoto(url) {
  if (!url) return null;
  try {
    // Gunakan expo-file-system untuk download
    const tempPath = `${FileSystem.cacheDirectory}temp_foto_${Date.now()}.jpg`;
    const downloadResult = await FileSystem.downloadAsync(url, tempPath);
    
    if (downloadResult.status !== 200) return null;
    
    const base64 = await FileSystem.readAsStringAsync(tempPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Hapus file temp
    try { await FileSystem.deleteAsync(tempPath, { idempotent: true }); } catch (e) {}
    
    return `data:image/jpeg;base64,${base64}`;
  } catch (err) {
    console.error("Gagal download foto:", err.message);
    return null;
  }
}

// =============================================
// PUSH SYNC (LOKAL → CLOUD)
// =============================================

async function pushSyncTable(db, tableName) {
  console.log(`[PUSH] Memulai Push Sync: ${tableName}`);
  const rows = await getLokalRawData(db, tableName);
  const pendingRows = rows.filter((r) => r.sync_status !== "synced");

  if (pendingRows.length === 0) {
    console.log(`[PUSH] Tidak ada data pending: ${tableName}`);
    return;
  }

  console.log(`[PUSH] ${pendingRows.length} baris pending di ${tableName}`);

  for (let row of pendingRows) {
    try {
      let id_lokal = row.id;
      let uuid = row.uuid;

      // Generate UUID jika belum ada
      if (!uuid) {
        uuid = uuidv4();
        await updateUUIDLokal(db, tableName, id_lokal, uuid);
      }

      let statusLokal = row.sync_status;

      if (statusLokal === "deleted") {
        // Soft delete di cloud, hard delete di lokal
        const { error } = await supabase
          .from(tableName)
          .update({
            is_deleted: true,
            updated_at: new Date().toISOString(),
          })
          .eq("uuid", uuid);

        if (!error) {
          await hardDeleteLokal(db, tableName, id_lokal);
          console.log(`[PUSH] HAPUS permanen lokal: ${uuid}`);
        } else {
          console.log(`[PUSH] Error delete ${uuid}:`, error.message);
        }
      } else if (
        statusLokal === "pending_insert" ||
        statusLokal === "pending_update"
      ) {
        // Build payload yang bersih (hanya kolom Supabase)
        // PENTING: updated_at diset ke waktu SYNC (bukan waktu edit lokal)
        // agar desktop selalu mendeteksi data cloud sebagai lebih baru
        const syncTimestamp = new Date().toISOString();
        let payload = buildCloudPayload(tableName, {
          ...row,
          uuid: uuid,
          id_lokal: id_lokal,
          is_deleted: false,
          updated_at: syncTimestamp,
        });

        // --- KHUSUS PRODUK: TANGANI FOTO ---
        if (tableName === "products") {
          if (row.foto && row.foto.startsWith("data:image")) {
            console.log(`[PUSH] Uploading foto: ${uuid}`);
            const url = await uploadFoto(uuid, row.foto);
            if (url) {
              payload.foto_url = url;
            }
          } else if (row.foto && row.foto.startsWith("http")) {
            payload.foto_url = row.foto;
          }
          // foto_url sudah di-set, 'foto' tidak ada di whitelist jadi sudah terfilter
        }

        // UPSERT ke cloud
        const { error } = await supabase
          .from(tableName)
          .upsert(payload, { onConflict: "uuid" });

        if (!error) {
          await updateSyncStatusLokal(db, tableName, id_lokal, "synced");
          console.log(`[PUSH] Selesai upsert: ${uuid}`);
        } else {
          console.log(`[PUSH] Error upsert ${uuid}:`, error.message);
        }
      }
    } catch (e) {
      console.error(`[PUSH] Error untuk ${row.uuid}:`, e);
    }
  }
}

// =============================================
// PULL SYNC (CLOUD → LOKAL)
// =============================================

async function pullSyncTable(db, tableName) {
  console.log(`[PULL] Memulai Pull Sync: ${tableName}`);

  const rows = await getLokalRawData(db, tableName);

  const { data: cloudData, error } = await supabase
    .from(tableName)
    .select("*");

  if (error) {
    console.error(`[PULL] Error load dari Supabase:`, error.message);
    return;
  }

  for (let cloudRow of cloudData) {
    let lokalMatched = rows.find((r) => r.uuid === cloudRow.uuid);

    // 1. Data cloud dihapus
    if (cloudRow.is_deleted) {
      if (lokalMatched) {
        await hardDeleteLokal(db, tableName, lokalMatched.id);
      }
      continue;
    }

    // 2. Cek apakah data cloud lebih baru
    let isCloudNewer =
      !lokalMatched ||
      new Date(cloudRow.updated_at) > new Date(lokalMatched.updated_at);

    // Dedup fallback: cek berdasarkan nama (untuk data lama yang UUID-nya beda)
    if (!lokalMatched && cloudRow.nama) {
      let possibleDuplicate = rows.find((r) => r.nama === cloudRow.nama);
      if (possibleDuplicate) {
        await updateUUIDLokal(
          db,
          tableName,
          possibleDuplicate.id,
          cloudRow.uuid
        );
        lokalMatched = possibleDuplicate;
        isCloudNewer =
          new Date(cloudRow.updated_at) > new Date(lokalMatched.updated_at);
      }
    }

    // Jangan timpa data lokal yang pending (belum di-push)
    if (
      lokalMatched &&
      lokalMatched.sync_status !== "synced" &&
      new Date(cloudRow.updated_at) <= new Date(lokalMatched.updated_at)
    ) {
      isCloudNewer = false;
    }

    if (isCloudNewer) {
      let insertPayload = { ...cloudRow };
      delete insertPayload.id_lokal;
      delete insertPayload.is_deleted;

      // --- KHUSUS PRODUK: TANGANI FOTO URL → BASE64 ---
      if (tableName === "products") {
        if (insertPayload.foto_url) {
          console.log(`[PULL] Downloading foto: ${insertPayload.uuid}`);
          const localBase64 = await downloadFoto(insertPayload.foto_url);
          if (localBase64) {
            insertPayload.foto = localBase64;
          } else {
            insertPayload.foto = insertPayload.foto_url; // Fallback: simpan URL
          }
        }
        delete insertPayload.foto_url;
      }

      await upsertLokalFromCloud(db, tableName, insertPayload);
      console.log(`[PULL] Berhasil pull: ${insertPayload.uuid}`);
    }
  }
}

// =============================================
// FUNGSI UTAMA
// =============================================

/**
 * Jalankan sinkronisasi penuh (push lalu pull) untuk semua tabel.
 */
export async function performFullSync(db) {
  try {
    console.log("=== MEMULAI SINKRONISASI ===");

    const tables = ["products", "transactions", "piutang"];

    // Cek apakah pertama kali sync (fresh start strategy)
    const firstSync = await isFirstSync(db);
    if (firstSync) {
      console.log("[SYNC] Pertama kali sync. Menerapkan Fresh Start...");
      // Clear SEMUA data lama (termasuk yang punya UUID dari import desktop)
      for (const table of tables) {
        await clearTable(db, table);
        console.log(`[SYNC] Tabel ${table} dikosongkan untuk fresh pull.`);
      }
      // Langsung pull dari cloud (tanpa push)
      for (const table of tables) {
        await pullSyncTable(db, table);
      }
    } else {
      // Sync normal: push dulu lalu pull
      for (const table of tables) {
        await pushSyncTable(db, table);
        await pullSyncTable(db, table);
      }
    }

    // Tandai bahwa sync pernah dilakukan
    await setLastSyncTime(db);

    console.log("=== SINKRONISASI SELESAI ===");
    return { success: true };
  } catch (err) {
    console.error("=== GAGAL SINKRONISASI ===", err);
    return { success: false, error: err.message };
  }
}
