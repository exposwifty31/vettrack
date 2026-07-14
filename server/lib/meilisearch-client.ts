/**
 * Meilisearch client for patient search, medical history, notes.
 * Free, self-hosted alternative to Elasticsearch.
 */
import { MeiliSearch } from 'meilisearch';

const meiliHost = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
const meiliKey = process.env.MEILISEARCH_API_KEY || 'masterKey';

const client = new MeiliSearch({
  host: meiliHost,
  apiKey: meiliKey,
});

/**
 * Index patients for search (called on patient create/update).
 */
export async function indexPatient(patient: any) {
  try {\n    const index = client.index('patients');\n    await index.addDocuments([
      {
        id: patient.id,
        name: patient.name,\n        clinic_id: patient.clinicId,
        email: patient.email,
        phone: patient.phone,\n        medical_history: patient.medicalHistory?.join(' '),
        notes: patient.notes,
        created_at: patient.createdAt,
      },
    ]);\n    console.log(`[search] indexed patient ${patient.id}`);\n  } catch (err) {\n    console.warn(`[search] index failed: ${(err as Error).message}`);\n  }\n}\n\n/**\n * Search patients by name, email, phone, or medical history.\n */\nexport async function searchPatients(\n  query: string,\n  clinicId: string,\n  limit: number = 10,\n) {\n  try {\n    const index = client.index('patients');\n    const results = await index.search(query, {\n      filter: [`clinic_id = ${clinicId}`],\n      limit,\n    });\n    return results.hits;\n  } catch (err) {\n    console.warn(`[search] search failed: ${(err as Error).message}`);\n    return [];\n  }\n}\n\n/**\n * Index appointments for search.\n */\nexport async function indexAppointment(appointment: any) {\n  try {\n    const index = client.index('appointments');\n    await index.addDocuments([\n      {\n        id: appointment.id,\n        clinic_id: appointment.clinicId,\n        patient_name: appointment.patientName,\n        vet_name: appointment.vetName,\n        status: appointment.status,\n        scheduled_at: appointment.scheduledAt,\n        notes: appointment.notes,\n      },\n    ]);\n    console.log(`[search] indexed appointment ${appointment.id}`);\n  } catch (err) {\n    console.warn(`[search] index failed: ${(err as Error).message}`);\n  }\n}\n\n/**\n * Initialize search indices with settings.\n */\nexport async function initializeSearchIndices() {\n  try {\n    // Create patients index\n    await client.createIndex('patients', { primaryKey: 'id' });\n    const patientsIndex = client.index('patients');\n    await patientsIndex.updateSettings({\n      searchableAttributes: ['name', 'email', 'phone', 'medical_history', 'notes'],\n      filterableAttributes: ['clinic_id', 'created_at'],\n      sortableAttributes: ['created_at'],\n    });\n    console.log('[search] patients index initialized');\n\n    // Create appointments index\n    await client.createIndex('appointments', { primaryKey: 'id' });\n    const appointmentsIndex = client.index('appointments');\n    await appointmentsIndex.updateSettings({\n      searchableAttributes: ['patient_name', 'vet_name', 'notes'],\n      filterableAttributes: ['clinic_id', 'status', 'scheduled_at'],\n    });\n    console.log('[search] appointments index initialized');\n  } catch (err) {\n    if ((err as any).code === 'index_already_exists') {\n      console.log('[search] indices already exist');\n    } else {\n      console.warn(`[search] initialization failed: ${(err as Error).message}`);\n    }\n  }\n}\n\n/**\n * Health check for Meilisearch.\n */\nexport async function checkSearchHealth(): Promise<boolean> {\n  try {\n    const health = await client.isHealthy();\n    return health;\n  } catch (err) {\n    console.warn('[search] health check failed');\n    return false;\n  }\n}\n
