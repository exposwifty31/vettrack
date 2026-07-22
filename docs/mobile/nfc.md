# VetTrack — NFC Architecture

---

## Overview

VetTrack uses NFC to identify equipment tags at docks and bedsides. The abstraction layer in `src/lib/nfc-platform.ts` unifies three paths:

| Path | Platform | When used |
|------|---------|-----------|
| **Web NFC** | Android Chrome (desktop/mobile) | `"NDEFReader" in window` |
| **Capacitor native (capgo)** | iOS / Android native app | `Capacitor.isNativePlatform() == true` |
| **QR fallback** | All platforms | NFC unavailable |

---

## API

```typescript
// Availability
isNfcSupported(): Promise<boolean>
isNfcSupportedSync(): boolean          // sync check for UI; may be stale
primeNfcSupportCache(): Promise<void>  // call once at app mount in Capacitor

// Read
readNfcOnce(options): Promise<NfcReadPayload>
startNfcScanSession(options): Promise<NfcScanSession>

// Write
writeNfcUrl(url: string): Promise<void>

// Decode
resolveNfcTagId(payload: NfcReadPayload): string | null
```

`NfcReadPayload` contains `{ text, url, tagId }` — all nullable. `resolveNfcTagId` picks the first non-null value.

---

## iOS (CoreNFC)

**Plugin:** `@capgo/capacitor-nfc` v8

**Entitlement required:**
In Xcode → Target → Signing & Capabilities → add **Near Field Communication Tag Reading**.

**Info.plist key (already present):**
```xml
<key>NFCReaderUsageDescription</key>
<string>VetTrack reads NFC tags to identify equipment at the dock and bedside.</string>
```

**Limitations:**
- Background NFC scanning not available (foreground-only via `NFCNDEFReaderSession`)
- Requires NFC-capable device (iPhone 7+)
- Cannot write to locked tags
- 60-second session timeout enforced by iOS

**Supported NDEF types:** URL records, Text records

---

## Android (NFC API)

**Permission (already in AndroidManifest.xml):**
```xml
<uses-permission android:name="android.permission.NFC" />
<uses-feature android:name="android.hardware.nfc" android:required="false" />
```

`android:required="false"` — app is installable on devices without NFC; the UI degrades to QR.

**Limitations:**
- Some Android OEMs restrict background dispatch
- Web NFC (Chrome Android) limited to NDEF URL/text records
- No write support via Web NFC on all Android versions

---

## Backend contracts

NFC tag IDs resolve to equipment records via the standard equipment lookup path:

```
POST /api/scan-logs          — record NFC/QR scan
GET  /api/equipment?rfid=... — lookup by RFID/NFC tag ID
```

No NFC-specific backend routes. The `vt_equipment.rfid_tag` column stores the tag identifier.

Tag format stored: raw UID hex string (e.g. `"04:A2:3B:5C"`) or NDEF URL (`"https://vettrack.uk/eq/abc123"`).

`resolveNfcTagId()` in `src/lib/nfc-platform.ts` normalizes read payloads to one of these forms before server calls.

---

## RFID vs NFC

VetTrack's current hardware uses **RFID dock readers** (USB HID, web serial) for bulk scan-in/out at charging stations. The NFC path targets **individual tag reads** at the bedside on mobile devices.

The two paths share the same backend API and `vt_equipment.rfid_tag` column but differ in the client-side read mechanism.

See `docs/archive/2026/equipment-readiness-rfid-gap-analysis.md` for the full RFID gap analysis.

---

## Future work

- `@capacitor/push-notifications` NFC deep-link on notification tap
- Background NFC dispatch on Android (foreground dispatch currently only)
- NFC tag provisioning UI (write equipment URL to blank tags)
- Physical NFC tag spec recommendation (NTAG213 / NTAG215 recommended for NDEF URL records ≤ 137 bytes)
