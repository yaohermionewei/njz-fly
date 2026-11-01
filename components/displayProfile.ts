export interface DeviceSignals {
  userAgent: string;
  platform: string;
  touchPoints: number;
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
}

/** Use the device screen, not the window: resizing a desktop must not turn it into a phone. */
export function isPhoneDevice(device: DeviceSignals): boolean {
  const { userAgent: ua, platform, touchPoints, screenWidth, screenHeight, coarsePointer } = device;
  const ipad = /iPad/i.test(ua) || (/Mac/i.test(platform) && touchPoints > 1);
  const androidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  if (ipad || androidTablet || !coarsePointer) return false;
  const shortEdge = Math.min(screenWidth, screenHeight);
  return shortEdge > 0 && shortEdge <= 600 && /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
}

export function readPhoneDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return isPhoneDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    touchPoints: navigator.maxTouchPoints,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  });
}

/** Enlarge gameplay objects only. Backgrounds and the fixed 720-unit view never zoom. */
export const PHONE_ENTITY_SCALE = 1.5;
