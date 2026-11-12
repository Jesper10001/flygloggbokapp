// Byggstenar för "Block import manually" (pilot + drönare): LED-fält med ghost-8:or, mätaren
// "Left to give out", års-staplarna, sektioner och knapprader. Färgerna kommer in som en palett
// så pilot (Colors) och drönare (DR + accent) delar samma utseende.
import { useState, type ReactNode } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_LED7 } from '../logflight/tokens';

export interface XPalette {
  bg: string; card: string; elevated: string; border: string; sep: string;
  text: string; text2: string; muted: string; accent: string; onAccent: string;
  success: string; warning: string; danger: string;
}

// ── Tid ───────────────────────────────────────────────────────────────────────

/** "1248:30" eller "1248.5" → minuter (heltal). Tomt/ogiltigt = 0. */
export function toMin(v: string): number {
  const t = (v || '').trim().replace(',', '.');
  if (!t) return 0;
  if (t.includes(':')) {
    const [h, m] = t.split(':');
    return Math.max(0, (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0));
  }
  return Math.max(0, Math.round((parseFloat(t) || 0) * 60));
}
/** Minuter → "1248:30". */
export function hm(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
/** Minuter → timmar som sträng för databasen (4 decimaler räcker för exakta minuter). */
export function minToHours(mins: number): string {
  return String(Math.round((mins / 60) * 10000) / 10000);
}
/** Bara siffror, kolon och decimaltecken i tidsfält. */
export const cleanTime = (v: string) => v.replace(/[^\d:.,]/g, '');
export const cleanInt = (v: string) => v.replace(/\D/g, '');

// ── LED ───────────────────────────────────────────────────────────────────────

function glow(color: string, r: number): TextStyle {
  return { textShadowColor: color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: r };
}

/** Lysande LED-text (summor, kvar att fördela, knappens siffra). */
export function LedText({ children, size = 15, color, style }: { children: string; size?: number; color: string; style?: TextStyle }) {
  return (
    <Text style={[{ fontFamily: FONT_LED7, fontSize: size, fontWeight: '700', letterSpacing: 1, color }, glow(color, size > 18 ? 7 : 5), style]} numberOfLines={1}>
      {children}
    </Text>
  );
}

/** LED-inmatning med svaga 8:or bakom (som LedDisplay i Log flight). */
export function LedInput({
  value, onChangeText, P, size = 15, align = 'right', width, integer, placeholder, label, autoFocus, onFocus, onBlur,
}: {
  value: string; onChangeText: (v: string) => void; P: XPalette; size?: number; align?: 'left' | 'right';
  width?: number; integer?: boolean; placeholder?: string; label: string; autoFocus?: boolean;
  onFocus?: () => void; onBlur?: () => void;
}) {
  const ph = placeholder ?? (integer ? '--' : '--:--');
  const ghost = (value || ph).replace(/[\d-]/g, '8');
  const lh = Math.round(size * 1.5);
  const base: TextStyle = {
    fontFamily: FONT_LED7, fontSize: size, fontWeight: '700', letterSpacing: 1, lineHeight: lh,
    textAlign: align, padding: 0, margin: 0,
  };
  return (
    <View style={{ position: 'relative', width, flex: width ? undefined : 1, minWidth: 0, justifyContent: 'center' }}>
      <Text
        style={[base, { position: 'absolute', left: 0, right: 0, color: P.text, opacity: 0.08 }]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {ghost}
      </Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChangeText(integer ? cleanInt(v) : cleanTime(v))}
        placeholder={ph}
        placeholderTextColor={P.muted}
        keyboardType={integer ? 'number-pad' : 'numbers-and-punctuation'}
        selectTextOnFocus
        autoFocus={autoFocus}
        onFocus={onFocus}
        onBlur={onBlur}
        accessibilityLabel={label}
        style={[base, { color: P.text, height: lh }, value ? glow(P.text, size > 18 ? 8 : 5) : null]}
      />
    </View>
  );
}

// ── Ytor ──────────────────────────────────────────────────────────────────────

/** Liten kamera efter etiketten: värdet kommer från fotot av loggboken. */
export function PhotoMark({ P }: { P: XPalette }) {
  return <Ionicons name="camera-outline" size={12} color={P.text2} accessibilityLabel="from your photo" />;
}

export function Card({ P, children, style }: { P: XPalette; children: ReactNode; style?: object }) {
  return <View style={[{ backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderRadius: 16, overflow: 'hidden' }, style]}>{children}</View>;
}

export function Section({ P, title, note, noteLed, children }: { P: XPalette; title: string; note?: string; noteLed?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
        <Text style={{ color: P.text2, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
        {noteLed ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ color: P.text2, fontSize: 12 }}>sum</Text>
            <LedText size={11} color={P.text}>{noteLed}</LedText>
          </View>
        ) : note ? <Text style={{ color: P.text2, fontSize: 12 }}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Lägesväljare "All at once" / "Year by year". */
export function ModeSwitch({ P, mode, onChange }: { P: XPalette; mode: 'lump' | 'yearly'; onChange: (m: 'lump' | 'yearly') => void }) {
  const item = (m: 'lump' | 'yearly', icon: any, label: string) => {
    const on = mode === m;
    return (
      <TouchableOpacity
        key={m}
        onPress={() => onChange(m)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{
          flex: 1, height: 40, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
          backgroundColor: on ? P.elevated : 'transparent', borderWidth: 1, borderColor: on ? P.accent + '55' : 'transparent',
        }}
      >
        <Ionicons name={icon} size={16} color={on ? P.text : P.text2} />
        <Text style={{ color: on ? P.text : P.text2, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      </TouchableOpacity>
    );
  };
  return (
    <View style={{ flexDirection: 'row', padding: 3, backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderRadius: 13 }}>
      {item('lump', 'layers-outline', 'All at once')}
      {item('yearly', 'calendar-outline', 'Year by year')}
    </View>
  );
}

/** Totaltiden: stor LED-siffra. */
export function HeroTotal({ P, label, value, onChange, hint, photo, footer }: { P: XPalette; label: string; value: string; onChange: (v: string) => void; hint?: string; photo?: boolean; footer?: ReactNode }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{
      backgroundColor: P.card, borderWidth: 1, borderColor: focus ? P.accent : P.border, borderRadius: 20,
      paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 4,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: P.text2, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' }}>{label}</Text>
        {photo ? <PhotoMark P={P} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LedInput P={P} value={value} onChangeText={onChange} size={38} align="left" label={label} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
        <Text style={{ color: P.text2, fontSize: 18, fontWeight: '600' }}>h</Text>
      </View>
      {hint ? <Text style={{ color: P.text2, fontSize: 13, lineHeight: 18 }}>{hint}</Text> : null}
      {footer}
    </View>
  );
}

/** En rad med etikett (+ underrad och färgprick) och LED-fält till höger. */
export function TimeRow({
  P, label, sub, dot, value, onChange, share, first, integer, onRemove, photo, flag,
}: {
  P: XPalette; label: string; sub?: string; dot?: string; value: string; onChange: (v: string) => void;
  share?: number; first?: boolean; integer?: boolean; onRemove?: () => void; photo?: boolean; flag?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: sub || flag ? 58 : 52, paddingHorizontal: 16,
      borderTopWidth: first ? 0 : 1, borderTopColor: P.sep, backgroundColor: flag ? P.warning + '12' : undefined,
    }}>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${label}`}>
          <Ionicons name="remove-circle" size={18} color={P.danger} />
        </TouchableOpacity>
      ) : null}
      {dot ? <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: dot }} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: P.text, fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
          {photo ? <PhotoMark P={P} /> : null}
        </View>
        {flag ? <Text style={{ color: P.warning, fontSize: 12, marginTop: 1 }} numberOfLines={1}>Check this against your logbook</Text>
          : sub ? <Text style={{ color: P.text2, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <LedInput P={P} value={value} onChangeText={onChange} width={112} integer={integer} label={label} />
      {!integer ? <Text style={{ color: P.text2, fontSize: 13, width: 9 }}>h</Text> : null}
      {share != null && share > 0 ? (
        <View style={{ position: 'absolute', left: 16, bottom: 0, height: 2, borderRadius: 1, backgroundColor: P.accent, opacity: 0.55, width: `${Math.min(100, share * 100) * 0.9}%` }} />
      ) : null}
    </View>
  );
}

/** Ruta (natt, landningar …) med etikett och LED-fält. */
export function Tile({ P, label, value, onChange, integer, photo, flag }: { P: XPalette; label: string; value: string; onChange: (v: string) => void; integer?: boolean; photo?: boolean; flag?: boolean }) {
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: flag ? P.warning + '12' : P.card, borderWidth: 1, borderColor: flag ? P.warning + '99' : P.border, borderRadius: 16, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text style={{ color: P.text2, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{label}</Text>
        {photo ? <PhotoMark P={P} /> : null}
      </View>
      <LedInput P={P} value={value} onChangeText={onChange} size={18} align="left" integer={integer} label={label} />
      {flag ? <Text style={{ color: P.warning, fontSize: 11.5 }} numberOfLines={1}>Check it</Text> : null}
    </View>
  );
}

/** Delad stapel: en färgbit per post (+ randig rest). */
export function SplitBar({ P, parts, rest = 0, height = 10, style }: { P: XPalette; parts: { v: number; color: string }[]; rest?: number; height?: number; style?: object }) {
  const shown = parts.filter((p) => p.v > 0);
  if (!shown.length && rest <= 0) {
    return <View style={[{ height, borderRadius: 3, backgroundColor: P.elevated }, style]} />;
  }
  return (
    <View style={[{ flexDirection: 'row', gap: 3, height }, style]}>
      {shown.map((p, i) => <View key={i} style={{ flex: p.v, borderRadius: 3, backgroundColor: p.color }} />)}
      {rest > 0 ? (
        <View style={{ flex: rest, borderRadius: 3, borderWidth: 1, borderColor: P.accent + '55', borderStyle: 'dashed', backgroundColor: P.elevated }} />
      ) : null}
    </View>
  );
}

/** Rad som säger om delarna går ihop med totalen. */
export function SumCheck({ P, parts, total, ok, over, under }: { P: XPalette; parts: number; total: number; ok: string; over: string; under: string }) {
  if (parts <= 0 || total <= 0) return null;
  const state = parts === total ? 'ok' : parts > total ? 'over' : 'under';
  const color = state === 'ok' ? P.success : state === 'over' ? P.warning : P.text2;
  const icon = state === 'ok' ? 'checkmark-circle-outline' : state === 'over' ? 'alert-circle-outline' : 'ellipse-outline';
  const text = state === 'ok' ? ok : state === 'over' ? `${over} (${hm(parts - total)} over)` : `${under} (${hm(total - parts)} left)`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingTop: 2 }}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={{ color, fontSize: 13, lineHeight: 18, flex: 1 }}>{text}</Text>
    </View>
  );
}

export function Hint({ P, children }: { P: XPalette; children: string }) {
  return <Text style={{ color: P.text2, fontSize: 12, lineHeight: 17, paddingHorizontal: 4 }}>{children}</Text>;
}

/** "+ PIC"-knapp. */
export function Chip({ P, label, onPress }: { P: XPalette; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label}`}
      style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 10, paddingRight: 13, borderRadius: 18, borderWidth: 1, borderColor: P.border }}
    >
      <Ionicons name="add" size={15} color={P.accent} />
      <Text style={{ color: P.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ChipGroup({ P, title, items }: { P: XPalette; title: string; items: { label: string; onPress: () => void }[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: P.text2, fontSize: 12, fontWeight: '600' }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((it) => <Chip key={it.label} P={P} label={it.label} onPress={it.onPress} />)}
      </View>
    </View>
  );
}

/** Rubrik inne i ett kort ("CIVIL · EASA"). */
export function GroupLabel({ P, title, first }: { P: XPalette; title: string; first?: boolean }) {
  return (
    <Text style={{
      color: P.text2, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase',
      paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2, borderTopWidth: first ? 0 : 1, borderTopColor: P.sep,
    }}>{title}</Text>
  );
}

// ── Fördelning per farkost ────────────────────────────────────────────────────

export const ALLOC_COLORS = ['#00C8E8', '#7FE3F3', '#2F7FB0', '#C7F4FB', '#5A8FC0', '#1F5A86'];

/** Mätaren överst i Aircraft/Drones: hur mycket av totalen som är kvar att ge ut. */
export function AllocationMeter({ P, total, parts, noun }: { P: XPalette; total: number; parts: number[]; noun: string }) {
  const given = parts.reduce((a, b) => a + b, 0);
  const left = total - given;
  const done = total > 0 && left === 0;
  const over = left < 0;
  const color = done ? P.success : over ? P.danger : P.text;
  return (
    <View style={{ padding: 16, paddingBottom: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <Text style={{ color: P.text, fontSize: 14, fontWeight: '600', opacity: 0.85 }}>
          {total <= 0 ? 'Enter your total first' : done ? 'Nothing left to give' : over ? 'Given out too much' : 'Left to give out'}
        </Text>
        <LedText size={22} color={color}>{hm(Math.abs(left))}</LedText>
      </View>
      <SplitBar P={P} height={12} parts={parts.map((v, i) => ({ v, color: ALLOC_COLORS[i % ALLOC_COLORS.length] }))} rest={Math.max(0, left)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {done ? <Ionicons name="checkmark-circle-outline" size={15} color={P.success} /> : null}
        <Text style={{ color: over ? P.danger : P.text2, fontSize: 12 }}>
          {done ? `All ${hm(total)} h is given to ${noun}` : over ? `Take ${hm(-left)} h off to match your total` : `${hm(given)} of ${hm(total)} h given to ${noun}`}
        </Text>
      </View>
    </View>
  );
}

/** "+ Add aircraft" — fäller ut ett fält med förslag ur Fleet. */
export function AddPicker({
  P, label, note, placeholder, suggestions, onPick, allowNew = true,
}: {
  P: XPalette; label: string; note: string; placeholder: string;
  suggestions: { key: string; label: string; sub?: string }[]; onPick: (key: string | null, text: string) => void; allowNew?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = text.trim().toUpperCase();
  const list = suggestions.filter((s) => !q || s.label.toUpperCase().includes(q)).slice(0, 12);
  const exact = suggestions.some((s) => s.label.toUpperCase() === q);
  const close = () => { setOpen(false); setText(''); };
  if (!open) {
    return (
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: P.sep }}
      >
        <Ionicons name="add" size={18} color={P.accent} />
        <Text style={{ color: P.accent, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: P.text2, fontSize: 12, marginLeft: 'auto' }}>{note}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={{ padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: P.sep }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={P.muted}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={placeholder}
          style={{ flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: P.border, backgroundColor: P.elevated, color: P.text, paddingHorizontal: 12, fontSize: 15 }}
        />
        <TouchableOpacity onPress={close} hitSlop={8} accessibilityRole="button" style={{ height: 42, justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ color: P.text2, fontSize: 15 }}>Cancel</Text>
        </TouchableOpacity>
      </View>
      {list.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map((s) => (
            <TouchableOpacity
              key={s.key}
              onPress={() => { onPick(s.key, s.label); close(); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: P.border, backgroundColor: P.elevated }}
            >
              <Text style={{ color: P.text, fontSize: 14, fontWeight: '600' }}>{s.label}</Text>
              {s.sub ? <Text style={{ color: P.text2, fontSize: 11 }}>{s.sub}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {allowNew && q && !exact ? (
        <TouchableOpacity
          onPress={() => { onPick(null, text.trim()); close(); }}
          activeOpacity={0.75}
          accessibilityRole="button"
          style={{ height: 42, borderRadius: 10, backgroundColor: P.accent + '22', borderWidth: 1, borderColor: P.accent + '66', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: P.accent, fontSize: 15, fontWeight: '700' }}>Add "{text.trim()}"</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── År för år ─────────────────────────────────────────────────────────────────

/** Stapel per år; tryck för att fylla i det året, "+" lägger till året före det tidigaste. */
export function YearBars({
  P, years, selected, onSelect, onAddEarlier, addLabel, addIcon, eyebrow,
}: {
  P: XPalette; years: { id: string; year: string; mins: number; label?: string; merged?: boolean }[]; selected: string;
  onSelect: (id: string) => void; onAddEarlier: () => void; addLabel: string; addIcon?: 'add' | 'camera-outline'; eyebrow?: string;
}) {
  const max = Math.max(1, ...years.map((y) => y.mins));
  const total = years.reduce((a, y) => a + y.mins, 0);
  return (
    <Card P={P} style={{ borderRadius: 20, padding: 14, paddingTop: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }}>
        <Text style={{ color: P.text2, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' }}>
          {eyebrow ?? `${years.length} ${years.length === 1 ? 'year' : 'years'}`}
        </Text>
        <LedText size={14} color={P.text}>{hm(total)}</LedText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 104 }}>
        <TouchableOpacity onPress={onAddEarlier} accessibilityRole="button" accessibilityLabel={`Add ${addLabel}`} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <View style={{ width: '100%', maxWidth: 44, height: 34, borderRadius: 7, borderWidth: 1.5, borderStyle: 'dashed', borderColor: P.accent + '77', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={addIcon ?? 'add'} size={16} color={P.accent} />
          </View>
          <Text style={{ color: P.text2, fontSize: 12, fontFamily: 'Menlo' }}>{addLabel}</Text>
        </TouchableOpacity>
        {years.map((y) => {
          const on = y.id === selected;
          return (
            <TouchableOpacity
              key={y.id}
              onPress={() => onSelect(y.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${y.year || 'Year'}, ${hm(y.mins)} hours`}
              style={{ flex: 1, alignItems: 'center', gap: 6 }}
            >
              <View style={{
                width: '100%', maxWidth: 44, height: Math.max(4, Math.round((y.mins / max) * 76)), borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
                backgroundColor: y.merged && !on ? 'transparent' : on ? P.accent : P.accent + '33',
                borderWidth: y.merged ? 1.5 : 0, borderStyle: 'dashed', borderColor: P.warning,
              }} />
              <Text style={{ color: on ? P.text : P.text2, fontSize: 12, fontWeight: on ? '700' : '400', fontFamily: 'Menlo' }} numberOfLines={1} adjustsFontSizeToFit>{y.label ?? (y.year || '----')}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );
}

/** Årsrubriken: årtalet (går att ändra) + "3 of 5" + papperskorg. */
export function YearHeader({ P, year, onYear, index, count, onRemove }: { P: XPalette; year: string; onYear: (v: string) => void; index: number; count: number; onRemove?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: -10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <TextInput
          value={year}
          onChangeText={(v) => onYear(cleanInt(v).slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="Year"
          placeholderTextColor={P.muted}
          accessibilityLabel="Year"
          style={{ color: P.text, fontSize: 22, fontWeight: '800', padding: 0, minWidth: 60 }}
        />
        <Text style={{ color: P.text2, fontSize: 13, fontWeight: '600' }}>{index + 1} of {count}</Text>
      </View>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${year || 'this year'}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="trash-outline" size={19} color={P.danger} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Botten ────────────────────────────────────────────────────────────────────

export function SaveBar({
  P, info, label, led, disabled, saving, onPress, error, bottomInset,
}: {
  P: XPalette; info: string; label: string; led?: string; disabled: boolean; saving: boolean;
  onPress: () => void; error?: string | null; bottomInset: number;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(16, bottomInset + 8), gap: 10, backgroundColor: P.card, borderTopWidth: 1, borderTopColor: P.sep }}>
      {error ? <Text style={{ color: P.danger, fontSize: 13, lineHeight: 18 }}>{error}</Text> : (
        <View style={{ flexDirection: 'row', gap: 9 }}>
          <Ionicons name="calendar-outline" size={16} color={P.text2} style={{ marginTop: 1 }} />
          <Text style={{ color: P.text2, fontSize: 13, lineHeight: 18, flex: 1 }}>{info}</Text>
        </View>
      )}
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || saving}
        activeOpacity={0.85}
        accessibilityRole="button"
        style={{ height: 54, borderRadius: 15, backgroundColor: disabled ? P.elevated : P.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
      >
        {saving ? <ActivityIndicator color={P.onAccent} /> : (
          <>
            <Text style={{ color: disabled ? P.muted : P.onAccent, fontSize: 17, fontWeight: '700' }}>{label}</Text>
            {led && !disabled ? (
              <>
                <Text style={{ fontFamily: FONT_LED7, fontSize: 16, fontWeight: '700', letterSpacing: 1, color: P.onAccent }}>{led}</Text>
                <Text style={{ color: P.onAccent, fontSize: 17, fontWeight: '700' }}>h</Text>
              </>
            ) : null}
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}
