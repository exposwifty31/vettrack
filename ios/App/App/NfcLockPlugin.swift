import Foundation
import Capacitor
import CoreNFC

/**
 * Permanently locks an NDEF tag (NTAG215 sticker) from inside VetTrack.
 *
 * WHY THIS EXISTS: `@capgo/capacitor-nfc` implements `makeReadOnly` on Android
 * (`Ndef.makeReadOnly()`) but hard-rejects it on iOS with `UNSUPPORTED`. That is a
 * plugin limitation, not an Apple one — CoreNFC exposes `NFCNDEFTag.writeLock`.
 * Without this bridge an iPhone-only operator can encode stickers but never lock
 * them, and the ops runbook forbids fielding an unlocked sticker.
 *
 * Locking is IRREVERSIBLE and runs its own short reader session, deliberately
 * separate from the write session: the operator taps once to program, and taps
 * again to lock, after confirming. The tag is identification only — locking
 * changes nothing about custody authority (ADR-006 posture).
 *
 * Requires `com.apple.developer.nfc.readersession.formats` to include `NDEF`
 * and `NFCReaderUsageDescription` in Info.plist (both present in App.entitlements
 * / Info.plist). This file must stay referenced by the App target's Sources
 * build phase — `tests/ios-nfc-lock-plugin-wired.test.ts` guards that.
 */
@objc(NfcLockPlugin)
public class NfcLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NfcLockPlugin"
    public let jsName = "NfcLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lockTag", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCNDEFReaderSession?
    private var pendingCall: CAPPluginCall?

    @objc func lockTag(_ call: CAPPluginCall) {
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("NFC is not available on this device.", "NO_NFC")
            return
        }

        pendingCall = call
        let readerSession = NFCNDEFReaderSession(
            delegate: self,
            queue: nil,
            invalidateAfterFirstRead: false
        )
        readerSession.alertMessage = call.getString("alertMessage")
            ?? "Hold the sticker against the phone to lock it permanently."
        session = readerSession
        readerSession.begin()
    }

    /** Resolve/reject exactly once, then tear the session down. */
    private func finish(errorMessage: String?, code: String?, alreadyLocked: Bool = false) {
        let call = pendingCall
        pendingCall = nil
        session = nil

        guard let call else { return }
        if let errorMessage {
            call.reject(errorMessage, code)
        } else {
            call.resolve(["locked": true, "alreadyLocked": alreadyLocked])
        }
    }
}

extension NfcLockPlugin: NFCNDEFReaderSessionDelegate {
    /** Required by the protocol; unused because `didDetect tags:` is implemented. */
    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else {
            session.invalidate(errorMessage: "No tag detected.")
            finish(errorMessage: "No tag detected.", code: "NO_TAG")
            return
        }

        session.connect(to: tag) { [weak self] connectError in
            guard let self else { return }
            if let connectError {
                session.invalidate(errorMessage: connectError.localizedDescription)
                self.finish(errorMessage: connectError.localizedDescription, code: "CONNECT_FAILED")
                return
            }

            tag.queryNDEFStatus { [weak self] status, _, statusError in
                guard let self else { return }
                if let statusError {
                    session.invalidate(errorMessage: statusError.localizedDescription)
                    self.finish(errorMessage: statusError.localizedDescription, code: "STATUS_FAILED")
                    return
                }

                switch status {
                case .readWrite:
                    tag.writeLock { [weak self] lockError in
                        guard let self else { return }
                        if let lockError {
                            session.invalidate(errorMessage: lockError.localizedDescription)
                            self.finish(errorMessage: lockError.localizedDescription, code: "LOCK_FAILED")
                            return
                        }
                        session.alertMessage = "Sticker locked."
                        session.invalidate()
                        self.finish(errorMessage: nil, code: nil)
                    }
                case .readOnly:
                    // Idempotent: re-locking an already-locked sticker is a success,
                    // not an error — an operator re-tapping must not see a failure.
                    session.alertMessage = "Sticker was already locked."
                    session.invalidate()
                    self.finish(errorMessage: nil, code: nil, alreadyLocked: true)
                default:
                    session.invalidate(errorMessage: "This tag cannot be locked.")
                    self.finish(errorMessage: "This tag cannot be locked.", code: "NOT_LOCKABLE")
                }
            }
        }
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // Fires for user-cancel and timeouts too. `finish` is a no-op once the
        // call has already been settled by the lock path above.
        finish(errorMessage: error.localizedDescription, code: "SESSION_INVALIDATED")
    }
}
