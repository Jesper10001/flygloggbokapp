import { createElement, forwardRef, type ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

// Skanningskameran för pappersloggboken (iOS, native vy i ios/ScanCameraView.swift).
// Hittar uppslaget med Apple Vision, kontrollerar inramning, skärpa och ljus och tar bilden själv.
// Fotot är redan beskuret och uppräta (perspektivkorrigerat). Inget lämnar telefonen här.

export type ScanState =
  | 'starting' | 'searching' | 'fitInFrame' | 'moveCloser' | 'center' | 'tilt'
  | 'dark' | 'holdStill' | 'focus' | 'ready' | 'capturing' | 'turnPage';

export interface ScanStatus {
  state: ScanState;
  progress: number;      // 0→1 medan uppslaget hålls still innan avtryckaren går
  aspect: number;        // ramens proportion (bredd/höjd), anpassad efter boken
  sharpness?: number;    // dev: Laplace-varians
  brightness?: number;   // dev: medelluminans 0–255
  detector?: string;     // dev: "doc" | "rect" | "none"
  coverage?: number;     // dev: bokens yta / ramens yta
  sceneDiff?: number;    // dev: hur mycket bilden ändrats sedan förra tagningen
}

export interface ScanCapture {
  uri: string;           // file:// i appens cache
  width: number;
  height: number;
  detected: boolean;     // false = boken hittades inte, bilden är beskuren till ramen
  auto: boolean;         // true = tagen automatiskt
}

export interface ScanCameraError {
  code: 'permission' | 'setup' | 'capture';
  message: string;
}

export interface ScanCameraProps extends ViewProps {
  active: boolean;
  autoCapture: boolean;
  torch: boolean;
  guideAspect: number;
  guideInsets: [number, number, number, number]; // top, right, bottom, left
  sharpnessMin?: number;
  onStatus?: (e: NativeSyntheticEvent<ScanStatus>) => void;
  onCapture?: (e: NativeSyntheticEvent<ScanCapture>) => void;
  onCameraError?: (e: NativeSyntheticEvent<ScanCameraError>) => void;
}

export interface ScanCameraHandle {
  capture(): Promise<void>;   // manuell avtryckare
  rearm(): Promise<void>;     // ta nästa bild utan att vänta på sidvändning
}

/** True om bygget innehåller kameramodulen (kräver ett nytt EAS-bygge efter att modulen lagts till). */
export function isScanCameraAvailable(): boolean {
  try {
    return requireOptionalNativeModule('BladesScanCamera') != null;
  } catch {
    return false;
  }
}

// Laddas först när vyn renderas, så att appen inte kraschar i ett bygge utan modulen.
let NativeScanCamera: ComponentType<any> | null = null;

export const ScanCameraView = forwardRef<ScanCameraHandle, ScanCameraProps>((props, ref) => {
  if (!NativeScanCamera) NativeScanCamera = requireNativeViewManager('BladesScanCamera');
  return createElement(NativeScanCamera, { ...props, ref });
});
ScanCameraView.displayName = 'ScanCameraView';
