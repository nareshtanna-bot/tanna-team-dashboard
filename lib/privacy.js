/**
 * Privacy gate for status files and filed outputs.
 * A hit fails the check. Matches are not returned, so a secret is not echoed.
 */

const HEALTH = /\b(diagnos(?:is|es)|prescriptions?|medications?|creatine|vitamins?|cholesterol|a1c|hba1c|glucose|sauna|hipaa|symptoms?|dosage|blood pressure|wegovy|ozempic|statins?|insulin|biopsy|tumou?rs?)\b/i;

const SECRET_TOKEN = /\b(ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk_live_[A-Za-z0-9]+|sk_test_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16})\b/;

const SECRET_ASSIGN = /\b(api[_-]?key|password|passwd|secret|token)\b\s*[:=]\s*['"]?\S{6,}/i;

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

const ADDRESS = /\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Court|Ct|Lane|Ln|Boulevard|Blvd|Way|Place|Pl|Circle|Cir)\b\.?/;

const PLAT = /\bBM\d{3,}-\d+\b/i;

const PARCEL = /\b(?:PIN|REID)\b\s*[:#]?\s*\d+/i;

export const RULES = [
  {
    id: 'dollar_amount',
    test(line) {
      if (/\$\s?\d/.test(line)) return true;
      if (/¢/.test(line)) return true;
      if (/\bUSD\b/.test(line)) return true;
      if (/\bdollars?\b/i.test(line)) return true;
      return false;
    }
  },
  { id: 'health_term', test: (line) => HEALTH.test(line) },
  {
    id: 'secret',
    test(line) {
      const withoutUrls = line.replace(/https?:\/\/\S+/g, ' ');
      if (SECRET_TOKEN.test(line)) return true;
      if (SECRET_ASSIGN.test(line)) return true;
      if (PRIVATE_KEY.test(line)) return true;
      if (SSN.test(withoutUrls)) return true;
      if (/\b\d{9,}\b/.test(withoutUrls)) return true;
      if (/\b(?:account|confirmation)\s*(?:number|#|no\.?)?\s*[:=#]?\s*[A-Z0-9-]*\d[A-Z0-9-]*/i.test(withoutUrls)) return true;
      return false;
    }
  },
  { id: 'street_address', test: (line) => ADDRESS.test(line) },
  { id: 'parcel_or_plat', test: (line) => PLAT.test(line) || PARCEL.test(line) }
];

export function scanText(text) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.test(line)) hits.push({ rule: rule.id, line: index + 1 });
    }
  });
  return hits;
}

export function assertClean(text, label = 'text') {
  const hits = scanText(text);
  if (!hits.length) return;
  const summary = hits.map((hit) => `${label}:${hit.line} ${hit.rule}`).join('; ');
  const error = new Error(`privacy: ${summary}`);
  error.code = 'privacy';
  error.hits = hits;
  throw error;
}
