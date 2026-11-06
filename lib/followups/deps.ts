import 'server-only';
import { clinicFromEnv } from '@/lib/clinic';
import * as followups from '@/lib/data/followupsRepo';
import { getPatient } from '@/lib/data/patientsRepo';
import { listRemindersForFollowup } from '@/lib/data/remindersRepo';
import type { UserSupabaseClient } from '@/lib/supabase/server';
import { log } from '@/lib/log';
import { sendConfirmationNow } from '@/lib/reminders/tick';
import { tickDeps } from '@/lib/reminders/tickDeps';
import type { FollowupDeps } from './service';

/** Wires the followup service to Supabase under the caller's session (RLS applies). */
export function followupDeps(db: UserSupabaseClient, extra: Partial<FollowupDeps> = {}): FollowupDeps {
  return {
    now: () => new Date(),
    clinic: clinicFromEnv(),
    getFollowup: (id) => followups.getFollowup(db, id),
    getPatient: (id) => getPatient(db, id),
    approve: (args) => followups.approveFollowup(db, args),
    reschedule: (args) => followups.rescheduleFollowup(db, args),
    setStatus: (id, status) => followups.setFollowupStatus(db, id, status),
    listReminders: (id) => listRemindersForFollowup(db, id),
    list: (filters) => followups.listFollowups(db, filters),
    afterApprove: async (f) => {
      // Best effort; a failure leaves the confirmation pending for the next tick.
      const outcome = await sendConfirmationNow(f.id, tickDeps());
      log.info('approve_inline_send', { followupId: f.id, outcome });
    },
    ...extra,
  };
}
