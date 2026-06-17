import { t } from "@/lib/i18n";
import { LegalDocumentShell, LegalSection } from "@/components/legal-document-shell";

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

type TermsSectionKey = (typeof TERMS_SECTION_KEYS)[number];

export default function TermsOfUsePage() {
  const sections = t.termsPage.sections;

  return (
    <LegalDocumentShell
      pageTitle={t.termsPage.pageTitle}
      metaDescription={t.termsPage.metaDescription}
      heading={t.termsPage.title}
      lastUpdated={t.termsPage.lastUpdatedDate}
      canonicalUrl="https://vettrack.uk/terms"
      backHref="/signin"
      backLabel={t.legalPage.backToSignIn}
    >
      {TERMS_SECTION_KEYS.map((key: TermsSectionKey) => {
        const section = sections[key];
        return <LegalSection key={key} title={section.title} body={section.body} />;
      })}
    </LegalDocumentShell>
  );
}
