import { Tabs, usePathname } from 'expo-router';
import React, { useState, useEffect } from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { openDB, getProducts } from '../../helpers/database';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    checkBadgeCount();
  }, [pathname]);

  const checkBadgeCount = async () => {
    let database = null;
    try {
      database = await openDB();
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
    } finally {
      if (database) {
        try { await database.closeAsync(); } catch (e) {}
      }
    }
  };

  return (
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
  );
}
