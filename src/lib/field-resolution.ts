import { createHash } from 'crypto';

export type ResolutionAttempt = 1 | 2 | 3;
export type ResolutionOption = string | { label: string; value?: string };
export type ResolutionField = {
  name: string; label: string; description?: string; nearbyText?: string; type?: string; required?: boolean;
  options?: ResolutionOption[]; currentValue?: string; attempt?: ResolutionAttempt;
  validation?: { message?: string; accepted?: boolean; optionSetHash?: string };
};
export const optionLabels = (field: ResolutionField) => (field.options || []).map((option) => typeof option === 'string' ? option : option.label).filter(Boolean);
export const optionSetHash = (field: ResolutionField) => createHash('sha256').update(optionLabels(field).map((value) => value.trim().toLowerCase()).join('\n')).digest('hex').slice(0, 16);
export const isSensitiveFact = (label: unknown) => /citizen|citizenship|visa|sponsor|work authori[sz]ation|legally authori[sz]ed|veteran|disab|gender|sex|race|ethni|relig|age|18|criminal|convict|security clearance|export control|government official|background check/.test(String(label || '').toLowerCase());
export const mayUseAi = (field: ResolutionField) => {
  if ((field.attempt || 1) !== 3 || isSensitiveFact(field.label)) return false;
  const q = String(field.label || '').toLowerCase();
  return !field.options?.length || /why|describe|tell us|project|accomplishment|experience|additional information|cover letter|motivat|interest|strength|challenge|learn/.test(q);
};
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



const normalizedQuestion = (value: unknown) => String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.join(' ') || '';
export const findSavedAnswer = (answers: Record<string, string>, label: unknown) => {
  const raw = String(label || '');
  const q = normalizedQuestion(raw);
  if (answers[raw] !== undefined) return answers[raw];
  if (answers[q] !== undefined) return answers[q];
  const matches = Object.entries(answers).map(([key, value]) => ({ key: normalizedQuestion(key), value }))
    .filter(({ key }) => key.length >= 20 && (q.startsWith(key) || key.startsWith(q)))
    .sort((a, b) => b.key.length - a.key.length);
  return matches[0]?.value;
};
