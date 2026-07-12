# Passive Equipment Tracking (BLE / RFID) — Cost/Benefit Analysis

- **Deliverable:** `R-M1-PRE` — prerequisite for **massive-01 (passive location & custody)** in the consolidated plan (`docs/superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md`).
- **Audience:** hospital manager (business-case, not a technical design).
- **Date:** 2026-07-12
- **Status:** Draft with **industry-benchmark numbers** + a **parameterized model**. The dollar figures below are *illustrative ranges* — the final case needs **both** the clinic's eight §6 inputs **and** the §3/§8 cost-side assumptions (reader/gateway/tag pricing, installation, middleware, maintenance, SaaS) confirmed; §6 alone does not produce it.

> **Read this first.** Nearly all published benefit data is from **human hospitals / nursing**, used here as a directional proxy for a veterinary clinic. Magnitudes must be scaled down for a single clinic; the *levers* (search-time, loss, over-purchasing) transfer, the *dollar amounts* must be validated locally. Vendor pricing is 2025–2026 and US-centric; RTLS vendors quote per-facility, so treat every table as a **planning range, not a quote**.

---

## 1. Executive summary

Passive tracking makes **"where did it last pass / did it leave" (RFID-gate) — or live room-level "where is it now" (BLE/RTLS)** — location + egress evidence, **not "who has X"** (custody/custodian stays a separate, human-confirmed concern; a gate read identifies a *reader/room*, never a person) — **correct without anyone scanning** — the data-quality foundation every other VetTrack feature (readiness, analytics, loss attribution, Code Blue cart location) depends on. The question for the hospital is not *whether* it helps but *whether the payback justifies the hardware spend*.

**The single decision that drives cost:** do we need **live room-level location** (BLE/RTLS) or just **"did it leave / which door did it last pass" (RFID-gate)**?

| | RFID-gate (chokepoint) | BLE / RTLS (live location) |
|---|---|---|
| Answers | "last seen passing door X"; egress/theft | "where is it right now," room-level |
| Per-asset tag | **$0.10–$5** (passive) | **$10–$40** (active beacon) |
| Infrastructure | **3–5 readers** at doors/docks | **8–15 gateways** (≈1/room) |
| Recurring | middleware + maintenance | **+ per-device SaaS ($2–10/device/mo)** |
| One-time (250-asset scenario) | **~$13k–37k** | **~$8k–23k** |
| Multi-year TCO at 250 assets | **lower** | higher (SaaS scales with fleet) |

**Recommendation (this analysis):** start with an **RFID-gate pilot in one clinic**. At a clinic's asset count (hundreds, not thousands), gate-based egress/last-seen tracking captures the biggest wins — theft/loss reduction and "did it leave the building" — at a **materially lower *multi-year* total cost of ownership** — its one-time cost is *higher* than BLE/RTLS ($13k–37k vs $8k–23k), but its near-zero recurring (no per-device SaaS) wins over a 3–5-year horizon, because passive tags are near-free and the cost sits in a handful of readers rather than a per-device monthly SaaS bill. Add BLE/RTLS later *only* for the specific high-value assets that genuinely need live room-level location. This matches the plan's staged doctrine: **prove the value in one clinic before spending fleet-wide capital.**

---

## 2. The choice that reshapes the whole cost curve

- **RFID-gate:** tag every asset with a cheap passive tag; put a reader at each door/dock. You learn **when an asset crosses a chokepoint** — enough for theft alerts, "it left the building," and coarse zone attribution. Tag cost is negligible; cost = a few readers + install.
- **BLE / RTLS:** tag every asset with an active beacon; blanket the building with gateways. You learn **continuous room-level position**. Tag cost + a per-device monthly SaaS scale directly with how many assets you track.

> **Why it matters financially:** 250 BLE tags on SaaS at $2–10/device/month = **$6,000–$30,000 per year**, which can exceed the *entire* RFID-gate hardware bill within the first year. Only pay for live location where the workflow truly needs it.

---

## 3. Costs — representative small-clinic scenario

**Assumed scenario (swap for real values in §6):** **250 tracked assets · 15 rooms/zones · 4 doors + 1 dock = 5 chokepoints.**

### One-time (capital)

| Line item | RFID-gate | BLE / RTLS |
|---|---|---|
| Tags (250) | $500–$1,250 (equipment-grade on-metal passive **$2–5** — the §1 table's $0.10 floor is generic label stock, unusable on metal medical equipment, so the scenario excludes it) | $2,500–$10,000 (beacon $10–40) |
| Readers / gateways | 5 readers × $1k–4k = **$5k–20k** | 10–15 gateways × $50–200 = **$0.5k–3k** |
| Antennas | 10 × $100–250 = $1k–2.5k | (integrated) |
| Handheld locator (optional) | $1.5k–3k | — |
| Install / professional services | $5k–10k | $5k–10k |
| **One-time subtotal** | **~$13k–37k** | **~$8k–23k** |

### Annual (operating)

| Line item | RFID-gate | BLE / RTLS |
|---|---|---|
| Software / SaaS | middleware **$1k–5k/yr** (basic) | **$6k–30k/yr** (250 × $2–10/device/mo) |
| Maintenance (15–25% of **installed project cost**) | **~$2k–9k/yr** | ~$1k–5k/yr |
| Battery / tag replacement | negligible (passive) | ~$750 every 3–5 yr (**excluded from the annual subtotal below — amortized in multi-year TCO/payback at ≈$150–250/yr**) |
| **Annual subtotal** | **~$3k–14k/yr** | **~$7k–35k/yr** |

**Cost levers that move these most:** (1) **# of chokepoints vs rooms** (readers are the big line — fewer doors = far cheaper RFID); (2) **existing WiFi/PoE** — BLE-capable access points can slash gateway install; (3) **live-location requirement** — the single biggest swing.

---

## 4. Benefits — the levers (benchmarked, then dollarized)

| # | Lever | Benchmark (cited proxy) | How to dollarize |
|---|---|---|---|
| 1 | **Staff search time recovered** | Staff spend **21–40 min/shift** hunting equipment (GE HealthCare: 21 min; 2024 study: ~40 min); RTLS cuts search time **30–50%** | minutes saved × shifts/yr × loaded hourly wage |
| 2 | **Equipment loss avoided** | Hospitals lose **10–20% of mobile equipment/yr**, ~**$3,000/item** replacement | items no longer lost × replacement cost |
| 3 | **Avoided over-purchasing** | Utilization rises **~40% → 75%** with RTLS → buy **10–20% fewer** units | deferred/avoided capital purchases |
| 4 | **Rental reduction** | Up to **80%** rental cut in documented deployments (one hospital: $32,594 in yr 1) | current rental spend × reduction |
| 5 | **Soft** | +50% staff satisfaction; faster Code-Blue equipment retrieval (safety) | not dollarized; real for retention/care |

> **Sourcing:** each figure above is an *indicative proxy* from the studies/vendors named inline and consolidated in **§8 Sources** (US hospital/nursing data, scaled directionally to a vet clinic) — planning ranges, not per-figure quotes. Validate against the clinic's own logs (§6) before presenting any figure as firm.

### Illustrative benefit calc (conservative — replace with real inputs)

> Assumes **10 clinical staff**, 1 shift/day each, **25 min/shift** searching, **40%** reduction, **$25/hr** loaded wage; plus **3 lost items/yr** avoided at **$2,000** each.

- Search time: 10 staff × 10 min saved/day × 365 = **~608 hr/yr** × $25 = **~$15,200/yr**
- Loss avoided: 3 × $2,000 = **$6,000/yr**
- **Illustrative annual benefit ≈ $21,000/yr** (before over-purchasing/rental levers, which are clinic-specific).

---

## 5. Illustrative payback (clearly illustrative)

Using the RFID-gate scenario (lower TCO) at a **mid-range one-time ~$20k** and **~$6k/yr** operating, against the **~$21k/yr** illustrative benefit above:

- **Year 1 net:** ~$21k − ~$6k − ~$20k = **−$5k**; the remaining $5k is recovered ~4 months into year 2 → **payback ≈ 16 months** ($20k initial ÷ $15k/yr net)
- **Year 2+ net:** ~$21k − ~$6k = **~$15k/yr** positive

> This is a *worked illustration to show the shape of the ROI*, not a promise. The real payback hinges entirely on the §6 inputs — especially your true loss-incident rate and staff count. If the clinic's actual loss/search numbers are lower than these proxies, payback lengthens; if it rents specialty equipment or loses higher-value assets, payback shortens.

---

## 6. The eight inputs the clinic must supply (turns this into a real case)

| # | Input | Drives |
|---|---|---|
| 1 | **# tracked assets** (pumps, monitors, ultrasound, warmers, …) | tag count, SaaS |
| 2 | **# rooms/zones and # door/dock chokepoints** | gateway vs reader count — **biggest cost swing** |
| 3 | **# clinical staff + shifts/day** | search-time multiplier |
| 4 | **Avg loaded hourly wage** (vet tech / vet) | dollarizes recovered time |
| 5 | **Known lost/replaced-equipment incidents per year + $/item** | loss-avoidance lever (use real logs, not the 10–20% proxy) |
| 6 | **Current equipment rental spend** (if any) | rental-reduction lever |
| 7 | **Existing WiFi/PoE coverage** | can slash BLE gateway install cost |
| 8 | **Requirement: real-time location vs egress/last-seen** | **picks BLE vs RFID-gate** — the whole cost curve |

---

## 7. Recommendation & rollout

1. **Decide input #8 first** — for most clinics, egress/last-seen (RFID-gate) covers the theft/loss + "did it leave" wins at the lowest TCO.
2. **Pilot one clinic** (matches the plan's staged doctrine): instrument the 3–5 chokepoints, tag the high-value mobile fleet, measure search-time and loss for a quarter against baseline.
3. **Success metric:** % of "where is it" queries answered without a manual scan, plus measured loss-incident and search-time deltas vs the pre-pilot baseline.
4. **Only then** extend BLE/RTLS to the specific assets that need live room-level location, and roll out fleet-wide.
5. **Non-negotiable technical constraint** (from the plan): passive signals are **additive** — the manual scan path stays byte-for-byte unaffected for non-instrumented clinics, and partial coverage degrades gracefully to last-known. No "unknown" regressions.

---

## 8. Caveats & sources

**Caveats:** benefit data is US hospital/nursing, directional for veterinary; scale magnitudes down for one clinic. Loss/search studies span 2009–2024 (the 2009 "hour a shift" figure is corroborated by 2024's ~40 min and GE's 21 min). Vendor pricing is 2025–2026, US-centric, and per-facility — planning ranges, not quotes.

**Sources (indicative):** Nextwaves (2025), GPX (2026), Airpinpoint BLE & hospital guides (2026), CPCON RFID cost guide (2026), RMS Omega, KoronaPOS, RipplesIoT, Reelables (2025), AAFP, 24x7 Magazine (2024), GE HealthCare, AiRISTA Flow, Cognosos, CenTrak, Link Labs, TRIMEDX, Nursing Times/PubMed (2009), medRxiv ED-RTLS study (2023).

> **Next step:** owner supplies the §6 inputs **and confirms the §3/§8 cost-side assumptions (reader/gateway/tag pricing, installation, middleware, maintenance, SaaS — these materially drive the totals and payback, and are NOT among the §6 eight inputs)** → this becomes the final numbers to bring to the hospital manager → on a go, massive-01 gets its technical spec-plan pass.
