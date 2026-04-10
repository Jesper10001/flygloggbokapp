import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: Colors.tabIconActive,
        tabBarInactiveTintColor: Colors.tabIconDefault,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" size={size} color={color} />
          ),
          headerTitle: 'FlightLog Pro',
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Loggbok',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Skanna',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="camera" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Inställningar',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
