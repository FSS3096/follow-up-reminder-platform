/**
 * The ONLY way outbound text is produced (Brief 6.1 L1).
 * TODO(C1): switch this import to '@/lib/messages/templates' when Codex's templates land.
 */
export {
  renderTemplate,
  TEMPLATE_KEYS,
  type Language,
  type TemplateKey,
  type TemplateVars,
} from '@/lib/messages/templates';
