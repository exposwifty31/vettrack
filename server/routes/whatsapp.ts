import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, whatsappAlerts, equipment } from "../db.js";
import { and, eq, isNull } from "drizzle-orm";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { format } from "date-fns";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate, type TranslationParams } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE, type Locale } from "../../lib/i18n/types.js";
import { isInternalKey } from "../../lib/i18n/internal-keys.js";

/**
 * Phase 6 PR 6.12 — file-local WhatsApp translation helper.
 *
 * Replaces the legacy `translateStatusToHebrew` map. Applies the shared
 * `isInternalKey` guard before resolving (Phase 6 §5 invariant 13 point
 * (d), §6) — internal keys throw in dev/test and fall back to
 * `errors.generic` (rendered locale-aware) in production with a
 * stderr log.
 *
 * Currently used with `INITIAL_LOCALE` because outbound WhatsApp messages
 * are template-rendered at send time, not at recipient-side rendering. A
 * future PR can thread the recipient's `preferred_locale` through.
 */
function tWhatsApp(locale: Locale, key: string, params?: TranslationParams): string {
  if (isInternalKey(key)) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`tWhatsApp: internal key "${key}" is not user-facing.`);
    }
    console.error(`[i18n] internal-key misuse: ${key}`);
    const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
    return translate(primary, "errors.generic", undefined, { fallbackDict: fallback, locale: lc });
  }
  const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
  return translate(primary, key, params, { fallbackDict: fallback, locale: lc });
}

/**
 * Normalize to E.164 with leading '+' (for auth contexts).
 * NOTE (Clerk Dashboard): Israel (+972) SMS must be enabled in Clerk Dashboard →
 * Configure → User & Authentication → Phone numbers → SMS sending → Allowed countries.
 */
function normalizePhoneE164(phone: string): string {
  const trimmed = phone.trim();
  const stripped = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return "+" + stripped;
  }
  if (stripped.startsWith("972")) {
    return "+" + stripped;
  }
  if (stripped.startsWith("05") && stripped.length >= 9 && stripped.length <= 10) {
    return "+972" + stripped.slice(1);
  }
  return "+" + stripped;
}

function normalizePhoneNumber(phone: string): string {
  return normalizePhoneE164(phone).replace(/^\+/, "");
}

/*
 * PERMISSIONS MATRIX — /api/whatsapp
 * ─────────────────────────────────────────────────────
 * POST /alert   technician+   Generate a WhatsApp alert deep-link for equipment
 * ─────────────────────────────────────────────────────
 */

const router = Router();

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

const VALID_STATUSES = ["ok", "issue", "maintenance", "sterilized", "overdue", "inactive"] as const;

const RTL = "\u202B";

// Phase 6 PR 6.12: `translateStatusToHebrew` removed — status labels
// now come from the locale dict via `tWhatsApp(locale, "whatsapp.status.<status>")`.

const whatsappAlertSchema = z.object({
  equipmentId: z.string().min(1, "equipmentId is required"),
  status: z.enum(VALID_STATUSES, {
    required_error: "status is required",
    invalid_type_error: "Invalid status",
  }),
  note: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
});

router.post("/alert", requireAuth, requireEffectiveRole("technician"), validateBody(whatsappAlertSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { equipmentId, status, note, phone } = req.body as z.infer<typeof whatsappAlertSchema>;

    const [item] = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
      .limit(1);

    if (!item) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }

    const equipmentName = item.name;
    const timestamp = format(new Date(), "dd/MM/yyyy HH:mm");

    // Phase 6 PR 6.12: WhatsApp body sourced from locale dict via
    // `tWhatsApp(locale, key, params?)`. Currently rendered in
    // INITIAL_LOCALE because outbound WhatsApp messages are built at
    // send time (no per-recipient locale lookup yet — deferred).
    const locale = INITIAL_LOCALE;
    const statusLabel = tWhatsApp(locale, `whatsapp.status.${status}`);
    const lines: string[] = [
      `${RTL}${tWhatsApp(locale, "whatsapp.alertHeader")}`,
      "",
      tWhatsApp(locale, "whatsapp.equipmentLine", { equipmentName }),
      tWhatsApp(locale, "whatsapp.statusLine", { status: statusLabel }),
      tWhatsApp(locale, "whatsapp.timeLine", { timestamp }),
    ];
    if (note) lines.push(tWhatsApp(locale, "whatsapp.noteLine", { note }));
    lines.push("", tWhatsApp(locale, "whatsapp.footer"));
    let message = lines.join("\n");

    const encoded = encodeURIComponent(message);
    const waUrl = phone
      ? `https://wa.me/${normalizePhoneNumber(phone)}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    await db.insert(whatsappAlerts).values({
      id: randomUUID(),
      clinicId,
      equipmentId,
      equipmentName,
      status,
      note: note || null,
      phoneNumber: phone || null,
      message,
      waUrl,
    });

    res.json({ success: true, waUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "WHATSAPP_ALERT_CREATE_FAILED",
        message: "Failed to create WhatsApp alert",
        requestId,
      }),
    );
  }
});

export default router;
