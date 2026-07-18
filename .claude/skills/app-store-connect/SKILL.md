---
name: app-store-connect
description: Use when working with App Store Connect workflows — app submission, metadata, TestFlight, App Review, pricing/release, IAP, and analytics/sales. Triggers on ASC, publish, release, metadata, app management.
---

# App Store Connect

## App Setup

- ASC → My Apps → + (New App)
- Select platforms, enter name/language/bundle ID
- Developer Portal → Identifiers → Register Bundle ID with capabilities

## Version Metadata

Required: Screenshots (all sizes), description (≤4000), keywords (≤100), support URL, version, build, copyright, age rating.

- **Screenshots (tvOS):** 1920x1080, 1-10 per language, PNG/JPEG, app running only.
- **App Preview:** 15-30s, app footage only, H.264 30fps.

## Build Upload

```bash
# Xcode: Product → Archive → Distribute App → App Store Connect

# CLI
xcrun altool --upload-app --type ios --file MyApp.ipa --apiKey KEY --apiIssuer ISSUER
```

## TestFlight

| Type | Testers | Review | Expiry |
|------|---------|--------|--------|
| Internal | 100 | No | N/A |
| External | 10,000 | Beta Review | 90 days |

## App Review

- **Review Info:** Contact, demo account (if login required), notes for special features.
- **Times:** 24-48 hours typical. Reply in Resolution Center if rejected.

## Pricing & Release

- **Tiers:** 0=Free, 1=$0.99, up to Tier 87.
- **Release Options:** Manual, Automatic after approval, Scheduled, Phased (1%→100% over 7 days).
- **IAP Setup:** Features → In-App Purchases → Configure type/price/localization.

## API & Automation

```swift
// JWT for API auth
let payload = ["iss": issuerId, "iat": now, "exp": now+1200, "aud": "appstoreconnect-v1"]
```

```
GET https://api.appstoreconnect.apple.com/v1/apps
GET https://api.appstoreconnect.apple.com/v1/builds
```

```ruby
# Fastlane
lane :release do
  build_app(scheme: "MyApp")
  upload_to_app_store(submit_for_review: true)
end

lane :beta do
  build_app(scheme: "MyApp")
  upload_to_testflight
end
```

## User Roles

| Role | Access |
|------|--------|
| Account Holder | Full + legal |
| Admin | All except legal |
| App Manager | Specific apps |
| Developer | Upload, TestFlight |
| Marketing | Metadata, analytics |

## Common Issues

- **Build stuck:** Wait 1hr, check email, re-upload.
- **Missing compliance:**

  ```xml
  <key>ITSAppUsesNonExemptEncryption</key>
  <false/>
  ```

- **Version conflict:** `agvtool next-version -all`

## Release Workflow

1. Feature freeze (-7 days)
2. QA complete (-5 days)
3. Screenshots/metadata final (-3 days)
4. Internal review (-2 days)
5. Submit (-1 day)
6. Apple review (0-2 days)
7. Release

## Decision Guide

| Situation | Choice |
|-----------|--------|
| Bug fix, urgent | Immediate release |
| Major update | Phased release |
| Marketing campaign | Scheduled release |
| Daily builds | Internal TestFlight |
| Wider feedback | External TestFlight |

## MCP Integration

- **Context7:** `/websites/developer_apple_help_app-store-connect` — ASC workflows (9071 snippets)
- **Serena:** `find_file "Fastfile"` — Find Fastlane config; `search_for_pattern "ITSAppUsesNonExemptEncryption"` — Export compliance
