import contract from '../../shared/autoapply-question-policy.json';

export type QuestionPolicyRule = (typeof contract.rules)[number];
const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compiled = contract.rules.map((rule) => ({
  ...rule,
  expressions: rule.patterns.map((pattern) => new RegExp(pattern, 'i')),
}));

export function classifyApplicationQuestion(label: unknown): QuestionPolicyRule | null {
  const normalized = normalize(label);
  return compiled.find((rule) => rule.expressions.some((expression) => expression.test(normalized))) || null;
}

export const AUTOAPPLY_QUESTION_POLICY_VERSION = contract.version;