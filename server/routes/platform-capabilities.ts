import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/** Audit-first capability surface (defaults unchanged). */
router.get("/capabilities", requireAuth, (_req, res) => {
  res.json({
    clinicalApi: process.env.ENABLE_CLINICAL_API === "true",
    dispenseApi: process.env.ENABLE_DISPENSE_API === "true",
    shiftChatApi: process.env.ENABLE_SHIFT_CHAT_API === "true",
    broadInventory: process.env.ENABLE_BROAD_INVENTORY === "true",
    broadProcurement: process.env.ENABLE_BROAD_PROCUREMENT === "true",
    assetCopilot: process.env.ENABLE_ASSET_COPILOT === "true",
    cursorBugFixer: process.env.ENABLE_CURSOR_BUG_FIXER === "true",
  });
});

export default router;
