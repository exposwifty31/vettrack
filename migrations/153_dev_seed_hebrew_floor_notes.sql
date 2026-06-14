-- Update demo equipment floor note to Hebrew (dev-clinic-default only)
UPDATE vt_equipment
SET usually_found_here = 'מחלקה א׳ — ארון הציוד'
WHERE clinic_id = 'dev-clinic-default'
  AND id = 'eq1'
  AND (usually_found_here IS NULL OR usually_found_here NOT LIKE '%א%');
