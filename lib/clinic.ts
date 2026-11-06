import { getServerEnv } from '@/lib/env';
import type { ClinicContext } from '@/lib/outbound/build';

export function clinicFromEnv(): ClinicContext {
  const env = getServerEnv();
  return { clinicName: env.CLINIC_NAME, doctorName: env.DEFAULT_DOCTOR_NAME, clinicPhone: env.CLINIC_PHONE };
}
