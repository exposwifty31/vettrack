// Worked example — proves the §20-D2 pairing end to end: ConfidenceIndicator
// (our new component) sits ABOVE the real, mock-seeded EquipmentTruthCard,
// never replacing it. ConfidenceIndicator answers "how sure are we about the
// custody/location inference"; EquipmentTruthCard/DeployabilityBadge answer
// "what state is the equipment in".
import * as React from "react";
import {
  MockAppProviders,
  createMockQueryClient,
  seedEquipmentTruth,
} from "./mock-app-providers";
import { EquipmentTruthCard } from "@/components/equipment/EquipmentTruthCard";
import { ConfidenceIndicator } from "../components/confidence-indicator";

export function EquipmentDetailExample() {
  const client = React.useMemo(() => {
    const c = createMockQueryClient();
    seedEquipmentTruth(c, "eq-204", {
      location: { summary: "ICU-2", unknowns: [] },
      custodian: {
        claims: [{ key: "custodian", value: "Dr. Lee" }],
        unknowns: [],
      },
    });
    return c;
  }, []);

  return (
    <MockAppProviders queryClient={client}>
      <div className="max-w-sm space-y-3">
        <ConfidenceIndicator
          confidence="high"
          reasoning="Checked out by Dr. Lee · 12 min ago"
        />
        <EquipmentTruthCard equipmentId="eq-204" equipmentName="Infusion Pump" />
      </div>
    </MockAppProviders>
  );
}
