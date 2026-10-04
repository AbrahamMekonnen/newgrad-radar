import { createHash } from 'crypto';

export type ResolutionAttempt = 1 | 2 | 3;
export type ResolutionOption = string | { label: string; value?: string };
export type ResolutionField = {
  name: string; fieldId?: string; label: string; description?: string; nearbyText?: string; section?: string; type?: string; required?: boolean;
  options?: ResolutionOption[]; currentValue?: string; attempt?: ResolutionAttempt;
  optionSignature?: string;
  validation?: { message?: string; accepted?: boolean; optionSetHash?: string; optionSignature?: string };
};

export function normalizeValueForControl(field: ResolutionField, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || String(field.type || '').toLowerCase() !== 'number') return raw;
  const question = `${field.section || ''} ${field.label || ''}`.toLowerCase();
  if (/\byear\b|graduat/.test(question)) {
    return raw.match(/\b(?:19|20)\d{2}\b/)?.[0] || raw;
  }
  const numeric = raw.replace(/[$,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  return numeric?.[0] || raw;
}

export const optionLabels = (field: ResolutionField) => (field.options || [])
  .map((option) => typeof option === 'string' ? option : option.label)
  .filter(Boolean);

export const normalizedOptionSignature = (field: ResolutionField) => optionLabels(field)
  .map((value) => value.toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '')
  .filter(Boolean)
  .join('|');

export const optionSetHash = (field: ResolutionField) => createHash('sha256')
  .update(optionLabels(field).map((value) => value.trim().toLowerCase()).join('\n'))
  .digest('hex').slice(0, 16);

export const isSensitiveFact = (label: unknown) => /citizen|citizenship|visa|sponsor|work authori[sz]ation|legally authori[sz]ed|veteran|disab|gender|sex|race|ethni|relig|age|18|criminal|convict|security clearance|security code|verification code|one.time code|\botp\b|export control|government official|background check/.test(String(label || '').toLowerCase());

// Non-sensitive fields may all be AI-answered from context (open-ended,
// short-answer, OR multiple-choice). Sensitive fields are handled separately by
// the caller (routed to AI but flagged for review). The drafter still abstains
// when the candidate's data doesn't actually answer the question.
export const mayUseAi = (field: ResolutionField) => !isSensitiveFact(field.label);

export const exactSuppliedOption = (field: ResolutionField, value: unknown) => {
  const wanted = String(value || '').trim().toLowerCase();
  if (!wanted) return null;
  const option = (field.options || []).find((item) => {
    const label = typeof item === 'string' ? item : item.label;
    const raw = typeof item === 'string' ? item : item.value;
    return label.trim().toLowerCase() === wanted || String(raw || '').trim().toLowerCase() === wanted;
  });
  return option ? (typeof option === 'string' ? option : option.label) : null;
};

export const normalizedQuestion = (value: unknown) => String(value || '')
  .toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';

export const scopedAnswerKey = (label: unknown, field?: ResolutionField) => {
  const question = normalizedQuestion(label);
  const signature = field ? normalizedOptionSignature(field) : '';
  return signature
    ? `__field:${question}:${createHash('sha256').update(signature).digest('hex').slice(0, 16)}`
    : `__field:${question}`;
};

export const findSavedAnswer = (answers: Record<string, string>, label: unknown, field?: ResolutionField) => {
  const raw = String(label || '');
  const q = normalizedQuestion(raw);
  const scoped = scopedAnswerKey(label, field);
  if (answers[scoped] !== undefined) return answers[scoped];
  if (answers[raw] !== undefined) return answers[raw];
  if (answers[q] !== undefined) return answers[q];
  const matches = Object.entries(answers).map(([key, value]) => ({ key: normalizedQuestion(key), value }))
    .filter(({ key }) => !key.startsWith('field ') && key.length >= 20 && (q.startsWith(key) || key.startsWith(q)))
    .sort((a, b) => b.key.length - a.key.length);
  return matches[0]?.value;
};

export type ResolutionAnswer = {
  name: string; fieldId?: string; value: string; matchedOption?: string;
  optionSignature?: string; safeToApply?: boolean;
};

/** Reject a resolver response that belongs to another control or an older option set. */
export const validateResolutionAnswer = (field: ResolutionField, answer: ResolutionAnswer) => {
  if (answer.safeToApply === false) return false;
  if (field.fieldId && answer.fieldId !== field.fieldId) return false;
  if (!field.fieldId && answer.name !== field.name) return false;
  const signature = normalizedOptionSignature(field);
  if (signature && answer.optionSignature !== signature) return false;
  if (field.options?.length && !exactSuppliedOption(field, answer.matchedOption || answer.value)) return false;
  return Boolean(String(answer.value || '').trim());
};
