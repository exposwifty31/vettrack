import { t } from "@/lib/i18n";
import { LegalDocumentShell, LegalSection } from "@/components/legal-document-shell";

const SUPPORT_SECTION_KEYS = [
  "overview",
  "contact",
  "accountAccess",
  "technicalIssues",
  "nativeApp",
  "privacyAndDeletion",
  "emergencyNote",
] as const;

type SupportSectionKey = (typeof SUPPORT_SECTION_KEYS)[number];

export default function SupportPage() {
  const sections = t.supportPage.sections;

  return (
    <LegalDocumentShell
      pageTitle={t.supportPage.pageTitle}
      metaDescription={t.supportPage.metaDescription}
      heading={t.supportPage.title}
      lastUpdated={t.supportPage.lastUpdatedDate}
      canonicalUrl="https://vettrack.uk/support"
      backHref="/signin"
      backLabel={t.legalPage.backToSignIn}
    >
      {SUPPORT_SECTION_KEYS.map((key: SupportSectionKey) => {
        const section = sections[key];
        return <LegalSection key={key} title={section.title} body={section.body} />;
      })}
    </LegalDocumentShell>
  );
}
