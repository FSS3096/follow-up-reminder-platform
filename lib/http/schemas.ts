import { z } from 'zod';
import { isValidIsoDate, isValidTime } from '@/lib/time/ist';

export const uuidSchema = z.uuid();
export const idParamsSchema = z.object({ id: uuidSchema });
export const isoDateSchema = z.string().refine(isValidIsoDate, 'must be a real date YYYY-MM-DD');
export const timeSchema = z.string().refine(isValidTime, 'must be HH:mm (24h)');
export const phoneE164Schema = z.string().trim().regex(/^\+[1-9][0-9]{9,14}$/, 'must be E.164, e.g. +919812345678');
export const languageSchema = z.enum(['hinglish', 'english', 'hindi']);
export const patientNameSchema = z.string().trim().min(1).max(80);
