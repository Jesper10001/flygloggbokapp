// Topp-nivå felgräns: fångar render-fel var som helst i appträdet så ETT komponentfel inte
// vitnar hela appen. Visar en återhämtningsvy ("Try again") i stället. componentDidCatch är
// den centrala kraschloggen — här kopplas Sentry/Crashlytics in senare (se reportFatal).
import { Component, type ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Central kraschpunkt. TODO(launch): rapportera till Sentry här när det är inkopplat.
    console.error('[ErrorBoundary]', error?.message ?? error, info?.componentStack ?? '');
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.danger + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Ionicons name="alert-circle" size={32} color={Colors.danger} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Something went wrong
        </Text>
        <Text style={{ fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
          The app hit an unexpected error. Your logbook data is safe on this device. Try again — if it keeps happening, restart the app.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 }}
          onPress={this.reset}
          activeOpacity={0.85}
        >
          <Text style={{ color: Colors.textInverse, fontSize: 16, fontWeight: '700' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
