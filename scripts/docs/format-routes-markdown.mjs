const DOMAIN_RULES = [
  { title: "Infrastructure", match: (r) => /^(health|users|realtime|queue|metrics|storage|uploads|push|support|audit-logs|test|stability|platform-capabilities|cursor-bug-fixer)\.ts$/.test(pathBase(r.sourceFile)) },
  { title: "Equipment", match: (r) => /^(equipment|equipment-copilot|equipment-operational-state|equipment-waitlist|rooms|folders|returns|rfid|alert-acks|activity|display|home-dashboard|operational-metrics|whatsapp)\.ts$/.test(pathBase(r.sourceFile)) || r.path.includes("/equipment") },
  { title: "Emergency & safety", match: (r) => /^(code-blue|crash-cart)\.ts$/.test(pathBase(r.sourceFile)) },
  { title: "Scheduling & shifts", match: (r) => /^(shifts|clinical-check-in|shift-chat|appointments|tasks)\.ts$/.test(pathBase(r.sourceFile)) },
  { title: "Inventory & procurement", match: (r) => /^(containers|restock|inventory-items|procurement|dispense)\.ts$/.test(pathBase(r.sourceFile)) },
  { title: "Integrations", match: (r) => /^integrations\.ts$/.test(pathBase(r.sourceFile)) },
  { title: "Admin & analytics", match: (r) => /^(analytics|admin-outbox-health|admin-outbox-dlq|admin-task-ownership)\.ts$/.test(pathBase(r.sourceFile)) },
];

function pathBase(sourceFile) {
  return sourceFile.split("/").pop() ?? sourceFile;
}

export function formatRoutesMarkdown(routes) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const lines = [
    "# VetTrack — API Route Inventory",
    "",
    "Routes derived from `server/app/routes.ts`, `server/index.ts`, and `server/routes/*.ts`.",
    "",
    `Generated ${generatedAt}. **${routes.length}** unique method+path pairs.`,
    "",
    "---",
    "",
  ];
  const assigned = new Set();
  for (const { title, match } of DOMAIN_RULES) {
    const group = routes.filter((r) => match(r));
    if (group.length === 0) continue;
    for (const r of group) assigned.add(r);
    const byFile = new Map();
    for (const r of group) {
      const base = pathBase(r.sourceFile);
      if (!byFile.has(base)) byFile.set(base, []);
      byFile.get(base).push(r);
    }
    lines.push(`## ${title}`, "", "| File | Sample routes |", "|------|---------------|");
    for (const [file, fileRoutes] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const summary = fileRoutes.slice(0, 6).map((r) => `\`${r.method} ${r.path}\``).join(", ");
      const extra = fileRoutes.length > 6 ? ` (+${fileRoutes.length - 6} more)` : "";
      lines.push(`| \`${file}\` | ${summary}${extra} |`);
    }
    lines.push("");
  }
  const unassigned = routes.filter((r) => !assigned.has(r));
  if (unassigned.length > 0) {
    lines.push("## Other", "");
    for (const r of unassigned) lines.push(`- \`${r.method} ${r.path}\` (\`${r.sourceFile}\`)`);
    lines.push("");
  }
  return lines.join("\n");
}
