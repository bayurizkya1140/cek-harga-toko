import { Tabs, usePathname } from 'expo-router';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { openDB, getProducts } from '../../helpers/database';
import { performFullSync } from '../../helpers/syncService';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [badgeCount, setBadgeCount] = useState(0);

  // State untuk exit confirmation dialog
  const [exitModalVisible, setExitModalVisible] = useState(false);
  const [isSyncingForExit, setIsSyncingForExit] = useState(false);
  const [syncExitStatus, setSyncExitStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

  // --- RESET STATE SAAT APP KEMBALI KE FOREGROUND ---
  // Mencegah tampilan "Sinkronisasi Berhasil" muncul saat app di-resume
  // karena BackHandler.exitApp() di Android tidak selalu kill proses.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        setExitModalVisible(false);
        setIsSyncingForExit(false);
        setSyncExitStatus('idle');
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    checkBadgeCount();
  }, [pathname]);

  // --- BACK HANDLER: Intercept tombol back Android ---
  useEffect(() => {
    const backAction = () => {
      // Jika sedang proses sync untuk exit, jangan izinkan back
      if (isSyncingForExit) return true;

      // Tampilkan dialog konfirmasi exit
      setExitModalVisible(true);
      return true; // Prevent default back behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [isSyncingForExit]);

  // --- HANDLE SYNC & EXIT ---
  const handleSyncAndExit = async () => {
    try {
      setIsSyncingForExit(true);
      setSyncExitStatus('syncing');

      const database = await openDB();
      if (!database) {
        setSyncExitStatus('error');
        Alert.alert('Error', 'Gagal membuka database. Aplikasi akan ditutup.', [
          { text: 'OK', onPress: () => BackHandler.exitApp() },
        ]);
        return;
      }

      console.log('[EXIT-SYNC] Memulai sinkronisasi sebelum keluar...');
      const result = await performFullSync(database);

      if (result.success) {
        setSyncExitStatus('success');
        console.log('[EXIT-SYNC] Sinkronisasi berhasil! Menutup aplikasi...');
        // Beri sedikit waktu agar user bisa melihat status sukses
        setTimeout(() => {
          BackHandler.exitApp();
        }, 800);
      } else {
        setSyncExitStatus('error');
        console.log('[EXIT-SYNC] Sinkronisasi gagal:', result.error);
        Alert.alert(
          'Sync Gagal',
          'Sinkronisasi gagal: ' + (result.error || 'Unknown error') + '\n\nApakah tetap ingin keluar?',
          [
            {
              text: 'Coba Lagi',
              onPress: () => {
                setSyncExitStatus('idle');
                setIsSyncingForExit(false);
              },
            },
            {
              text: 'Keluar',
              style: 'destructive',
              onPress: () => BackHandler.exitApp(),
            },
          ]
        );
      }
    } catch (err: any) {
      console.log('[EXIT-SYNC] Error:', err);
      setSyncExitStatus('error');
      Alert.alert(
        'Error',
        'Terjadi kesalahan saat sync: ' + err.message + '\n\nApakah tetap ingin keluar?',
        [
          {
            text: 'Coba Lagi',
            onPress: () => {
              setSyncExitStatus('idle');
              setIsSyncingForExit(false);
            },
          },
          {
            text: 'Keluar',
            style: 'destructive',
            onPress: () => BackHandler.exitApp(),
          },
        ]
      );
    }
  };

  // --- HANDLE EXIT TANPA SYNC ---
  const handleExitWithoutSync = () => {
    setExitModalVisible(false);
    BackHandler.exitApp();
  };

  // --- HANDLE BATAL EXIT ---
  const handleCancelExit = () => {
    setExitModalVisible(false);
    setSyncExitStatus('idle');
    setIsSyncingForExit(false);
  };

  const checkBadgeCount = async () => {
    try {
      const database = await openDB();
      if (!database) return;

      const allProducts = await getProducts(database);
      
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const count = allProducts.reduce((acc: number, p: any) => {
        if (p.has_kadaluarsa === 1 && p.tanggal_kadaluarsa) {
          const date = new Date(p.tanggal_kadaluarsa);
          if (!isNaN(date.getTime())) {
            date.setHours(0, 0, 0, 0);
            const diffTime = date.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 60) return acc + 1;
          }
        }
        return acc;
      }, 0);

      setBadgeCount(count);
    } catch (e) {
      console.log('Error checking badge count:', e);
    }
  };

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="piutang"
          options={{
            title: 'Piutang',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="doc.text.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="suplier"
          options={{
            title: 'Suplier',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="car.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="monitoring"
          options={{
            title: 'Monitoring',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="exclamationmark.triangle.fill" color={color} />,
            tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: '#e74c3c', color: 'white', fontSize: 10 },
          }}
        />
      </Tabs>

      {/* ======= EXIT CONFIRMATION MODAL ======= */}
      <Modal
        visible={exitModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelExit}
      >
        <View style={exitStyles.overlay}>
          <View style={exitStyles.modalContainer}>
            {/* Syncing Overlay */}
            {isSyncingForExit && (
              <View style={exitStyles.syncingOverlay}>
                <ActivityIndicator size="large" color="#ffffff" />
                <Text style={exitStyles.syncingText}>
                  {syncExitStatus === 'success'
                    ? '✅ Sinkronisasi Berhasil!'
                    : 'Sedang menyinkronkan data...'}
                </Text>
                {syncExitStatus === 'syncing' && (
                  <Text style={exitStyles.syncingSubText}>
                    Mohon tunggu, jangan tutup aplikasi
                  </Text>
                )}
              </View>
            )}

            {/* Icon */}
            <View style={exitStyles.iconContainer}>
              <Text style={exitStyles.iconText}>☁️</Text>
            </View>

            {/* Title */}
            <Text style={exitStyles.title}>Keluar Aplikasi?</Text>

            {/* Message */}
            <Text style={exitStyles.message}>
              Sebaiknya lakukan{' '}
              <Text style={exitStyles.highlight}>sinkronisasi database</Text>
              {' '}terlebih dahulu agar data terbaru Anda tersimpan di cloud dan dapat diakses dari perangkat lain.
            </Text>

            {/* Warning */}
            <View style={exitStyles.warningBox}>
              <Text style={exitStyles.warningIcon}>⚠️</Text>
              <Text style={exitStyles.warningText}>
                Data yang belum disinkronkan bisa hilang atau tidak sinkron dengan perangkat lain.
              </Text>
            </View>

            {/* Buttons */}
            <TouchableOpacity
              style={exitStyles.syncButton}
              onPress={handleSyncAndExit}
              activeOpacity={0.7}
            >
              <Text style={exitStyles.syncButtonIcon}>🔄</Text>
              <Text style={exitStyles.syncButtonText}>Sinkronisasi & Keluar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={exitStyles.exitButton}
              onPress={handleExitWithoutSync}
              activeOpacity={0.7}
            >
              <Text style={exitStyles.exitButtonText}>Keluar Tanpa Sync</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={exitStyles.cancelButton}
              onPress={handleCancelExit}
              activeOpacity={0.7}
            >
              <Text style={exitStyles.cancelButtonText}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ======= STYLES =======
const exitStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  syncingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 58, 138, 0.95)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    padding: 24,
  },
  syncingText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  syncingSubText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  highlight: {
    color: '#1e3a8a',
    fontWeight: '700',
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  warningIcon: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 1,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#795548',
    lineHeight: 18,
  },
  syncButton: {
    flexDirection: 'row',
    backgroundColor: '#1e3a8a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    elevation: 3,
    shadowColor: '#1e3a8a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  syncButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  exitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#e74c3c',
  },
  exitButtonText: {
    color: '#e74c3c',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    color: '#999999',
    fontSize: 14,
    fontWeight: '500',
  },
});

