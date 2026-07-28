import { t } from "@/lib/i18n";
import { LegalDocumentShell, LegalSection } from "@/components/legal-document-shell";

const DELETION_SECTION_KEYS = [
  "overview",
  "inApp",
  "byRequest",
  "whatHappens",
  "subscriptions",
] as const;

type DeletionSectionKey = (typeof DELETION_SECTION_KEYS)[number];

export default function AccountDeletionPage() {
  const sections = t.accountDeletionPage.sections;

  return (
    <LegalDocumentShell
      pageTitle={t.accountDeletionPage.pageTitle}
      metaDescription={t.accountDeletionPage.metaDescription}
      heading={t.accountDeletionPage.title}
      lastUpdated={t.accountDeletionPage.lastUpdatedDate}
      canonicalUrl="https://vettrack.uk/account-deletion"
      backHref="/signin"
      backLabel={t.legalPage.backToSignIn}
    >
      {DELETION_SECTION_KEYS.map((key: DeletionSectionKey) => {
        const section = sections[key];
        return <LegalSection key={key} title={section.title} body={section.body} />;
      })}
    </LegalDocumentShell>
  );
}
