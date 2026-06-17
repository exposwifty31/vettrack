import { t } from "@/lib/i18n";
import { LegalDocumentShell, LegalSection } from "@/components/legal-document-shell";

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

type PrivacySectionKey = (typeof PRIVACY_SECTION_KEYS)[number];

export default function PrivacyPolicyPage() {
  const sections = t.privacyPage.sections;

  return (
    <LegalDocumentShell
      pageTitle={t.privacyPage.pageTitle}
      metaDescription={t.privacyPage.metaDescription}
      heading={t.privacyPage.title}
      lastUpdated={t.privacyPage.lastUpdatedDate}
      canonicalUrl="https://vettrack.uk/privacy"
      backHref="/signin"
      backLabel={t.legalPage.backToSignIn}
    >
      {PRIVACY_SECTION_KEYS.map((key: PrivacySectionKey) => {
        const section = sections[key];
        return <LegalSection key={key} title={section.title} body={section.body} />;
      })}
    </LegalDocumentShell>
  );
}
