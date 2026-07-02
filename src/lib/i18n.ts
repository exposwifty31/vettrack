import { interpolate } from "../../lib/i18n/index";
import { isInternalKey } from "../../lib/i18n/internal-keys";
import type { Locale as SharedLocale } from "../../lib/i18n/types";
import enDict from "../../locales/en.json";
import heDict from "../../locales/he.json";
import { safeStorageGetItem, safeStorageSetItem } from "./safe-browser";
import { isCapacitorNative } from "./capacitor-runtime";

export type Locale = SharedLocale;
export const LOCALE_STORAGE_KEY = "vettrack-locale";

const RTL_LOCALES = new Set<Locale>(["he"]);
const dictionaries: Record<Locale, typeof heDict> = {
  en: enDict,
  he: heDict,
};

/**
 * Strip top-level internal keys (e.g. `_meta`) from the accessor tree.
 *
 * `_meta.*` is a reserved non-rendering metadata namespace included for
 * parity but never exposed to UI. Delegates the "is internal" check to
 * the shared `isInternalKey` predicate (Phase 6 §5 invariant 13 — the
 * canonical predicate used by all four enforcement sites).
 */
export function stripInternalKeys<T extends Record<string, unknown>>(obj: T): T {
  const copy = { ...obj };
  for (const key of Object.keys(copy)) {
    if (isInternalKey(key)) {
      delete copy[key];
    }
  }
  return copy;
}

export function isSupportedLocale(locale: string | null | undefined): locale is Locale {
  return locale === "en" || locale === "he";
}

export function getDirection(locale: string | null | undefined): "rtl" | "ltr" {
  return isSupportedLocale(locale) && RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function resolveClientLocale(locale: string | null | undefined): Locale {
  if (isSupportedLocale(locale)) return locale;
  const fromNavigator = typeof navigator !== "undefined" ? navigator.language.split("-")[0]?.toLowerCase() : undefined;
  if (isSupportedLocale(fromNavigator)) return fromNavigator;
  return "he";
}

export function getStoredLocale(): Locale {
  try {
    if (typeof window === "undefined") return "he";
    const stored = safeStorageGetItem(LOCALE_STORAGE_KEY);
    if (!stored) return "he"; // Default to Hebrew in native context
    return resolveClientLocale(stored);
  } catch {
    return "he";
  }
}

export function setStoredLocale(locale: string): Locale {
  const resolved = resolveClientLocale(locale);
  try {
    if (typeof window !== "undefined") {
      safeStorageSetItem(LOCALE_STORAGE_KEY, resolved);
      refreshTranslations(resolved);
      window.dispatchEvent(new CustomEvent("vettrack:locale-changed", { detail: resolved }));
    }
  } catch {
  }
  return resolved;
}

export function getCurrentLocale(): Locale {
  return getStoredLocale();
}

export function formatDateTimeByLocale(date: Date, options?: Intl.DateTimeFormatOptions): string {
  const locale = getStoredLocale();
  return date.toLocaleString(locale, options);
}

export function formatDateByLocale(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const locale = getStoredLocale();
  const localeTag = locale === "he" ? "he-IL" : "en-US";
  return new Date(date).toLocaleDateString(localeTag, options);
}

export function applyLocaleDocumentAttributes(locale: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const resolved = resolveClientLocale(locale);
  document.documentElement.lang = resolved;
  document.documentElement.dir = getDirection(resolved);
}

function buildTranslations(d: typeof heDict) {
  function tr(template: string, params: Record<string, string | number | boolean>): string {
    return interpolate(template, params);
  }

const translations = {

  common: d.common,

  status: d.status,

  shiftLeaderboard: d.shiftLeaderboard,

  layout: {
    nav: d.layout.nav,
    settings: d.layout.settings,
    toast: d.layout.toast,
    alertsDropdown: {
      toggleAria: (count: number) => tr(d.layout.alertsDropdown.toggleAria, { count }),
      activeCount: (count: number) => tr(d.layout.alertsDropdown.activeCount, { count }),
      empty: d.layout.alertsDropdown.empty,
      seeAll: d.layout.alertsDropdown.seeAll,
    },
    sync: {
      pendingActions: (count: number) => tr(d.layout.sync.pendingActions, { count }),
      failedActions: (count: number) => tr(d.layout.sync.failedActions, { count }),
      viewQueue: d.layout.sync.viewQueue,
      failedMessage: d.layout.sync.failedMessage,
      pendingMessage: (count: number) => tr(d.layout.sync.pendingMessage, { count }),
    },
  },

  equipmentList: {
    uptimeLabel: d.equipmentList.uptimeLabel,
    search: d.equipmentList.search,
    folders: d.equipmentList.folders,
    actions: d.equipmentList.actions,
    empty: d.equipmentList.empty,
    errors: d.equipmentList.errors,
    linkedInUse: (name: string) => tr(d.equipmentList.linkedInUse, { name }),
    toast: {
      deleteSuccess: (count: number) => tr(d.equipmentList.toast.deleteSuccess, { count }),
      deleteError: d.equipmentList.toast.deleteError,
      moveSuccess: d.equipmentList.toast.moveSuccess,
      moveError: d.equipmentList.toast.moveError,
      exportError: d.equipmentList.toast.exportError,
      checkoutError: d.equipmentList.toast.checkoutError,
      returnError: d.equipmentList.toast.returnError,
      returnSuccess: (name: string) => tr(d.equipmentList.toast.returnSuccess, { name }),
    },
    quickAction: d.equipmentList.quickAction,
    bulkDelete: {
      title: (count: number) => tr(d.equipmentList.bulkDelete.title, { count }),
      description: d.equipmentList.bulkDelete.description,
      confirm: d.equipmentList.bulkDelete.confirm,
    },
    recoveryBadgeStale: d.equipmentList.recoveryBadgeStale,
    recoveryBadgeVeryStale: d.equipmentList.recoveryBadgeVeryStale,
    recoveryBadgeCheckedOutLong: d.equipmentList.recoveryBadgeCheckedOutLong,
    recoveryAttentionFilter: d.equipmentList.recoveryAttentionFilter,
    triageAttention: d.equipmentList.triageAttention,
    triageInUse: d.equipmentList.triageInUse,
    triageOperational: d.equipmentList.triageOperational,
    statTotal: d.equipmentList.statTotal,
    statAttention: d.equipmentList.statAttention,
    statInUse: d.equipmentList.statInUse,
    statUptime: d.equipmentList.statUptime,
    filterAll: d.equipmentList.filterAll,
    recoveryAttentionSummary: d.equipmentList.recoveryAttentionSummary,
    paginationCount: (shown: number, total: number) => tr(d.equipmentList.paginationCount, { shown, total }),
    paginationPage: (page: number, pages: number) => tr(d.equipmentList.paginationPage, { page, pages }),
    paginationPrevious: d.equipmentList.paginationPrevious,
    paginationNext: d.equipmentList.paginationNext,
    clearRoomFilter: d.equipmentList.clearRoomFilter,
    selection: {
      selectAll: d.equipmentList.selection.selectAll,
      deselectAll: d.equipmentList.selection.deselectAll,
      selectedCount: (count: number) => tr(d.equipmentList.selection.selectedCount, { count }),
      itemAriaLabel: (name: string, selected: boolean) =>
        tr(d.equipmentList.selection.itemAriaLabel, {
          name,
          status: selected
            ? d.equipmentList.selection.itemStatusChecked
            : d.equipmentList.selection.itemStatusUnchecked,
        }),
    },
  },

  equipmentTruth: {
    ...d.equipmentTruth,
    evidenceToggle: (count: number) => tr(d.equipmentTruth.evidenceToggle, { count }),
    locationCheckedOut: (place: string) => tr(d.equipmentTruth.locationCheckedOut, { place }),
    locationRfidRoom: (room: string) => tr(d.equipmentTruth.locationRfidRoom, { room }),
    locationRoom: (room: string) => tr(d.equipmentTruth.locationRoom, { room }),
    coverageNeverConfirmed: (count: number) =>
      tr(d.equipmentTruth.coverageNeverConfirmed, { count }),
    passiveRfidDetail: (label: string, observedAt: string) =>
      tr(d.equipmentTruth.passiveRfidDetail, { label, observedAt }),
    confirmInRoomDesc: (name: string) => tr(d.equipmentTruth.confirmInRoomDesc, { name }),
    confirmInRoomDone: (roomName: string) => tr(d.equipmentTruth.confirmInRoomDone, { roomName }),
    roomSweepDone: (roomName: string, count: number) =>
      tr(d.equipmentTruth.roomSweepDone, { roomName, count }),
    citationTypes: d.equipmentTruth.citationTypes,
  },

  shiftHandoverPage: {
    ...d.shiftHandoverPage,
    pendingEmergenciesAlert: (count: number) => tr(d.shiftHandoverPage.pendingEmergenciesAlert, { count }),
    resolveItems: (count: number) => tr(d.shiftHandoverPage.resolveItems, { count }),
  },

  inventoryPage: {
    ...d.inventoryPage,
    restockingLabel: (name: string) => tr(d.inventoryPage.restockingLabel, { name }),
    shortBy: (count: number) => tr(d.inventoryPage.shortBy, { count }),
    finishRestockWithMissing: (missing: number) => tr(d.inventoryPage.finishRestockWithMissing, { missing }),
    lastSessionAdded: (count: number) => tr(d.inventoryPage.lastSessionAdded, { count }),
    lastSessionRemoved: (count: number) => tr(d.inventoryPage.lastSessionRemoved, { count }),
    lastSessionMissing: (count: number) => tr(d.inventoryPage.lastSessionMissing, { count }),
    errorWithRequestId: (message: string, requestId: string) =>
      tr(d.inventoryPage.errorWithRequestId, { message, requestId }),
  },

  equipmentDetail: {
    serialNumber: d.equipmentDetail.serialNumber,
    model: d.equipmentDetail.model,
    manufacturer: d.equipmentDetail.manufacturer,
    purchaseDate: d.equipmentDetail.purchaseDate,
    location: d.equipmentDetail.location,
    maintenanceInterval: d.equipmentDetail.maintenanceInterval,
    lastMaintenance: d.equipmentDetail.lastMaintenance,
    lastSterilization: d.equipmentDetail.lastSterilization,
    issuePhoto: d.equipmentDetail.issuePhoto,
    loadOlder: d.equipmentDetail.loadOlder,
    describeIssue: d.equipmentDetail.describeIssue,
    addObservations: d.equipmentDetail.addObservations,
    checkedOutBy: (email: string) => tr(d.equipmentDetail.checkedOutBy, { email }),
    updateStatusTitle: d.equipmentDetail.updateStatusTitle,
    statusLabel: d.equipmentDetail.statusLabel,
    reportIssueTitle: d.equipmentDetail.reportIssueTitle,
    localStatePendingSync: d.equipmentDetail.localStatePendingSync,
    localStateConflict: d.equipmentDetail.localStateConflict,
    localStateSyncFailed: d.equipmentDetail.localStateSyncFailed,
    openSyncQueue: d.equipmentDetail.openSyncQueue,
    backToList: d.equipmentDetail.backToList,
    loadFailed: d.equipmentDetail.loadFailed,
    loadFailedHint: d.equipmentDetail.loadFailedHint,
    notFound: d.equipmentDetail.notFound,
    sendWhatsApp: d.equipmentDetail.sendWhatsApp,
    printQrButton: d.equipmentDetail.printQrButton,
    floorNoteAdd: d.equipmentDetail.floorNoteAdd,
    floorNotePlaceholder: d.equipmentDetail.floorNotePlaceholder,
    floorNoteSave: d.equipmentDetail.floorNoteSave,
    floorNoteCancel: d.equipmentDetail.floorNoteCancel,
    floorNoteSaved: d.equipmentDetail.floorNoteSaved,
    floorNoteSaveFailed: d.equipmentDetail.floorNoteSaveFailed,
    confirmHere: d.equipmentDetail.confirmHere,
    confirmedHere: d.equipmentDetail.confirmedHere,
    scanCount: (count: number) => count === 1
      ? d.equipmentDetail.scanCountOnce
      : tr(d.equipmentDetail.scanCount, { count }),
    scanLogTab: d.equipmentDetail.scanLogTab,
    scanLogToday: d.equipmentDetail.scanLogToday,
    scanLogWeek: d.equipmentDetail.scanLogWeek,
    scanLogAll: d.equipmentDetail.scanLogAll,
    scanLogEmpty: d.equipmentDetail.scanLogEmpty,
    tabDetails: d.equipmentDetail.tabDetails,
    tabActivity: d.equipmentDetail.tabActivity,
    lastScanLabel: (time: string) => tr(d.equipmentDetail.lastScanLabel, { time }),
    toolsSheetTitle: d.equipmentDetail.toolsSheetTitle,
    activityEmpty: d.equipmentDetail.activityEmpty,
    activityScan: d.equipmentDetail.activityScan,
    activityTransfer: d.equipmentDetail.activityTransfer,
    maintenanceOverdue: d.equipmentDetail.maintenanceOverdue,
    sterilizationDue: d.equipmentDetail.sterilizationDue,
    expiryExpired: d.equipmentDetail.expiryExpired,
    expirySoon: d.equipmentDetail.expirySoon,
    expiryValid: d.equipmentDetail.expiryValid,
    deleteTitle: (name: string) => tr(d.equipmentDetail.deleteTitle, { name }),
    deleteBody: d.equipmentDetail.deleteBody,
    deleteConfirm: d.equipmentDetail.deleteConfirm,
    deleteAriaLabel: d.equipmentDetail.deleteAriaLabel,
    recoveryBadgeStale: d.equipmentDetail.recoveryBadgeStale,
    recoveryBadgeVeryStale: d.equipmentDetail.recoveryBadgeVeryStale,
    recoveryBadgeCheckedOutLong: d.equipmentDetail.recoveryBadgeCheckedOutLong,
    recoveryAttentionCalloutStale: d.equipmentDetail.recoveryAttentionCalloutStale,
    recoveryAttentionCalloutVeryStale: d.equipmentDetail.recoveryAttentionCalloutVeryStale,
    recoveryAttentionCalloutCheckedOutLong: d.equipmentDetail.recoveryAttentionCalloutCheckedOutLong,
    toast: {
      undone: d.equipmentDetail.toast.undone,
      undoFailed: d.equipmentDetail.toast.undoFailed,
      savedOffline: d.equipmentDetail.toast.savedOffline,
      issueReportedOffline: d.equipmentDetail.toast.issueReportedOffline,
      issueReportedWhatsApp: d.equipmentDetail.toast.issueReportedWhatsApp,
      scanFailed: (msg: string) => msg || d.equipmentDetail.toast.scanFailedDefault,
      checkedOut: d.equipmentDetail.toast.checkedOut,
      checkedOutByYou: d.equipmentDetail.toast.checkedOutByYou,
      dismiss: d.equipmentDetail.toast.dismiss,
      photoSizeLimit: d.equipmentDetail.toast.photoSizeLimit,
      trying: d.equipmentDetail.toast.trying,
      tryAgain: d.equipmentDetail.toast.tryAgain,
      duplicateEquipment: d.equipmentDetail.toast.duplicateEquipment,
      checkoutFailed: (msg: string) => msg || d.equipmentDetail.toast.checkoutFailedDefault,
      returned: d.equipmentDetail.toast.returned,
      returnFailed: (msg: string) => msg || d.equipmentDetail.toast.returnFailedDefault,
      deleted: d.equipmentDetail.toast.deleted,
      deleteFailed: d.equipmentDetail.toast.deleteFailed,
      issueReported: d.equipmentDetail.toast.issueReported,
      issueWhatsAppOffline: d.equipmentDetail.toast.issueWhatsAppOffline,
      reportFailed: (msg: string) => msg || d.equipmentDetail.toast.reportFailedDefault,
    },
    locationCard: {
      title: d.equipmentDetail.locationCard.title,
      unknown: d.equipmentDetail.locationCard.unknown,
      lastKnown: d.equipmentDetail.locationCard.lastKnown,
      confidence: {
        high: d.equipmentDetail.locationCard.confidence.high,
        medium: d.equipmentDetail.locationCard.confidence.medium,
        low: d.equipmentDetail.locationCard.confidence.low,
        unknown: d.equipmentDetail.locationCard.confidence.unknown,
      },
    },
    accountability: {
      title: d.equipmentDetail.accountability.title,
    },
    takePhoto: d.equipmentDetail.takePhoto,
    actionDone: d.equipmentDetail.actionDone,
    actionDoneBody: (name: string) => tr(d.equipmentDetail.actionDoneBody, { name }),
    ariaEdit: d.equipmentDetail.ariaEdit,
    ariaDuplicate: d.equipmentDetail.ariaDuplicate,
    ariaEditFloorNote: d.equipmentDetail.ariaEditFloorNote,
  },

  adminPilotCoverage: {
    title: d.adminPilotCoverage.title,
    total: d.adminPilotCoverage.total,
    everConfirmed: d.adminPilotCoverage.everConfirmed,
    confirmedToday: d.adminPilotCoverage.confirmedToday,
    neverConfirmed: d.adminPilotCoverage.neverConfirmed,
    noItems: d.adminPilotCoverage.noItems,
    statusNever: d.adminPilotCoverage.statusNever,
    statusStale: d.adminPilotCoverage.statusStale,
    statusRecent: d.adminPilotCoverage.statusRecent,
    confirmCount: (count: number) => tr(d.adminPilotCoverage.confirmCount, { count }),
  },

  newEquipment: {
    heading: d.newEquipment.heading,
    fields: d.newEquipment.fields,
    saveChanges: d.newEquipment.saveChanges,
    saveEquipment: d.newEquipment.saveEquipment,
    toast: {
      addSuccess: d.newEquipment.toast.addSuccess,
      addError: (msg: string) => msg || d.newEquipment.toast.addErrorDefault,
      updateSuccess: d.newEquipment.toast.updateSuccess,
      updateError: (msg: string) => msg || d.newEquipment.toast.updateErrorDefault,
      timeout: d.newEquipment.toast.timeout,
    },
  },

  myEquipment: {
    toast: {
      returnSuccess: d.myEquipment.toast.returnSuccess,
      returnError: d.myEquipment.toast.returnError,
      returnAllSuccess: (count: number) => tr(d.myEquipment.toast.returnAllSuccess, { count }),
      returnAllPartialError: d.myEquipment.toast.returnAllPartialError,
    },
    empty: d.myEquipment.empty,
    errors: d.myEquipment.errors,
    actions: d.myEquipment.actions,
    returnAllTitle: (count: number) => tr(d.myEquipment.returnAllTitle, { count }),
    returnAllBody: d.myEquipment.returnAllBody,
    returnAllConfirm: d.myEquipment.returnAllConfirm,
    checkedOutCount: (count: number) => tr(d.myEquipment.checkedOutCount, { count }),
  },

  alerts: {
    types: d.alerts.types,
    itemCount: (count: number) => tr(d.alerts.itemCount, { count }),
    timeAgo: d.alerts.timeAgo,
    toast: d.alerts.toast,
    empty: d.alerts.empty,
    errors: d.alerts.errors,
    details: {
      issue: d.alerts.details.issue,
      overdue: (days: number) => tr(d.alerts.details.overdue, { days }),
      sterilization_due: d.alerts.details.sterilization_due,
      inactive: d.alerts.details.inactive,
    },
  },

  shiftSummary: d.shiftSummary,

  shiftShareCard: {
    ...d.shiftShareCard,
    tasksCompletedOf: (done: number, total: number) =>
      tr(d.shiftShareCard.tasksCompletedOf, { done, total }),
  },

  auth: d.auth,

  shiftAdjustments: d.shiftAdjustments,

  home: d.home,

  equipment: {
    ...d.equipment,
    rfidLastSeen: {
      line: (room: string, relative: string) =>
        tr(d.equipment.rfidLastSeen.line, { room, relative }),
    },
    rfidAttention: {
      checkedOutMismatch: (room: string, holder: string) =>
        tr(d.equipment.rfidAttention.checkedOutMismatch, { room, holder }),
    },
  },
  rooms: d.rooms,

  app: d.app,

  api: d.api,

  dispense: {
    errors: d.dispense.errors,
    bypass: d.dispense.bypass,
    errorMessage: (code: string) => {
      const map = d.dispense.errors as Record<string, string>;
      return map[code] ?? map.fallback;
    },
  },

  syncEngine: d.syncEngine,

  sync: {
    status: {
      syncing: d.sync.status.syncing,
      pending: (count: number) => tr(d.sync.status.pending, { count }),
      failed: (count: number) => tr(d.sync.status.failed, { count }),
    },
    action: {
      retry: d.sync.action.retry,
    },
  },

  scanner: {
    toast: {
      checkedOut: (name: string) => tr(d.scanner.toast.checkedOut, { name }),
      returned: (name: string) => tr(d.scanner.toast.returned, { name }),
    },
  },

  scan: {
    title: d.scan.title,
    scanPrompt: d.scan.scanPrompt,
    checkedInTo: d.scan.checkedInTo,
    passToColleague: d.scan.passToColleague,
    done: d.scan.done,
    transferTitle: d.scan.transferTitle,
    transfer: {
      searchPlaceholder: d.scan.transfer.searchPlaceholder,
      loading: d.scan.transfer.loading,
      noUsers: d.scan.transfer.noUsers,
    },
  },

  codeBlue: {
    ...d.codeBlue,
    selectedManager: (name: string) => tr(d.codeBlue.selectedManager, { name }),
    equipmentLogCount: (n: number) => tr(d.codeBlue.equipmentLogCount, { n }),
    startingForEquipment: (name: string) => tr(d.codeBlue.startingForEquipment, { name }),
    overlay: {
      ...d.codeBlue.overlay,
      pushSentMinutesAgo: (minutes: number) =>
        tr(d.codeBlue.overlay.pushSentMinutesAgo, { minutes }),
    },
    preCheck: {
      ...d.codeBlue.preCheck,
      cartCheckedBy: (name: string) => tr(d.codeBlue.preCheck.cartCheckedBy, { name }),
    },
    display: {
      ...d.codeBlue.display,
      equipmentCountLine: (n: number) => tr(d.codeBlue.display.equipmentCountLine, { n }),
    },
    history: {
      ...d.codeBlue.history,
      minutesShort: (n: number) => tr(d.codeBlue.history.minutesShort, { n }),
      managerOpenedBy: (manager: string, opener: string) =>
        tr(d.codeBlue.history.managerOpenedBy, { manager, opener }),
    },
    reconciliation: {
      ...d.codeBlue.reconciliation,
      toast: { ...d.codeBlue.reconciliation.toast },
      action: { ...d.codeBlue.reconciliation.action },
      badge: { ...d.codeBlue.reconciliation.badge },
      unbilledCount: (count: number) => tr(d.codeBlue.reconciliation.unbilledCount, { count }),
      billedRatio: (billed: number, total: number) =>
        tr(d.codeBlue.reconciliation.billedRatio, { billed, total }),
      quantityLabel: (n: number) => tr(d.codeBlue.reconciliation.quantityLabel, { n }),
      reconciledAt: (time: string) => tr(d.codeBlue.reconciliation.reconciledAt, { time }),
      pendingHeader: (count: number) => tr(d.codeBlue.reconciliation.pendingHeader, { count }),
      reconciledHeader: (count: number) => tr(d.codeBlue.reconciliation.reconciledHeader, { count }),
    },
  },

  nfc: {
    error: {
      invalidContainerTag: d.nfc.error.invalidContainerTag,
      invalidInventoryItemTag: d.nfc.error.invalidInventoryItemTag,
      restockSessionRequired: d.nfc.error.restockSessionRequired,
      scanFailed: d.nfc.error.scanFailed,
      noActiveRestockSession: d.nfc.error.noActiveRestockSession,
    },
  },

  equipmentNfc: {
    toggleCheckedOut: (name: string) => tr(d.equipmentNfc.toggleCheckedOut, { name }),
    toggleReturned: (name: string) => tr(d.equipmentNfc.toggleReturned, { name }),
    toggleBlocked: (email: string) => tr(d.equipmentNfc.toggleBlocked, { email }),
    onlineRequired: d.equipmentNfc.onlineRequired,
    scanReady: d.equipmentNfc.scanReady,
    scanStartFailed: d.equipmentNfc.scanStartFailed,
    enableScan: d.equipmentNfc.enableScan,
    writeSuccess: d.equipmentNfc.writeSuccess,
    writeFailed: d.equipmentNfc.writeFailed,
    writeUnsupported: d.equipmentNfc.writeUnsupported,
    writeTag: d.equipmentNfc.writeTag,
    alreadyToggledRecently: d.equipmentNfc.alreadyToggledRecently,
    toggling: (name: string) => tr(d.equipmentNfc.toggling, { name }),
  },

  nfcEntry: {
    openingEquipment: d.nfcEntry.openingEquipment,
    signInFirst: d.nfcEntry.signInFirst,
  },

  admin: {
    crashCart: {
      ...d.admin.crashCart,
      itemSubtitle: (key: string, qty: number) => tr(d.admin.crashCart.itemSubtitle, { key, qty }),
      expiryWarnSuffix: (days: number) => tr(d.admin.crashCart.expiryWarnSuffix, { days }),
      removeConfirmDesc: (label: string) => tr(d.admin.crashCart.removeConfirmDesc, { label }),
    },
    formulary: {
      ...d.admin.formulary,
      removeConfirmDesc: (name: string) => tr(d.admin.formulary.removeConfirmDesc, { name }),
    },
    csvImport: d.admin.csvImport,
  },

  errors: d.errors,

  errorCard: d.errorCard,

  swUpdate: d.swUpdate,

  reportIssueDialog: d.reportIssueDialog,

  qrScanner: {
    ...d.qrScanner,
    markedOk: (name: string) => tr(d.qrScanner.markedOk, { name }),
    inUseBy: (name: string) => tr(d.qrScanner.inUseBy, { name }),
    locationLabel: (location: string) => tr(d.qrScanner.locationLabel, { location }),
  },

  onboarding: {
    step1: d.onboarding.step1,
    step2: d.onboarding.step2,
    step3: d.onboarding.step3,
    step1Tag: d.onboarding.step1Tag,
    step1Title: d.onboarding.step1Title,
    step1Description: d.onboarding.step1Description,
    step1Tip: d.onboarding.step1Tip,
    step2Tag: d.onboarding.step2Tag,
    step2Title: d.onboarding.step2Title,
    step2Description: d.onboarding.step2Description,
    step2Tip: d.onboarding.step2Tip,
    step3Tag: d.onboarding.step3Tag,
    step3Title: d.onboarding.step3Title,
    step3Description: d.onboarding.step3Description,
    step3Tip: d.onboarding.step3Tip,
    gotIt: d.onboarding.gotIt,
    next: d.onboarding.next,
  },

  moveRoomSheet: {
    movedTo: (roomName: string) => tr(d.moveRoomSheet.movedTo, { roomName }),
    movedToDefaultRoom: d.moveRoomSheet.movedToDefaultRoom,
    removedFromRoom: d.moveRoomSheet.removedFromRoom,
    moveFailed: d.moveRoomSheet.moveFailed,
  },

  moveRoom: {
    toast: {
      movedTo: (roomName: string) => tr(d.moveRoom.toast.movedTo, { roomName }),
      defaultRoomName: d.moveRoom.toast.defaultRoomName,
      removedFromRoom: d.moveRoom.toast.removedFromRoom,
      moveFailed: d.moveRoom.toast.moveFailed,
    },
  },

  syncQueueSheet: d.syncQueueSheet,

  settingsPage: d.settingsPage,

  adminShiftsPage: {
    ...d.adminShiftsPage,
    rowLabel: (row: number) => tr(d.adminShiftsPage.rowLabel, { row }),
  },

  alertsPage: {
    ...d.alertsPage,
    minutesAgo: (minutes: number) => tr(d.alertsPage.minutesAgo, { minutes }),
    hoursAgo: (hours: number) => tr(d.alertsPage.hoursAgo, { hours }),
    daysAgo: (days: number) => tr(d.alertsPage.daysAgo, { days }),
    activeCount: (count: number) => tr(d.alertsPage.activeCount, { count }),
    openSummary: (total: number, urgent: number) =>
      tr(d.alertsPage.openSummary, { total, urgent }),
  },

  analyticsPage: {
    ...d.analyticsPage,
    maintenanceLabelEn: d.analyticsPage.maintenanceLabel,
    itemsLabelEn: d.analyticsPage.itemsLabel,
    issueCountBadge: (count: number) => tr(d.analyticsPage.issueCountBadge, { count }),
  },

  monthlyReport: {
    ...d.monthlyReport,
    andMore: (count: number) => tr(d.monthlyReport.andMore, { count }),
    insightOperational: (pct: number) => tr(d.monthlyReport.insightOperational, { pct }),
    insightMissing: (count: number) => tr(d.monthlyReport.insightMissing, { count }),
    insightIssues: (count: number) => tr(d.monthlyReport.insightIssues, { count }),
    footer: (total: number, generatedAt: string) =>
      tr(d.monthlyReport.footer, { total, generatedAt }),
  },

  outcomeKpiDashboard: d.outcomeKpiDashboard,

  myEquipmentPage: d.myEquipmentPage,

  notFoundPage: d.notFoundPage,

  homePage: {
    ...d.homePage,
    greeting: (name: string) => tr(d.homePage.greeting, { name }),
    hello: (name: string) => tr(d.homePage.hello, { name }),
    shiftLine: (time: string) => tr(d.homePage.shiftLine, { time }),
    progressComplete: (pct: number) => tr(d.homePage.progressComplete, { pct }),
    streakLabel: (count: number) => tr(d.homePage.streakLabel, { count }),
    nextUpDueIn: (time: string) => tr(d.homePage.nextUpDueIn, { time }),
    nextUpOverdueBy: (time: string) => tr(d.homePage.nextUpOverdueBy, { time }),
    etaMinutes: (count: number) => tr(d.homePage.etaMinutes, { count }),
    etaHours: (count: number) => tr(d.homePage.etaHours, { count }),
    triageAlertsHint: (count: number) => tr(d.homePage.triageAlertsHint, { count }),
    glanceLine: (tasksDone: number, tasksTotal: number, scans: number, patients: number) =>
      tr(d.homePage.glanceLine, { tasksDone, tasksTotal, scans, patients }),
    winScansToday: (count: number) => tr(d.homePage.winScansToday, { count }),
    urgentCriticalAlerts: (count: number) => tr(d.homePage.urgentCriticalAlerts, { count }),
    urgentOverdueTasks: (count: number) => tr(d.homePage.urgentOverdueTasks, { count }),
    greetingMorning: (name: string) => tr(d.homePage.greetingMorning, { name }),
    greetingAfternoon: (name: string) => tr(d.homePage.greetingAfternoon, { name }),
    greetingEvening: (name: string) => tr(d.homePage.greetingEvening, { name }),
    startedAt: (time: string) => tr(d.homePage.startedAt, { time }),
    elapsedDays: (count: number) => tr(d.homePage.elapsedDays, { count }),
  },

  assetCopilot: d.assetCopilot,

  shiftRecap: {
    ...d.shiftRecap,
    cardGreeting: (name: string) => tr(d.shiftRecap.cardGreeting, { name }),
    shareHeadline: (name: string, date: string) => tr(d.shiftRecap.shareHeadline, { name, date }),
    shareProgress: (pct: number) => tr(d.shiftRecap.shareProgress, { pct }),
    shareTasks: (done: number, total: number) => tr(d.shiftRecap.shareTasks, { done, total }),
    shareScans: (count: number) => tr(d.shiftRecap.shareScans, { count }),
    shareStreak: (count: number) => tr(d.shiftRecap.shareStreak, { count }),
  },

  scanCelebration: d.scanCelebration,

  landingPage: {
    ...d.landingPage,
    howStepLabel: (stepNum: string) => tr(d.landingPage.howStepLabel, { stepNum }),
  },

  helpPage: d.helpPage,

  pilotHomePage: {
    ...d.pilotHomePage,
    recoverySublineStale: (relative: string) =>
      tr(d.pilotHomePage.recoverySublineStale, { relative }),
    recoverySublineVeryStale: (relative: string) =>
      tr(d.pilotHomePage.recoverySublineVeryStale, { relative }),
    recoveryLastConfirmed: (relative: string) =>
      tr(d.pilotHomePage.recoveryLastConfirmed, { relative }),
  },

  roomRadarPage: {
    ...d.roomRadarPage,
    verifyAllInRoom: (roomName: string) => tr(d.roomRadarPage.verifyAllInRoom, { roomName }),
    itemsVerified: (count: number) => tr(d.roomRadarPage.itemsVerified, { count }),
    filterHint: (shown: number, total: number) => tr(d.roomRadarPage.filterHint, { shown, total }),
  },

  roomsListPage: {
    ...d.roomsListPage,
    subtitle: (count: number) => tr(d.roomsListPage.subtitle, { count }),
  },

  managementDashboardPage: d.managementDashboardPage,

  qrPrintPage: d.qrPrintPage,

  stabilityPage: d.stabilityPage,

  shiftSummaryPage: {
    ...d.shiftSummaryPage,
    reportHeader: (dateStr: string) => tr(d.shiftSummaryPage.reportHeader, { dateStr }),
    checkedOutLine: (name: string, loc: string, since: string) =>
      loc
        ? tr(d.shiftSummaryPage.checkedOutLineWithLoc, { name, loc, since })
        : tr(d.shiftSummaryPage.checkedOutLineNoLoc, { name, since }),
    todayUsageHeader: (count: number) => tr(d.shiftSummaryPage.todayUsageHeader, { count }),
  },

  adminPage: {
    ...d.adminPage,
    logEntries: (count: number, hasMore: boolean) =>
      tr(d.adminPage.logEntries, { count, hasMoreSuffix: hasMore ? "+" : "" }),
    logClientPage: (current: number, total: number) =>
      tr(d.adminPage.logClientPage, { current, total }),
    signedUp: (date: string) => tr(d.adminPage.signedUp, { date }),
    joined: (date: string) => tr(d.adminPage.joined, { date }),
    rejectUserTitle: (name: string) => tr(d.adminPage.rejectUserTitle, { name }),
    deleteUserTitle: (name: string) => tr(d.adminPage.deleteUserTitle, { name }),
    deleteFolderTitle: (name: string) => tr(d.adminPage.deleteFolderTitle, { name }),
    deletedOn: (date: string) => tr(d.adminPage.deletedOn, { date }),
    blockUserTitle: (name: string) => tr(d.adminPage.blockUserTitle, { name }),
    formularyDeleteTitle: (name: string) => tr(d.adminPage.formularyDeleteTitle, { name }),
    auditLogRoleLabel: (role: string) => tr(d.adminPage.auditLogRoleLabel, { role }),
    auditLogBatch: (page: number) => tr(d.adminPage.auditLogBatch, { page }),
  },

  layoutHebrew: {
    ...d.layoutHebrew,
    pendingShort: (count: number) => tr(d.layoutHebrew.pendingShort, { count }),
    failedShort: (count: number) => tr(d.layoutHebrew.failedShort, { count }),
    pendingTitle: (count: number) => tr(d.layoutHebrew.pendingTitle, { count }),
    failedTitle: (count: number) => tr(d.layoutHebrew.failedTitle, { count }),
    pendingTooltip: (count: number) => tr(d.layoutHebrew.pendingTooltip, { count }),
    alertAria: (count: number) => tr(d.layoutHebrew.alertAria, { count }),
  },

  conflictModal: d.conflictModal,

  updateBanner: {
    newVersion: (version: string) => tr(d.updateBanner.newVersion, { version }),
    seeWhatsNew: d.updateBanner.seeWhatsNew,
    dismissAria: d.updateBanner.dismissAria,
  },

  pageErrorBoundary: d.pageErrorBoundary,

  billingLedger: d.billingLedger,

  patientDetail: d.patientDetail,

  patientsPage: d.patientsPage,

  inventoryItemsPage: d.inventoryItemsPage,

  inventoryItemDetailPage: {
    ...d.inventoryItemDetailPage,
    usageTotal: (count: number) => tr(d.inventoryItemDetailPage.usageTotal, { count }),
    parLabel: (count: number) => tr(d.inventoryItemDetailPage.parLabel, { count }),
    belowReorder: (count: number) => tr(d.inventoryItemDetailPage.belowReorder, { count }),
  },

  procurementPage: d.procurementPage,

  medsPage: {
    ...d.medsPage,
    prescribed: (dose: string) => tr(d.medsPage.prescribed, { dose }),
    concentration: (conc: string) => tr(d.medsPage.concentration, { conc }),
    routeLabel: (route: string) => tr(d.medsPage.routeLabel, { route }),
    concentrationLabel: (conc: string) => tr(d.medsPage.concentrationLabel, { conc }),
    mgTotal: (mg: string) => tr(d.medsPage.mgTotal, { mg }),
    assignMedicationWithVolume: (volume: string) => tr(d.medsPage.assignMedicationWithVolume, { volume }),
    assignMedicationWithTab: (tab: string) => tr(d.medsPage.assignMedicationWithTab, { tab }),
    deviationFromRecommended: (sign: string, pct: string) => tr(d.medsPage.deviationFromRecommended, { sign, pct }),
    deviationBlocked: (sign: string, pct: string) => tr(d.medsPage.deviationBlocked, { sign, pct }),
    medicationTaskCreated: (volume: string) => tr(d.medsPage.medicationTaskCreated, { volume }),
  },

  pharmacyForecast: {
    ...d.pharmacyForecast,
    chipDrugs: (count: number) => tr(d.pharmacyForecast.chipDrugs, { count }),
    chipCri: (count: number) => tr(d.pharmacyForecast.chipCri, { count }),
    chipPrn: (count: number) => tr(d.pharmacyForecast.chipPrn, { count }),
    chipLd: (count: number) => tr(d.pharmacyForecast.chipLd, { count }),
    chipFlags: (count: number) => tr(d.pharmacyForecast.chipFlags, { count }),
    approveBlocked: (n: number) => tr(d.pharmacyForecast.approveBlocked, { n }),
    approveGateLabel: (code: string, fallback: string) =>
      ({
        UNRESOLVED_PATIENT_FLAGS: d.pharmacyForecast.approveGateUnresolvedPatientFlags,
        UNRESOLVED_DRUG_FLAGS: d.pharmacyForecast.approveGateUnresolvedDrugFlags,
        PRN_QUANTITY_REQUIRED: d.pharmacyForecast.approveGatePrnQuantityRequired,
        NO_DRUG_LINES: d.pharmacyForecast.approveGateNoDrugLines,
      } as Record<string, string>)[code] ?? fallback,
    emailPreviewSummary: (patientCount: number, hours: number) =>
      tr(d.pharmacyForecast.emailPreviewSummary, { patientCount, hours }),
    smtpFallbackWarning: (reason: string) =>
      tr(d.pharmacyForecast.smtpFallbackWarning, { reason }),
    quantityFrequencyBasis: (per24: number, inWindow: number, hours: number) =>
      tr(d.pharmacyForecast.quantityFrequencyBasis, { per24, inWindow, hours }),
  },

  appointmentsPage: {
    ...d.appointmentsPage,
    scheduledAt: (time: string) => tr(d.appointmentsPage.scheduledAt, { time }),
    prescribedBy: (name: string) => tr(d.appointmentsPage.prescribedBy, { name }),
    shiftWindowsFor: (name: string) => tr(d.appointmentsPage.shiftWindowsFor, { name }),
    minutesShort: (n: number) => tr(d.appointmentsPage.minutesShort, { n }),
    statusHint: {
      ...d.appointmentsPage.statusHint,
      overdue: (count: number) => tr(d.appointmentsPage.statusHint.overdue, { count }),
    },
  },

  cop: {
    ...d.cop,
    drugLine: (drug: string, qty: number) => tr(d.cop.drugLine, { drug, qty }),
    chargedNoAdminDetail: (params: { billingId: string; hours: number }) =>
      tr(d.cop.chargedNoAdminDetail, { billingId: params.billingId, hours: params.hours }),
    adminNoDispenseDetail: (params: { taskId: string; hours: number }) =>
      tr(d.cop.adminNoDispenseDetail, { taskId: params.taskId, hours: params.hours }),
  },

  adminMedicationIntegrity: d.adminMedicationIntegrity,

  adminOpsDashboard: d.adminOpsDashboard,

  er: d.er,

  erCommandCenter: {
    title: d.erCommandCenter.title,
    lanes: d.erCommandCenter.lanes,
    quickScan: d.erCommandCenter.quickScan,
    quickScanNoPatient: d.erCommandCenter.quickScanNoPatient,
    quickScanPickPatientFirst: d.erCommandCenter.quickScanPickPatientFirst,
    quickIntake: d.erCommandCenter.quickIntake,
    species: d.erCommandCenter.species,
    severity: d.erCommandCenter.severity,
    complaint: d.erCommandCenter.complaint,
    submitIntake: d.erCommandCenter.submitIntake,
    assign: d.erCommandCenter.assign,
    ack: d.erCommandCenter.ack,
    impactLink: d.erCommandCenter.impactLink,
    refresh: d.erCommandCenter.refresh,
    loadingBoard: d.erCommandCenter.loadingBoard,
    createHandoff: d.erCommandCenter.createHandoff,
    handoffPatient: d.erCommandCenter.handoffPatient,
    handoffSelectPatient: d.erCommandCenter.handoffSelectPatient,
    handoffCurrentStability: d.erCommandCenter.handoffCurrentStability,
    handoffPendingTasks: d.erCommandCenter.handoffPendingTasks,
    handoffCriticalWarnings: d.erCommandCenter.handoffCriticalWarnings,
    handoffActiveIssue: d.erCommandCenter.handoffActiveIssue,
    handoffNextAction: d.erCommandCenter.handoffNextAction,
    handoffEtaMinutes: d.erCommandCenter.handoffEtaMinutes,
    handoffOwner: d.erCommandCenter.handoffOwner,
    handoffOwnerUnassigned: d.erCommandCenter.handoffOwnerUnassigned,
    handoffAddItem: d.erCommandCenter.handoffAddItem,
    handoffSubmit: d.erCommandCenter.handoffSubmit,
    handoffNoPatients: d.erCommandCenter.handoffNoPatients,
    handoffItem: (n: number) => tr(d.erCommandCenter.handoffItem, { n: String(n) }),
    ackOverride: d.erCommandCenter.ackOverride,
    ackDeniedTooltip: d.erCommandCenter.ackDeniedTooltip,
    ackOverrideTooltip: d.erCommandCenter.ackOverrideTooltip,
    overrideModalTitle: d.erCommandCenter.overrideModalTitle,
    overrideModalDesc: d.erCommandCenter.overrideModalDesc,
    overrideReasonLabel: d.erCommandCenter.overrideReasonLabel,
    overrideReasonPlaceholder: d.erCommandCenter.overrideReasonPlaceholder,
    overrideCancel: d.erCommandCenter.overrideCancel,
    overrideConfirm: d.erCommandCenter.overrideConfirm,
    badges: d.erCommandCenter.badges,
    escalationTimer: (time: string) => tr(d.erCommandCenter.escalationTimer, { time }),
    escalationOverdue: d.erCommandCenter.escalationOverdue,
    reconciliationWarning: d.erCommandCenter.reconciliationWarning,
    activeAssistance: {
      title: d.erCommandCenter.activeAssistance.title,
      toggleOn: d.erCommandCenter.activeAssistance.toggleOn,
      toggleOff: d.erCommandCenter.activeAssistance.toggleOff,
      toggleHint: d.erCommandCenter.activeAssistance.toggleHint,
      noSession: d.erCommandCenter.activeAssistance.noSession,
      openCodeBlue: d.erCommandCenter.activeAssistance.openCodeBlue,
      activePatient: (name: string) => tr(d.erCommandCenter.activeAssistance.activePatient, { name }),
      weightHint: (weight: number) =>
        tr(d.erCommandCenter.activeAssistance.weightHint, { weight: String(weight) }),
      metronome: d.erCommandCenter.activeAssistance.metronome,
      bpm: d.erCommandCenter.activeAssistance.bpm,
      bpmIncrease: d.erCommandCenter.activeAssistance.bpmIncrease,
      bpmDecrease: d.erCommandCenter.activeAssistance.bpmDecrease,
      metronomeStart: d.erCommandCenter.activeAssistance.metronomeStart,
      metronomePause: d.erCommandCenter.activeAssistance.metronomePause,
      soundOn: d.erCommandCenter.activeAssistance.soundOn,
      soundOff: d.erCommandCenter.activeAssistance.soundOff,
      beatIndicator: d.erCommandCenter.activeAssistance.beatIndicator,
      medTimers: d.erCommandCenter.activeAssistance.medTimers,
      epiTimerLabel: d.erCommandCenter.activeAssistance.epiTimerLabel,
      adjTimerLabel: d.erCommandCenter.activeAssistance.adjTimerLabel,
      reset: d.erCommandCenter.activeAssistance.reset,
      timerDue: d.erCommandCenter.activeAssistance.timerDue,
      quickLog: d.erCommandCenter.activeAssistance.quickLog,
      unitsMg: d.erCommandCenter.activeAssistance.unitsMg,
      unitsU: d.erCommandCenter.activeAssistance.unitsU,
      logDisabled: d.erCommandCenter.activeAssistance.logDisabled,
      drugs: d.erCommandCenter.activeAssistance.drugs,
      logLabels: d.erCommandCenter.activeAssistance.logLabels,
    },
    icuTelemetry: {
      stripAria: d.erCommandCenter.icuTelemetry.stripAria,
      stripHeading: d.erCommandCenter.icuTelemetry.stripHeading,
      asOf: (time: string) => tr(d.erCommandCenter.icuTelemetry.asOf, { time }),
      noVitals: d.erCommandCenter.icuTelemetry.noVitals,
      vent: d.erCommandCenter.icuTelemetry.vent,
      ventOn: d.erCommandCenter.icuTelemetry.ventOn,
      panelAria: d.erCommandCenter.icuTelemetry.panelAria,
      signals: d.erCommandCenter.icuTelemetry.signals,
      hr: d.erCommandCenter.icuTelemetry.hr,
      rr: d.erCommandCenter.icuTelemetry.rr,
      spo2: d.erCommandCenter.icuTelemetry.spo2,
      etco2: d.erCommandCenter.icuTelemetry.etco2,
      ventilated: d.erCommandCenter.icuTelemetry.ventilated,
      fio2: d.erCommandCenter.icuTelemetry.fio2,
      peep: d.erCommandCenter.icuTelemetry.peep,
      mode: d.erCommandCenter.icuTelemetry.mode,
      unitBpm: d.erCommandCenter.icuTelemetry.unitBpm,
      unitRr: d.erCommandCenter.icuTelemetry.unitRr,
      unitPct: d.erCommandCenter.icuTelemetry.unitPct,
      unitMmHg: d.erCommandCenter.icuTelemetry.unitMmHg,
      unitPeep: d.erCommandCenter.icuTelemetry.unitPeep,
      temp: d.erCommandCenter.icuTelemetry.temp,
      unitTemp: d.erCommandCenter.icuTelemetry.unitTemp,
      bp: d.erCommandCenter.icuTelemetry.bp,
      staleBadge: d.erCommandCenter.icuTelemetry.staleBadge,
      dataStaleRecheck: d.erCommandCenter.icuTelemetry.dataStaleRecheck,
      ventilatorActive: d.erCommandCenter.icuTelemetry.ventilatorActive,
      sysOverDia: (sys: number, dia: number) =>
        tr(d.erCommandCenter.icuTelemetry.sysOverDia, { sys, dia }),
      lastUpdated: (time: string) => tr(d.erCommandCenter.icuTelemetry.lastUpdated, { time }),
    },
  },

  erImpact: {
    title: d.erImpact.title,
    subtitle: d.erImpact.subtitle,
    windowLabel: d.erImpact.windowLabel,
    windowDays: (n: number) => tr(d.erImpact.windowDays, { n }),
    baselinePeriod: d.erImpact.baselinePeriod,
    generatedAt: d.erImpact.generatedAt,
    loadError: d.erImpact.loadError,
    noData: d.erImpact.noData,
    metricBaseline: d.erImpact.metricBaseline,
    metricCurrent: d.erImpact.metricCurrent,
    metricDelta: d.erImpact.metricDelta,
    metricDeltaPct: d.erImpact.metricDeltaPct,
    kpi: d.erImpact.kpi,
    confidence: d.erImpact.confidence,
  },

  erOperationalControl: {
    sectionTitle: d.erOperationalControl.sectionTitle,
    currentMode: d.erOperationalControl.currentMode,
    states: d.erOperationalControl.states,
    targetLabel: d.erOperationalControl.targetLabel,
    apply: d.erOperationalControl.apply,
    confirmTitle: d.erOperationalControl.confirmTitle,
    confirmBody: (from: string, to: string) =>
      tr(d.erOperationalControl.confirmBody, { from, to }),
    confirmAction: d.erOperationalControl.confirmAction,
    cancel: d.erOperationalControl.cancel,
    toggleFailed: d.erOperationalControl.toggleFailed,
    ariaOperationalToggle: d.erOperationalControl.ariaOperationalToggle,
  },

  shiftChat: {
    ...d.shiftChat,
    openChatUnread: (count: string) => tr(d.shiftChat.openChatUnread, { count }),
    panel: {
      ...d.shiftChat.panel,
      onlineCount: (count: number) => tr(d.shiftChat.panel.onlineCount, { count }),
      typing: (names: string) => tr(d.shiftChat.panel.typing, { names }),
    },
  },

  auditLog: {
    actions: d.auditLog.actions as Record<string, string>,
    actionLabel: (actionType: string): string => {
      const map = d.auditLog.actions as Record<string, string>;
      const explicit = map[actionType];
      if (explicit) return explicit;
      // Fallback: humanize an unmapped key (snake/dot case → spaced + capitalized)
      // so a raw key like "code_blue_initiator_authority_denied" never leaks to the UI.
      const humanized = actionType.replace(/[._]+/g, " ").trim();
      return humanized ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : actionType;
    },
  },

  whatsAppMessage: {
    alertTitle: d.whatsAppMessage.alertTitle,
    equipmentLabel: d.whatsAppMessage.equipmentLabel,
    statusLabel: d.whatsAppMessage.statusLabel,
    timeLabel: d.whatsAppMessage.timeLabel,
    noteLabel: d.whatsAppMessage.noteLabel,
    actionRequired: d.whatsAppMessage.actionRequired,
    statusReport: (name: string) => tr(d.whatsAppMessage.statusReport, { name }),
  },

  leakageReport: d.leakageReport,

  inventoryJobsPage: {
    ...d.inventoryJobsPage,
    loadError: (params: { message: string }) => tr(d.inventoryJobsPage.loadError, params),
    empty: (params: { status: string }) => tr(d.inventoryJobsPage.empty, params),
  },

  crashCart: {
    title: d.crashCart.title,
    settingsAria: d.crashCart.settingsAria,
    loadError: d.crashCart.loadError,
    saveError: d.crashCart.saveError,
    checkedAgo: (time: string, name: string) => tr(d.crashCart.checkedAgo, { time, name }),
    notCheckedToday: d.crashCart.notCheckedToday,
    highRiskPatients: (count: number) => tr(d.crashCart.highRiskPatients, { count }),
    weightKg: (weight: number) => tr(d.crashCart.weightKg, { weight }),
    loadingItems: d.crashCart.loadingItems,
    itemsToCheck: d.crashCart.itemsToCheck,
    customizeTitle: d.crashCart.customizeTitle,
    customizeDescription: d.crashCart.customizeDescription,
    customizeButton: d.crashCart.customizeButton,
    nonAdminHint: d.crashCart.nonAdminHint,
    missingItemsNotesPlaceholder: d.crashCart.missingItemsNotesPlaceholder,
    saveAllOk: d.crashCart.saveAllOk,
    saveWithMissing: d.crashCart.saveWithMissing,
    checkItemAria: (label: string, checked: boolean) =>
      tr(d.crashCart.checkItemAria, {
        label,
        status: checked ? d.crashCart.checkItemStatusChecked : d.crashCart.checkItemStatusUnchecked,
      }),
    checkSaved: d.crashCart.checkSaved,
    historyTitle: d.crashCart.historyTitle,
    statusOk: d.crashCart.statusOk,
    statusMissing: d.crashCart.statusMissing,
    relativeHoursMinutes: (h: number, m: number) => tr(d.crashCart.relativeHoursMinutes, { h, m }),
    relativeMinutes: (m: number) => tr(d.crashCart.relativeMinutes, { m }),
  },

  operationalState: {
    invalidCustodyForDockReturn: d.operationalState.invalidCustodyForDockReturn,
    dockMasterTagNotFound: d.operationalState.dockMasterTagNotFound,
    ambiguousDocks: d.operationalState.ambiguousDocks,
    noAssetTypeDefined: d.operationalState.noAssetTypeDefined,
    crossClinicAssociation: d.operationalState.crossClinicAssociation,
    conditionNotFound: d.operationalState.conditionNotFound,
    conditionWrongAssetType: d.operationalState.conditionWrongAssetType,
    versionConflict: d.operationalState.versionConflict,
    invalidCustodyForStaging: d.operationalState.invalidCustodyForStaging,
    equipmentNotReady: d.operationalState.equipmentNotReady,
    equipmentUnavailable: d.operationalState.equipmentUnavailable,
    claimNotActive: d.operationalState.claimNotActive,
    hospitalizationDischarged: d.operationalState.hospitalizationDischarged,
    invalidCustody: d.operationalState.invalidCustody,
    equipmentNotBound: d.operationalState.equipmentNotBound,
    duplicateClaim: d.operationalState.duplicateClaim,
    custodyState: {
      docked: d.operationalState.custodyState.docked,
      checked_out: d.operationalState.custodyState.checked_out,
      untracked: d.operationalState.custodyState.untracked,
      returned: d.operationalState.custodyState.returned,
    },
    readinessState: {
      ready: d.operationalState.readinessState.ready,
      not_ready: d.operationalState.readinessState.not_ready,
      unknown: d.operationalState.readinessState.unknown,
    },
    usageState: {
      available: d.operationalState.usageState.available,
      staged: d.operationalState.usageState.staged,
      in_use: d.operationalState.usageState.in_use,
      emergency_use: d.operationalState.usageState.emergency_use,
      procedure_bound: d.operationalState.usageState.procedure_bound,
    },
    fullDeployable: d.operationalState.fullDeployable,
    notDeployable: d.operationalState.notDeployable,
    setupRequired: d.operationalState.setupRequired,
    procedureBindNotReadyWarning: d.operationalState.procedureBindNotReadyWarning,
    procedureBound: d.operationalState.procedureBound,
    procedureReleased: d.operationalState.procedureReleased,
    bundleGateReason: d.operationalState.bundleGateReason,
  },

  dockReturn: {
    title: d.dockReturn.title,
    selectDock: d.dockReturn.selectDock,
    conditions: d.dockReturn.conditions,
    submit: d.dockReturn.submit,
    success: d.dockReturn.success,
    readyAfterReturn: d.dockReturn.readyAfterReturn,
    notReadyAfterReturn: d.dockReturn.notReadyAfterReturn,
    noAssetTypeBlocked: d.dockReturn.noAssetTypeBlocked,
    goToSetup: d.dockReturn.goToSetup,
    noConditionsWarning: d.dockReturn.noConditionsWarning,
    nfcConfirmTitle: d.dockReturn.nfcConfirmTitle,
    scanDockMasterTag: d.dockReturn.scanDockMasterTag,
    scanDockFailed: d.dockReturn.scanDockFailed,
    versionConflict: d.dockReturn.versionConflict,
    confirmAtDockCta: d.dockReturn.confirmAtDockCta,
  },

  bundleConditions: {
    verified: d.bundleConditions.verified,
    notVerified: d.bundleConditions.notVerified,
    stale: d.bundleConditions.stale,
    unknown: d.bundleConditions.unknown,
    verificationMethod: {
      visual: d.bundleConditions.verificationMethod.visual,
      electronic: d.bundleConditions.verificationMethod.electronic,
      manual: d.bundleConditions.verificationMethod.manual,
    },
    verifiedAt: d.bundleConditions.verifiedAt,
    verifiedBy: d.bundleConditions.verifiedBy,
  },

  stagingQueue: {
    title: d.stagingQueue.title,
    priority: {
      routine: d.stagingQueue.priority.routine,
      urgent: d.stagingQueue.priority.urgent,
      emergency: d.stagingQueue.priority.emergency,
    },
    expiresAt: d.stagingQueue.expiresAt,
    myPosition: d.stagingQueue.myPosition,
    cancelClaim: d.stagingQueue.cancelClaim,
    requestStage: d.stagingQueue.requestStage,
    conflict: d.stagingQueue.conflict,
    youAreFirst: d.stagingQueue.youAreFirst,
    promotedTitle: d.stagingQueue.promotedTitle,
    promotedBody: d.stagingQueue.promotedBody,
    readinessTab: d.stagingQueue.readinessTab,
    bindToHospitalization: d.stagingQueue.bindToHospitalization,
    selectHospitalization: d.stagingQueue.selectHospitalization,
    releaseFromProcedure: d.stagingQueue.releaseFromProcedure,
    confirmRelease: d.stagingQueue.confirmRelease,
    confirmReleaseDescription: d.stagingQueue.confirmReleaseDescription,
  },

  equipmentWaitlist: {
    title: d.equipmentWaitlist.title,
    join: d.equipmentWaitlist.join,
    leave: d.equipmentWaitlist.leave,
    queueSize: d.equipmentWaitlist.queueSize,
    myPosition: d.equipmentWaitlist.myPosition,
    notifiedBanner: d.equipmentWaitlist.notifiedBanner,
    holderContext: {
      inUse: d.equipmentWaitlist.holderContext.inUse,
      expectedReturnAround: d.equipmentWaitlist.holderContext.expectedReturnAround,
      noEstimate: d.equipmentWaitlist.holderContext.noEstimate,
      overdue: d.equipmentWaitlist.holderContext.overdue,
    },
    reservedForYou: {
      title: d.equipmentWaitlist.reservedForYou.title,
      subtitle: d.equipmentWaitlist.reservedForYou.subtitle,
      checkout: d.equipmentWaitlist.reservedForYou.checkout,
      expiresIn: d.equipmentWaitlist.reservedForYou.expiresIn,
      nextInLine: d.equipmentWaitlist.reservedForYou.nextInLine,
    },
    reservationExpires: d.equipmentWaitlist.reservationExpires,
    offlineBlocked: d.equipmentWaitlist.offlineBlocked,
    promotedTitle: d.equipmentWaitlist.promotedTitle,
    promotedBody: d.equipmentWaitlist.promotedBody,
    promotedToast: d.equipmentWaitlist.promotedToast,
    promotedToastDescription: d.equipmentWaitlist.promotedToastDescription,
    viewDevice: d.equipmentWaitlist.viewDevice,
    WAITLIST_NOT_IN_USE: d.equipmentWaitlist.WAITLIST_NOT_IN_USE,
    WAITLIST_SELF_CHECKOUT: d.equipmentWaitlist.WAITLIST_SELF_CHECKOUT,
    WAITLIST_ALREADY_JOINED: d.equipmentWaitlist.WAITLIST_ALREADY_JOINED,
    WAITLIST_NOT_ON_WAITLIST: d.equipmentWaitlist.WAITLIST_NOT_ON_WAITLIST,
    EQUIPMENT_NOT_FOUND: d.equipmentWaitlist.EQUIPMENT_NOT_FOUND,
  },

  operationalMetrics: {
    title: d.operationalMetrics.title,
    emergencyOverrides: d.operationalMetrics.emergencyOverrides,
    bundleFailures: d.operationalMetrics.bundleFailures,
    staleConditions: d.operationalMetrics.staleConditions,
    procedureBounds: d.operationalMetrics.procedureBounds,
    averageCheckoutTime: d.operationalMetrics.averageCheckoutTime,
    averageDockReturnTime: d.operationalMetrics.averageDockReturnTime,
    deployableSuccessRate: d.operationalMetrics.deployableSuccessRate,
    noData: d.operationalMetrics.noData,
    metricsDisabled: d.operationalMetrics.metricsDisabled,
  },

  phoneSignIn: d.phoneSignIn,

  nav: d.nav,

  board: d.board,

  legalFooter: d.legalFooter,

  legalPage: d.legalPage,

  privacyPage: d.privacyPage,

  termsPage: d.termsPage,

  supportPage: d.supportPage,

  whatsNew: d.whatsNew,

  more: d.more,

  profile: d.profile,

  adminDocks: d.adminDocks,

  adminAssetTypesPage: d.adminAssetTypesPage,

  conditionChecklist: d.conditionChecklist,

  crashCartAdmin: d.crashCartAdmin,

} as const;

return stripInternalKeys(translations) as typeof translations;
}

export let t = buildTranslations(dictionaries[getStoredLocale()]);

export function refreshTranslations(locale: string | null | undefined = getStoredLocale()): void {
  t = buildTranslations(dictionaries[resolveClientLocale(locale)]);
}
