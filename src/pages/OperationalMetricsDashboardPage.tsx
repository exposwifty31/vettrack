import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { OperationalMetricsDashboard } from "@/components/equipment/OperationalMetricsDashboard";
import { t } from "@/lib/i18n";

export default function OperationalMetricsDashboardPage() {
  const { role } = useAuth();
  if (role !== "admin") return null;

  return (
    <Layout title={t.operationalMetrics.title}>
      <Helmet>
        <title>{t.operationalMetrics.title}</title>
      </Helmet>
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-xl font-bold mb-4">{t.operationalMetrics.title}</h1>
        <OperationalMetricsDashboard />
      </div>
    </Layout>
  );
}
