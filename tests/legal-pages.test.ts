import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import he from "../locales/he.json";

const PRIVACY_SECTION_KEYS = [
  "overview",
  "controller",
  "collect",
  "use",
  "processors",
  "retention",
  "security",
  "rights",
  "deletion",
  "children",
  "changes",
  "contact",
] as const;

const TERMS_SECTION_KEYS = [
  "overview",
  "acceptance",
  "eligibility",
  "account",
  "acceptableUse",
  "clinicalDisclaimer",
  "intellectualProperty",
  "availability",
  "liability",
  "termination",
  "governingLaw",
  "changes",
  "contact",
] as const;

const SUPPORT_SECTION_KEYS = [
  "overview",
  "contact",
  "accountAccess",
  "technicalIssues",
  "nativeApp",
  "privacyAndDeletion",
  "emergencyNote",
] as const;

function expectSectionParity(
  namespace: "privacyPage" | "termsPage" | "supportPage",
  keys: readonly string[],
) {
  for (const key of keys) {
    expect(en[namespace].sections[key as keyof typeof en.privacyPage.sections]?.title).toBeTruthy();
    expect(en[namespace].sections[key as keyof typeof en.privacyPage.sections]?.body).toBeTruthy();
    expect(he[namespace].sections[key as keyof typeof he.privacyPage.sections]?.title).toBeTruthy();
    expect(he[namespace].sections[key as keyof typeof he.privacyPage.sections]?.body).toBeTruthy();
  }
}

describe("legal pages locales", () => {
  it("has paired privacyPage keys in en and he", () => {
    expect(en.privacyPage.title).toBeTruthy();
    expect(he.privacyPage.title).toBeTruthy();
    expectSectionParity("privacyPage", PRIVACY_SECTION_KEYS);
  });

  it("has paired termsPage keys in en and he", () => {
    expect(en.termsPage.title).toBeTruthy();
    expect(he.termsPage.title).toBeTruthy();
    expectSectionParity("termsPage", TERMS_SECTION_KEYS);
  });

  it("has paired supportPage keys in en and he", () => {
    expect(en.supportPage.title).toBeTruthy();
    expect(he.supportPage.title).toBeTruthy();
    expectSectionParity("supportPage", SUPPORT_SECTION_KEYS);
  });

  it("has legal footer, legalPage, and settings legal keys", () => {
    expect(en.legalFooter.privacyPolicy).toBeTruthy();
    expect(en.legalFooter.termsOfUse).toBeTruthy();
    expect(en.legalFooter.support).toBeTruthy();
    expect(he.legalFooter.privacyPolicy).toBeTruthy();
    expect(he.legalFooter.termsOfUse).toBeTruthy();
    expect(he.legalFooter.support).toBeTruthy();
    expect(en.legalPage.backLink).toBeTruthy();
    expect(he.legalPage.lastUpdatedLabel).toBeTruthy();
    expect(en.settingsPage.legal).toBeTruthy();
    expect(he.settingsPage.legal).toBeTruthy();
    expect(en.settingsPage.privacyPolicy).toBeTruthy();
    expect(en.settingsPage.termsOfUse).toBeTruthy();
    expect(en.settingsPage.support).toBeTruthy();
  });
});
