import { useCallback, useRef, useState } from "react";
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
import { StatusBar } from "expo-status-bar";
import {
  addTransactionKasir,
  getProductFoto,
  getProducts,
  openDB,
} from "../../helpers/database";
import { performFullSync } from "../../helpers/syncService";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

// Helper: format angka dengan titik ribuan (1000 → 1.000)
const formatRibuan = (num) => {
  if (!num && num !== 0) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Helper: hapus titik dari string harga (1.000 → 1000)
const parseHarga = (str) => {
  if (!str) return 0;
  return parseInt(str.replace(/\./g, "")) || 0;
};

// Helper: format rupiah
const formatRupiah = (num) => {
  if (!num && num !== 0) return "Rp 0";
  return "Rp " + Number(num).toLocaleString("id-ID");
};

// Helper: tanggal hari ini
const getTodayString = () => {
  return new Date().toLocaleString("id-ID");
};

const getTodayDisplay = () => {
  const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  return new Date().toLocaleDateString("id-ID", options);
};

// Satuan kontinu (berat/panjang/volume) → increment 0.5, izinkan desimal
// Satuan diskrit (pcs, sak, dus, dll) → increment 1, hanya bilangan bulat
const CONTINUOUS_UNITS = ["kg", "meter", "liter", "roll"];

const getQtyStep = (satuan) => {
  const s = (satuan || "pcs").toLowerCase();
  return CONTINUOUS_UNITS.includes(s) ? 0.5 : 1;
};

const isContinuousUnit = (satuan) => {
  const s = (satuan || "pcs").toLowerCase();
  return CONTINUOUS_UNITS.includes(s);
};

export default function KasirScreen() {
  // Keranjang belanja
  const [cart, setCart] = useState([]);

  // Data produk
  const [allProducts, setAllProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Modal: Product Picker
  const [pickerVisible, setPickerVisible] = useState(false);

  // Modal: Qty Input (saat tambah dari picker)
  const [qtyModalVisible, setQtyModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qtyInput, setQtyInput] = useState("1");

  // Modal: Edit Qty (saat edit item di keranjang)
  const [editQtyModalVisible, setEditQtyModalVisible] = useState(false);
  const [editingCartIndex, setEditingCartIndex] = useState(null);
  const [editQtyInput, setEditQtyInput] = useState("1");

  // Modal: Foto Preview
  const [fotoModalVisible, setFotoModalVisible] = useState(false);
  const [fotoProduct, setFotoProduct] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  // Modal: Pembayaran
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [bayarInput, setBayarInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Modal: Struk / Receipt
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");

  // Ref
  const hasLoadedRef = useRef(false);
  const hasAutoSynced = useRef(false);

  // Auto load saat fokus
  useFocusEffect(
    useCallback(() => {
      const init = async () => {
        if (!hasLoadedRef.current) {
          hasLoadedRef.current = true;
          await loadProducts();
        }
        if (!hasAutoSynced.current) {
          hasAutoSynced.current = true;
          handleSync(true); // true = auto-sync (tanpa Alert popup)
        }
      };
      init();
    }, [])
  );

  // ======= LOAD PRODUCTS =======
  const loadProducts = async () => {
    try {
      setLoading(true);
      const database = await openDB();
      if (!database) {
        setLoading(false);
        return;
      }
      const result = await getProducts(database);
      setAllProducts(result);
      setFilteredProducts(result);
      setLoading(false);
    } catch (e) {
      console.log("Kasir: Gagal load produk:", e);
      setLoading(false);
    }
  };

  // ======= SYNC =======
  const handleSync = async (isAuto = false) => {
    if (syncing) return;
    try {
      setSyncing(true);
      setSyncStatus("syncing");

      const database = await openDB();
      if (!database) {
        if (!isAuto) Alert.alert("Error", "Gagal membuka database");
        setSyncStatus("error");
        return;
      }

      console.log(`[SYNC] Memulai sinkronisasi kasir ${isAuto ? "otomatis" : "manual"}...`);
      const result = await performFullSync(database);

      if (result.success) {
        setSyncStatus("success");
        // Reload data setelah sync
        const freshData = await getProducts(database);
        setAllProducts(freshData);
        if (productSearch) {
          const filtered = freshData.filter((p) =>
            p.nama.toUpperCase().includes(productSearch.toUpperCase())
          );
          setFilteredProducts(filtered);
        } else {
          setFilteredProducts(freshData);
        }
        if (!isAuto) Alert.alert("Sukses", "Sinkronisasi berhasil! ✅");
        console.log(`[SYNC] Sinkronisasi kasir ${isAuto ? "otomatis" : "manual"} berhasil ✅`);
      } else {
        setSyncStatus("error");
        if (!isAuto) Alert.alert("Gagal", "Sync gagal: " + (result.error || "Unknown error"));
        console.log(`[SYNC] Sinkronisasi kasir ${isAuto ? "otomatis" : "manual"} gagal:`, result.error);
      }
    } catch (err) {
      console.log("Sync error:", err);
      setSyncStatus("error");
      if (!isAuto) Alert.alert("Error", "Terjadi kesalahan saat sync: " + err.message);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus("idle"), 3000);
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "syncing": return "🔄 Menyinkronkan...";
      case "success": return "✅ Tersinkronisasi";
      case "error": return "❌ Sync Gagal";
      default: return getTodayDisplay();
    }
  };

  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case "syncing": return "#f39c12";
      case "success": return "#2ecc71";
      case "error": return "#e74c3c";
      default: return "rgba(255,255,255,0.65)";
    }
  };

  // ======= PRODUCT PICKER =======
  const openPicker = async () => {
    setProductSearch("");
    // Reload products fresh setiap buka picker
    try {
      const database = await openDB();
      if (database) {
        const result = await getProducts(database);
        setAllProducts(result);
        setFilteredProducts(result);
      }
    } catch (e) {
      console.log("Error reload products:", e);
    }
    setPickerVisible(true);
  };

  const handleProductSearch = (text) => {
    setProductSearch(text);
    if (text) {
      const filtered = allProducts.filter((p) =>
        p.nama.toUpperCase().includes(text.toUpperCase())
      );
      setFilteredProducts(filtered);
    } else {
      setFilteredProducts(allProducts);
    }
  };

  // ======= FOTO PREVIEW =======
  const openFotoPreview = async (product) => {
    setFotoProduct({ ...product, foto: null });
    setImageLoading(true);
    setFotoModalVisible(true);
    try {
      const database = await openDB();
      if (database) {
        const foto = await getProductFoto(database, product.id);
        setFotoProduct({ ...product, foto });
      }
    } catch (e) {
      console.log("Error loading foto:", e);
    }
  };

  // ======= QTY INPUT (dari picker) =======
  const openQtyModal = (product) => {
    setSelectedProduct(product);
    setQtyInput("1");
    setQtyModalVisible(true);
  };

  const addToCart = () => {
    const qty = parseFloat(qtyInput) || 0;
    if (qty <= 0) {
      Alert.alert("Error", "Jumlah harus lebih dari 0");
      return;
    }

    // Cek stok
    const currentInCart = cart
      .filter((c) => c.nama === selectedProduct.nama)
      .reduce((sum, c) => sum + c.qty, 0);
    const availableStok = (selectedProduct.stok || 0) - currentInCart;

    if (qty > availableStok) {
      Alert.alert(
        "Stok Tidak Cukup",
        `Stok ${selectedProduct.nama} tersedia: ${availableStok} ${selectedProduct.satuan || "pcs"}\nSudah di keranjang: ${currentInCart}`
      );
      return;
    }

    // Cek apakah produk sudah ada di keranjang
    const existingIndex = cart.findIndex((c) => c.nama === selectedProduct.nama);
    if (existingIndex >= 0) {
      // Update qty
      const updatedCart = [...cart];
      updatedCart[existingIndex].qty += qty;
      updatedCart[existingIndex].subtotal =
        updatedCart[existingIndex].qty * updatedCart[existingIndex].harga;
      setCart(updatedCart);
    } else {
      // Tambah baru
      const newItem = {
        nama: selectedProduct.nama,
        harga: selectedProduct.harga || 0,
        qty: qty,
        satuan: selectedProduct.satuan || "pcs",
        subtotal: (selectedProduct.harga || 0) * qty,
        stok: selectedProduct.stok || 0,
        has_foto: selectedProduct.has_foto,
        id: selectedProduct.id,
      };
      setCart((prev) => [...prev, newItem]);
    }

    setQtyModalVisible(false);
    setPickerVisible(false);
    setProductSearch("");
  };

  // ======= EDIT QTY (di keranjang) =======
  const openEditQty = (index) => {
    setEditingCartIndex(index);
    setEditQtyInput(cart[index].qty.toString());
    setEditQtyModalVisible(true);
  };

  const saveEditQty = () => {
    const qty = parseFloat(editQtyInput) || 0;
    if (qty <= 0) {
      Alert.alert("Error", "Jumlah harus lebih dari 0");
      return;
    }

    const item = cart[editingCartIndex];
    // Cek stok (kurangi qty item lain dengan nama sama)
    const otherQty = cart
      .filter((c, i) => c.nama === item.nama && i !== editingCartIndex)
      .reduce((sum, c) => sum + c.qty, 0);
    const availableStok = item.stok - otherQty;

    if (qty > availableStok) {
      Alert.alert(
        "Stok Tidak Cukup",
        `Stok ${item.nama} tersedia: ${availableStok} ${item.satuan}`
      );
      return;
    }

    const updatedCart = [...cart];
    updatedCart[editingCartIndex].qty = qty;
    updatedCart[editingCartIndex].subtotal = qty * updatedCart[editingCartIndex].harga;
    setCart(updatedCart);
    setEditQtyModalVisible(false);
  };

  // ======= HAPUS ITEM =======
  const removeFromCart = (index) => {
    Alert.alert("Hapus Item", `Hapus "${cart[index].nama}" dari keranjang?`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: () => {
          const updated = [...cart];
          updated.splice(index, 1);
          setCart(updated);
        },
      },
    ]);
  };

  // ======= TOTAL =======
  const getGrandTotal = () => {
    return cart.reduce((sum, item) => sum + item.subtotal, 0);
  };

  // ======= PEMBAYARAN =======
  const openPayment = () => {
    if (cart.length === 0) {
      Alert.alert("Keranjang Kosong", "Tambahkan produk terlebih dahulu");
      return;
    }
    setBayarInput("");
    setPaymentModalVisible(true);
  };

  const getKembalian = () => {
    const bayar = parseHarga(bayarInput);
    const total = getGrandTotal();
    return bayar - total;
  };

  const handleSelesaikanTransaksi = async () => {
    const bayar = parseHarga(bayarInput);
    const total = getGrandTotal();

    if (bayar < total) {
      Alert.alert("Uang Kurang", `Uang yang dibayarkan (${formatRupiah(bayar)}) kurang dari total (${formatRupiah(total)})`);
      return;
    }

    try {
      setIsProcessing(true);

      const database = await openDB();
      if (!database) {
        Alert.alert("Error", "Gagal membuka database");
        setIsProcessing(false);
        return;
      }

      // Bangun detail JSON (tanpa field internal stok, has_foto, id)
      const detailItems = cart.map((item) => ({
        nama: item.nama,
        qty: item.qty,
        harga: item.harga,
        satuan: item.satuan,
        subtotal: item.subtotal,
      }));

      const transactionUuid = await addTransactionKasir(database, {
        tanggal: getTodayString(),
        total: total,
        detail: JSON.stringify(detailItems),
      });

      console.log("[KASIR] Transaksi berhasil:", transactionUuid);

      // Siapkan data struk
      setReceiptData({
        uuid: transactionUuid,
        tanggal: getTodayDisplay(),
        waktu: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        items: detailItems,
        total: total,
        bayar: bayar,
        kembalian: bayar - total,
      });

      // Reset state
      setCart([]);
      setPaymentModalVisible(false);
      setIsProcessing(false);

      // Tampilkan struk
      setReceiptModalVisible(true);

      // Reload produk (stok sudah berubah)
      const freshProducts = await getProducts(database);
      setAllProducts(freshProducts);
      setFilteredProducts(freshProducts);
    } catch (err) {
      console.log("Error transaksi kasir:", err);
      Alert.alert("Error", "Gagal memproses transaksi: " + err.message);
      setIsProcessing(false);
    }
  };

  // ======= CLEAR CART =======
  const clearCart = () => {
    if (cart.length === 0) return;
    Alert.alert("Hapus Semua", "Kosongkan keranjang belanja?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus Semua",
        style: "destructive",
        onPress: () => setCart([]),
      },
    ]);
  };

  // ======= RENDER: Product Picker Item =======
  const renderPickerItem = ({ item }) => {
    const inCart = cart
      .filter((c) => c.nama === item.nama)
      .reduce((sum, c) => sum + c.qty, 0);

    return (
      <View style={s.pickerItem}>
        <View style={s.pickerItemInfo}>
          <Text style={s.pickerItemName} numberOfLines={2}>
            {item.nama}
          </Text>
          <Text style={s.pickerItemPrice}>{formatRupiah(item.harga)}</Text>
          <View style={s.pickerItemMeta}>
            <Text style={s.pickerItemStok}>
              Stok: {item.stok} {item.satuan || "pcs"}
            </Text>
            {item.lokasi ? (
              <Text style={s.pickerItemLokasi}>📍 {item.lokasi}</Text>
            ) : null}
            {inCart > 0 && (
              <View style={s.inCartBadge}>
                <Text style={s.inCartBadgeText}>🛒 {inCart}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={s.pickerItemActions}>
          {item.has_foto ? (
            <TouchableOpacity
              style={s.btnFotoPicker}
              onPress={() => openFotoPreview(item)}
            >
              <Text style={s.btnFotoPickerText}>📷</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[
              s.btnAddPicker,
              (item.stok || 0) <= 0 && s.btnAddPickerDisabled,
            ]}
            onPress={() => openQtyModal(item)}
            disabled={(item.stok || 0) <= 0}
          >
            <Text style={s.btnAddPickerText}>
              {(item.stok || 0) <= 0 ? "Habis" : "+ Tambah"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ======= RENDER: Cart Item =======
  const renderCartItem = ({ item, index }) => (
    <View style={s.cartItem}>
      <TouchableOpacity
        style={s.cartItemMain}
        onPress={() => openEditQty(index)}
        activeOpacity={0.7}
      >
        <View style={s.cartItemNum}>
          <Text style={s.cartItemNumText}>{index + 1}</Text>
        </View>
        <View style={s.cartItemInfo}>
          <Text style={s.cartItemName} numberOfLines={2}>
            {item.nama}
          </Text>
          <Text style={s.cartItemDetail}>
            {item.qty} {item.satuan} × {formatRupiah(item.harga)}
          </Text>
        </View>
        <Text style={s.cartItemSubtotal}>{formatRupiah(item.subtotal)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={s.cartItemDelete}
        onPress={() => removeFromCart(index)}
      >
        <Text style={s.cartItemDeleteText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" backgroundColor="#1a5276" />

      {/* ===== HEADER ===== */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View>
            <Text style={s.headerTitle}>🛒 Kasir</Text>
            <Text style={[s.headerDate, { color: getSyncStatusColor() }]}>
              {getSyncStatusText()}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.btnSync, syncing && s.btnSyncDisabled]}
            onPress={() => handleSync(false)}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.btnSyncText}>🔄 Sync Data</Text>
            )}
          </TouchableOpacity>
        </View>
        {/* Summary pills */}
        <View style={s.summaryRow}>
          <View style={s.summaryPill}>
            <Text style={s.summaryPillLabel}>Item</Text>
            <Text style={s.summaryPillValue}>{cart.length}</Text>
          </View>
          <View style={s.summaryPillTotal}>
            <Text style={s.summaryPillLabel}>Total</Text>
            <Text style={s.summaryPillValueTotal}>
              {formatRupiah(getGrandTotal())}
            </Text>
          </View>
        </View>
      </View>

      {/* ===== CART LIST ===== */}
      {cart.length === 0 ? (
        <View style={s.emptyCart}>
          <Text style={s.emptyCartIcon}>🛒</Text>
          <Text style={s.emptyCartTitle}>Keranjang Kosong</Text>
          <Text style={s.emptyCartSub}>
            Tekan tombol di bawah untuk menambahkan barang
          </Text>
        </View>
      ) : (
        <FlatList
          data={cart}
          keyExtractor={(_, i) => i.toString()}
          renderItem={renderCartItem}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 10, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={s.cartHeader}>
              <Text style={s.cartHeaderLabel}>
                Keranjang ({cart.length} item)
              </Text>
              <TouchableOpacity onPress={clearCart}>
                <Text style={s.cartHeaderClear}>🗑️ Hapus Semua</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* ===== BOTTOM BAR ===== */}
      <View style={s.bottomBar}>
        <TouchableOpacity style={s.btnTambahBarang} onPress={openPicker}>
          <Text style={s.btnTambahBarangText}>➕ Tambah Barang</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btnBayar, cart.length === 0 && s.btnBayarDisabled]}
          onPress={openPayment}
          disabled={cart.length === 0}
        >
          <Text style={s.btnBayarText}>💰 Bayar Sekarang</Text>
          {cart.length > 0 && (
            <Text style={s.btnBayarTotal}>
              {formatRupiah(getGrandTotal())}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ========== MODAL: PRODUCT PICKER ========== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={pickerVisible}
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={s.pickerOverlay}>
          <View style={s.pickerContent}>
            {/* Header */}
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Pilih Barang</Text>
              <TouchableOpacity
                style={s.btnCloseModal}
                onPress={() => setPickerVisible(false)}
              >
                <Text style={s.btnCloseModalText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={s.pickerSearchContainer}>
              <TextInput
                style={s.pickerSearchInput}
                placeholder="🔍 Cari barang..."
                placeholderTextColor="#95a5a6"
                value={productSearch}
                onChangeText={handleProductSearch}
                selectionColor="#1a5276"
                autoFocus={true}
              />
            </View>

            {/* Product List */}
            {loading ? (
              <View style={s.loadingContainer}>
                <ActivityIndicator size="large" color="#1a5276" />
              </View>
            ) : (
              <FlatList
                data={filteredProducts}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderPickerItem}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <View style={s.emptyPicker}>
                    <Text style={{ fontSize: 36, marginBottom: 8 }}>📦</Text>
                    <Text style={{ color: "#888", textAlign: "center" }}>
                      {productSearch
                        ? "Barang tidak ditemukan"
                        : "Belum ada produk"}
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ========== MODAL: QTY INPUT ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={qtyModalVisible}
        onRequestClose={() => setQtyModalVisible(false)}
      >
        <View style={s.qtyOverlay}>
          <View style={s.qtyContent}>
            <Text style={s.qtyTitle}>Jumlah Barang</Text>
            <Text style={s.qtyProductName} numberOfLines={2}>
              {selectedProduct?.nama}
            </Text>
            <Text style={s.qtyPrice}>
              {formatRupiah(selectedProduct?.harga)} / {selectedProduct?.satuan || "pcs"}
            </Text>
            <Text style={s.qtyStok}>
              Stok tersedia: {selectedProduct?.stok || 0} {selectedProduct?.satuan || "pcs"}
            </Text>

            {/* Qty controls */}
            <View style={s.qtyControls}>
              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => {
                  const step = getQtyStep(selectedProduct?.satuan);
                  const current = parseFloat(qtyInput) || 0;
                  const next = Math.max(step, parseFloat((current - step).toFixed(2)));
                  setQtyInput(next.toString());
                }}
              >
                <Text style={s.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <View style={s.qtyInputWrapper}>
                <TextInput
                  style={s.qtyInputField}
                  value={qtyInput}
                  onChangeText={setQtyInput}
                  keyboardType={isContinuousUnit(selectedProduct?.satuan) ? "decimal-pad" : "numeric"}
                  selectionColor="#1a5276"
                  selectTextOnFocus
                />
                <Text style={s.qtyUnitLabel}>{selectedProduct?.satuan || "pcs"}</Text>
              </View>
              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => {
                  const step = getQtyStep(selectedProduct?.satuan);
                  const current = parseFloat(qtyInput) || 0;
                  const next = parseFloat((current + step).toFixed(2));
                  setQtyInput(next.toString());
                }}
              >
                <Text style={s.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Subtotal */}
            <View style={s.qtySubtotalRow}>
              <Text style={s.qtySubtotalLabel}>Subtotal:</Text>
              <Text style={s.qtySubtotalValue}>
                {formatRupiah((selectedProduct?.harga || 0) * (parseFloat(qtyInput) || 0))}
              </Text>
            </View>

            {/* Buttons */}
            <View style={s.qtyButtons}>
              <TouchableOpacity
                style={s.qtyBtnCancel}
                onPress={() => setQtyModalVisible(false)}
              >
                <Text style={s.qtyBtnCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.qtyBtnAdd} onPress={addToCart}>
                <Text style={s.qtyBtnAddText}>🛒 Tambah</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== MODAL: EDIT QTY (Cart) ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={editQtyModalVisible}
        onRequestClose={() => setEditQtyModalVisible(false)}
      >
        <View style={s.qtyOverlay}>
          <View style={s.qtyContent}>
            <Text style={s.qtyTitle}>Edit Jumlah</Text>
            {editingCartIndex !== null && (
              <>
                <Text style={s.qtyProductName} numberOfLines={2}>
                  {cart[editingCartIndex]?.nama}
                </Text>
                <Text style={s.qtyPrice}>
                  {formatRupiah(cart[editingCartIndex]?.harga)} / {cart[editingCartIndex]?.satuan}
                </Text>

                <View style={s.qtyControls}>
                  <TouchableOpacity
                    style={s.qtyBtn}
                    onPress={() => {
                      const step = getQtyStep(cart[editingCartIndex]?.satuan);
                      const current = parseFloat(editQtyInput) || 0;
                      const next = Math.max(step, parseFloat((current - step).toFixed(2)));
                      setEditQtyInput(next.toString());
                    }}
                  >
                    <Text style={s.qtyBtnText}>−</Text>
                  </TouchableOpacity>
                  <View style={s.qtyInputWrapper}>
                    <TextInput
                      style={s.qtyInputField}
                      value={editQtyInput}
                      onChangeText={setEditQtyInput}
                      keyboardType={isContinuousUnit(cart[editingCartIndex]?.satuan) ? "decimal-pad" : "numeric"}
                      selectionColor="#1a5276"
                      selectTextOnFocus
                    />
                    <Text style={s.qtyUnitLabel}>{cart[editingCartIndex]?.satuan || "pcs"}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.qtyBtn}
                    onPress={() => {
                      const step = getQtyStep(cart[editingCartIndex]?.satuan);
                      const current = parseFloat(editQtyInput) || 0;
                      const next = parseFloat((current + step).toFixed(2));
                      setEditQtyInput(next.toString());
                    }}
                  >
                    <Text style={s.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.qtySubtotalRow}>
                  <Text style={s.qtySubtotalLabel}>Subtotal:</Text>
                  <Text style={s.qtySubtotalValue}>
                    {formatRupiah(
                      (cart[editingCartIndex]?.harga || 0) *
                        (parseFloat(editQtyInput) || 0)
                    )}
                  </Text>
                </View>
              </>
            )}

            <View style={s.qtyButtons}>
              <TouchableOpacity
                style={s.qtyBtnCancel}
                onPress={() => setEditQtyModalVisible(false)}
              >
                <Text style={s.qtyBtnCancelText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.qtyBtnAdd} onPress={saveEditQty}>
                <Text style={s.qtyBtnAddText}>💾 Simpan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== MODAL: FOTO PREVIEW ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={fotoModalVisible}
        onRequestClose={() => setFotoModalVisible(false)}
      >
        <View style={s.fotoOverlay}>
          <View style={s.fotoContent}>
            <View style={s.fotoHeader}>
              <Text style={s.fotoTitle} numberOfLines={2}>
                {fotoProduct?.nama}
              </Text>
              <TouchableOpacity
                style={s.btnCloseModal}
                onPress={() => setFotoModalVisible(false)}
              >
                <Text style={s.btnCloseModalText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={s.fotoImageContainer}>
              {imageLoading && (
                <View style={s.fotoLoadingContainer}>
                  <ActivityIndicator size="large" color="#27ae60" />
                  <Text style={s.fotoLoadingText}>Memuat gambar...</Text>
                </View>
              )}
              {fotoProduct?.foto && (
                <Image
                  source={{ uri: fotoProduct.foto }}
                  style={s.fotoImage}
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
            {/* Product info below foto */}
            <View style={s.fotoInfoBar}>
              <Text style={s.fotoInfoPrice}>
                {formatRupiah(fotoProduct?.harga)}
              </Text>
              <Text style={s.fotoInfoStok}>
                Stok: {fotoProduct?.stok || 0} {fotoProduct?.satuan || "pcs"}
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== MODAL: PEMBAYARAN ========== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={paymentModalVisible}
        onRequestClose={() => !isProcessing && setPaymentModalVisible(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={s.payOverlay}>
            <View style={s.payContent}>
              {/* Processing overlay */}
              {isProcessing && (
                <View style={s.processingOverlay}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={s.processingText}>Memproses transaksi...</Text>
                </View>
              )}

              {/* Header */}
              <View style={s.payHeader}>
                <Text style={s.payTitle}>💰 Pembayaran</Text>
                <TouchableOpacity
                  style={s.btnCloseModal}
                  onPress={() => setPaymentModalVisible(false)}
                >
                  <Text style={s.btnCloseModalText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={s.payBody} showsVerticalScrollIndicator={false}>
                {/* Ringkasan item */}
                <View style={s.paySection}>
                  <Text style={s.paySectionTitle}>Ringkasan Belanja</Text>
                  {cart.map((item, i) => (
                    <View key={i} style={s.payItemRow}>
                      <View style={s.payItemInfo}>
                        <Text style={s.payItemName} numberOfLines={1}>
                          {item.nama}
                        </Text>
                        <Text style={s.payItemQty}>
                          {item.qty} {item.satuan} × {formatRupiah(item.harga)}
                        </Text>
                      </View>
                      <Text style={s.payItemSubtotal}>
                        {formatRupiah(item.subtotal)}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Total */}
                <View style={s.payTotalRow}>
                  <Text style={s.payTotalLabel}>TOTAL</Text>
                  <Text style={s.payTotalValue}>
                    {formatRupiah(getGrandTotal())}
                  </Text>
                </View>

                {/* Input bayar */}
                <View style={s.payInputSection}>
                  <Text style={s.payInputLabel}>Uang Dibayarkan (Rp)</Text>
                  <TextInput
                    style={s.payInput}
                    value={bayarInput}
                    onChangeText={(t) => {
                      const angkaMurni = t.replace(/\D/g, "");
                      if (!angkaMurni) {
                        setBayarInput("");
                      } else {
                        setBayarInput(formatRibuan(parseInt(angkaMurni, 10).toString()));
                      }
                    }}
                    placeholder="0"
                    placeholderTextColor="#bdc3c7"
                    keyboardType="numeric"
                    selectionColor="#1a5276"
                    autoFocus={true}
                  />
                </View>

                {/* Kembalian */}
                {parseHarga(bayarInput) > 0 && (
                  <View
                    style={[
                      s.payKembalianRow,
                      getKembalian() < 0 && s.payKembalianMinus,
                    ]}
                  >
                    <Text style={s.payKembalianLabel}>
                      {getKembalian() >= 0 ? "Kembalian" : "Kurang"}
                    </Text>
                    <Text
                      style={[
                        s.payKembalianValue,
                        getKembalian() < 0 && { color: "#e74c3c" },
                      ]}
                    >
                      {formatRupiah(Math.abs(getKembalian()))}
                    </Text>
                  </View>
                )}

                {/* Quick amount buttons */}
                <View style={s.quickAmountContainer}>
                  <Text style={s.quickAmountLabel}>Uang Pas:</Text>
                  <TouchableOpacity
                    style={s.quickAmountBtn}
                    onPress={() => setBayarInput(formatRibuan(getGrandTotal()))}
                  >
                    <Text style={s.quickAmountBtnText}>
                      {formatRupiah(getGrandTotal())}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Button Selesaikan */}
                <TouchableOpacity
                  style={[
                    s.btnSelesaikan,
                    (getKembalian() < 0 || parseHarga(bayarInput) === 0) &&
                      s.btnSelesaikanDisabled,
                  ]}
                  onPress={handleSelesaikanTransaksi}
                  disabled={
                    getKembalian() < 0 || parseHarga(bayarInput) === 0 || isProcessing
                  }
                >
                  <Text style={s.btnSelesaikanText}>
                    ✅ Selesaikan Transaksi
                  </Text>
                </TouchableOpacity>

                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ========== MODAL: STRUK / RECEIPT ========== */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={receiptModalVisible}
        onRequestClose={() => setReceiptModalVisible(false)}
      >
        <View style={s.receiptOverlay}>
          <View style={s.receiptContent}>
            {/* Success Icon */}
            <View style={s.receiptIconContainer}>
              <Text style={s.receiptIcon}>✅</Text>
            </View>

            <Text style={s.receiptTitle}>Transaksi Berhasil!</Text>
            <Text style={s.receiptDate}>
              {receiptData?.tanggal} • {receiptData?.waktu}
            </Text>

            {/* Struk */}
            <View style={s.receiptStruk}>
              <View style={s.receiptDivider} />
              {receiptData?.items?.map((item, i) => (
                <View key={i} style={s.receiptItem}>
                  <Text style={s.receiptItemName} numberOfLines={1}>
                    {item.nama}
                  </Text>
                  <View style={s.receiptItemRight}>
                    <Text style={s.receiptItemQty}>
                      {item.qty} {item.satuan}
                    </Text>
                    <Text style={s.receiptItemSub}>
                      {formatRupiah(item.subtotal)}
                    </Text>
                  </View>
                </View>
              ))}
              <View style={s.receiptDivider} />

              <View style={s.receiptTotalRow}>
                <Text style={s.receiptTotalLabel}>Total</Text>
                <Text style={s.receiptTotalValue}>
                  {formatRupiah(receiptData?.total)}
                </Text>
              </View>
              <View style={s.receiptRow}>
                <Text style={s.receiptRowLabel}>Bayar</Text>
                <Text style={s.receiptRowValue}>
                  {formatRupiah(receiptData?.bayar)}
                </Text>
              </View>
              <View style={s.receiptRow}>
                <Text style={s.receiptRowLabel}>Kembalian</Text>
                <Text style={[s.receiptRowValue, { color: "#27ae60" }]}>
                  {formatRupiah(receiptData?.kembalian)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={s.btnReceiptClose}
              onPress={() => setReceiptModalVisible(false)}
            >
              <Text style={s.btnReceiptCloseText}>Selesai</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================
// STYLES
// =============================================
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f3f7" },

  // Header
  header: {
    backgroundColor: "#1a5276",
    paddingTop: Platform.OS === "android" ? 45 : 12,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerDate: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    marginTop: 2,
  },
  btnSync: {
    backgroundColor: "#3498db",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    elevation: 2,
    alignItems: "center",
    justifyContent: "center",
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
  summaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  summaryPill: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  summaryPillTotal: {
    flex: 2,
    backgroundColor: "rgba(39,174,96,0.25)",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(39,174,96,0.4)",
  },
  summaryPillLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
  },
  summaryPillValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 2,
  },
  summaryPillValueTotal: {
    color: "#2ecc71",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 2,
  },

  // Empty cart
  emptyCart: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyCartIcon: { fontSize: 56, marginBottom: 12, opacity: 0.4 },
  emptyCartTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#7f8c8d",
    marginBottom: 6,
  },
  emptyCartSub: {
    fontSize: 13,
    color: "#95a5a6",
    textAlign: "center",
    lineHeight: 20,
  },

  // Cart list
  cartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cartHeaderLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  cartHeaderClear: {
    fontSize: 12,
    color: "#e74c3c",
    fontWeight: "600",
  },

  cartItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    overflow: "hidden",
  },
  cartItemMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  cartItemNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#1a5276",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  cartItemNumText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "bold",
  },
  cartItemInfo: {
    flex: 1,
    marginRight: 8,
  },
  cartItemName: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  cartItemDetail: {
    fontSize: 11,
    color: "#7f8c8d",
    marginTop: 2,
  },
  cartItemSubtotal: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#27ae60",
  },
  cartItemDelete: {
    backgroundColor: "#fdedec",
    paddingVertical: 16,
    paddingHorizontal: 14,
    justifyContent: "center",
    alignItems: "center",
    borderLeftWidth: 1,
    borderLeftColor: "#f5c6cb",
  },
  cartItemDeleteText: {
    color: "#e74c3c",
    fontWeight: "bold",
    fontSize: 14,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: "row",
    padding: 12,
    paddingBottom: Platform.OS === "ios" ? 24 : 12,
    gap: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  btnTambahBarang: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#1a5276",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnTambahBarangText: {
    color: "#1a5276",
    fontWeight: "bold",
    fontSize: 14,
  },
  btnBayar: {
    flex: 1.5,
    backgroundColor: "#27ae60",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#27ae60",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  btnBayarDisabled: {
    backgroundColor: "#bdc3c7",
    elevation: 0,
    shadowOpacity: 0,
  },
  btnBayarText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 16,
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  btnBayarTotal: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    marginTop: 2,
  },

  // ===== MODAL: PRODUCT PICKER =====
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: screenHeight * 0.85,
    overflow: "hidden",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#1a5276",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#fff",
  },
  btnCloseModal: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#e74c3c",
    justifyContent: "center",
    alignItems: "center",
  },
  btnCloseModalText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  pickerSearchContainer: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pickerSearchInput: {
    height: 44,
    backgroundColor: "#f8f9fa",
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 14,
    color: "#2c3e50",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyPicker: {
    padding: 40,
    alignItems: "center",
  },

  pickerItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  pickerItemInfo: {
    flex: 1,
    marginRight: 10,
  },
  pickerItemName: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  pickerItemPrice: {
    fontSize: 14,
    color: "#27ae60",
    fontWeight: "600",
    marginTop: 2,
  },
  pickerItemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  pickerItemStok: {
    fontSize: 11,
    color: "#95a5a6",
  },
  pickerItemLokasi: {
    fontSize: 10,
    color: "#d35400",
    backgroundColor: "#ffe0b2",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    fontWeight: "bold",
  },
  inCartBadge: {
    backgroundColor: "#ebf5fb",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  inCartBadgeText: {
    fontSize: 10,
    color: "#1a5276",
    fontWeight: "bold",
  },
  pickerItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btnFotoPicker: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#3498db",
    justifyContent: "center",
    alignItems: "center",
  },
  btnFotoPickerText: {
    fontSize: 16,
  },
  btnAddPicker: {
    backgroundColor: "#27ae60",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnAddPickerDisabled: {
    backgroundColor: "#bdc3c7",
  },
  btnAddPickerText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },

  // ===== MODAL: QTY =====
  qtyOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
  },
  qtyContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  qtyTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a5276",
    marginBottom: 8,
  },
  qtyProductName: {
    fontSize: 15,
    color: "#2c3e50",
    textAlign: "center",
    fontWeight: "600",
    marginBottom: 4,
  },
  qtyPrice: {
    fontSize: 14,
    color: "#27ae60",
    fontWeight: "600",
    marginBottom: 2,
  },
  qtyStok: {
    fontSize: 12,
    color: "#95a5a6",
    marginBottom: 16,
  },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1a5276",
    justifyContent: "center",
    alignItems: "center",
  },
  qtyBtnText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
  },
  qtyInputWrapper: {
    alignItems: "center",
  },
  qtyInputField: {
    width: 90,
    height: 50,
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "bold",
    color: "#2c3e50",
    borderWidth: 2,
    borderColor: "#1a5276",
  },
  qtyUnitLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#1a5276",
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  qtySubtotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 20,
    backgroundColor: "#f0faf4",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  qtySubtotalLabel: {
    fontSize: 14,
    color: "#7f8c8d",
  },
  qtySubtotalValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#27ae60",
  },
  qtyButtons: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  qtyBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#bdc3c7",
  },
  qtyBtnCancelText: {
    color: "#7f8c8d",
    fontWeight: "600",
    fontSize: 14,
  },
  qtyBtnAdd: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#27ae60",
    elevation: 2,
  },
  qtyBtnAddText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },

  // ===== MODAL: FOTO PREVIEW =====
  fotoOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  fotoContent: {
    backgroundColor: "#fff",
    borderRadius: 15,
    width: screenWidth * 0.9,
    maxHeight: screenHeight * 0.8,
    overflow: "hidden",
  },
  fotoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    backgroundColor: "#1a5276",
  },
  fotoTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#fff",
    flex: 1,
    marginRight: 10,
  },
  fotoImageContainer: {
    width: "100%",
    height: screenHeight * 0.5,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  fotoImage: {
    width: "100%",
    height: "100%",
  },
  fotoLoadingContainer: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  fotoLoadingText: {
    marginTop: 10,
    color: "#666",
    fontSize: 14,
  },
  fotoInfoBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    backgroundColor: "#f8f9fa",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  fotoInfoPrice: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#27ae60",
  },
  fotoInfoStok: {
    fontSize: 13,
    color: "#7f8c8d",
  },

  // ===== MODAL: PEMBAYARAN =====
  payOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  payContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: screenHeight * 0.9,
    overflow: "hidden",
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,82,118,0.95)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  processingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 16,
  },
  payHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#1a5276",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  payTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#fff",
  },
  payBody: {
    padding: 20,
  },
  paySection: {
    marginBottom: 16,
  },
  paySectionTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#7f8c8d",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  payItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  payItemInfo: {
    flex: 1,
    marginRight: 10,
  },
  payItemName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2c3e50",
  },
  payItemQty: {
    fontSize: 11,
    color: "#95a5a6",
    marginTop: 2,
  },
  payItemSubtotal: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  payTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1a5276",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  payTotalLabel: {
    fontSize: 16,
    fontWeight: "bold",
    color: "rgba(255,255,255,0.85)",
  },
  payTotalValue: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#fff",
  },

  payInputSection: {
    marginBottom: 16,
  },
  payInputLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 8,
  },
  payInput: {
    height: 56,
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    paddingHorizontal: 20,
    fontSize: 24,
    fontWeight: "bold",
    color: "#2c3e50",
    borderWidth: 2,
    borderColor: "#1a5276",
    textAlign: "center",
  },

  payKembalianRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f0faf4",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#b8e6cc",
  },
  payKembalianMinus: {
    backgroundColor: "#fdedec",
    borderColor: "#f5c6cb",
  },
  payKembalianLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2c3e50",
  },
  payKembalianValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#27ae60",
  },

  quickAmountContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  quickAmountLabel: {
    fontSize: 13,
    color: "#7f8c8d",
  },
  quickAmountBtn: {
    backgroundColor: "#ebf5fb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bdd7ea",
  },
  quickAmountBtnText: {
    color: "#1a5276",
    fontWeight: "bold",
    fontSize: 13,
  },

  btnSelesaikan: {
    backgroundColor: "#27ae60",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    elevation: 3,
    shadowColor: "#27ae60",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  btnSelesaikanDisabled: {
    backgroundColor: "#bdc3c7",
    elevation: 0,
    shadowOpacity: 0,
  },
  btnSelesaikanText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },

  // ===== MODAL: RECEIPT =====
  receiptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  receiptContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    maxHeight: screenHeight * 0.8,
  },
  receiptIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#f0faf4",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  receiptIcon: {
    fontSize: 32,
  },
  receiptTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#27ae60",
    marginBottom: 4,
  },
  receiptDate: {
    fontSize: 12,
    color: "#95a5a6",
    marginBottom: 16,
  },
  receiptStruk: {
    width: "100%",
    marginBottom: 16,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginVertical: 10,
    borderStyle: "dashed",
  },
  receiptItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  receiptItemName: {
    flex: 1,
    fontSize: 13,
    color: "#2c3e50",
    marginRight: 8,
  },
  receiptItemRight: {
    alignItems: "flex-end",
  },
  receiptItemQty: {
    fontSize: 11,
    color: "#95a5a6",
  },
  receiptItemSub: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2c3e50",
  },
  receiptTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  receiptTotalLabel: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  receiptTotalValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#27ae60",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  receiptRowLabel: {
    fontSize: 13,
    color: "#7f8c8d",
  },
  receiptRowValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2c3e50",
  },

  btnReceiptClose: {
    backgroundColor: "#1a5276",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
    width: "100%",
  },
  btnReceiptCloseText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
});
