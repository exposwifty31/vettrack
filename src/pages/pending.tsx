import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Hospitalization } from "@/types";

type PendingHospitalization = Hospitalization & { waitingMinutes?: number };

export default function PendingPage() {
  const [patients, setPatients] = useState<PendingHospitalization[]>([]);

  const load = async () => {
    const data = await api.patients.listPending();
    setPatients(data.patients || []);
  };

  useEffect(() => {
    load();
  }, []);

  const takePatient = async (id: string) => {
    await api.patients.assign(id);

    setPatients((prev) => prev.filter((p) => p.id !== id));
  };

  const color = (m: number) => {
    if (m > 30) return "bg-red-100";
    if (m >= 10) return "bg-yellow-100";
    return "bg-gray-100";
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">מטופלים בהמתנה</h1>

      {patients.map((p) => (
        <div
          key={p.id}
          className={`p-4 mb-2 rounded ${color(p.waitingMinutes ?? 0)}`}
        >
          <div>{p.animal.name}</div>
          <div>{new Date(p.admittedAt).toLocaleTimeString()}</div>
          <div>{p.admissionReason}</div>
          <div>{p.waitingMinutes} דקות</div>

          <button
            onClick={() => takePatient(p.id)}
            className="bg-blue-600 text-white px-2 py-1 mt-2 rounded"
          >
            קח מטופל
          </button>
        </div>
      ))}
    </div>
  );
}
