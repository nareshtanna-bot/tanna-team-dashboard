/**
 * Privacy gate for status files and filed outputs.
 * A hit fails the check. Matches are not returned, so a secret is not echoed.
 */

const HEALTH = /\b(diagnos(?:is|es)|prescriptions?|medications?|creatine|vitamins?|cholesterol|a1c|hba1c|glucose|hipaa|symptoms?|dosage|blood pressure|wegovy|ozempic|mounjaro|semaglutide|statins?|insulin|metformin|lisinopril|atorvastatin|levothyroxine|adderall|xanax|zoloft|lexapro|lipitor|eliquis|biopsy|tumou?rs?|ldl|hdl|tsh|cbc|psa|creatinine|hemoglobin|triglycerides)\b/i;

const DOSE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|iu)\b/i;

const LAB_VALUE = /\b(?:a1c|hba1c|ldl|hdl|tsh|glucose|cholesterol|psa|creatinine)\b[^.\n]{0,24}\d|\b\d+(?:\.\d+)?\s?(?:mg\/dl|mmol)\b/i;

const BANNED_HEALTH_KEYS = new Set([
  'diagnosis', 'diagnoses', 'medication', 'medications', 'drug', 'drugs', 'dose', 'dosage',
  'lab', 'labs', 'labvalue', 'result', 'results', 'notes', 'provider', 'mrn', 'rx', 'ndc',
  'symptom', 'symptoms'
]);

export const PERSONAL_LISTS = [
  ['health', 'weight'],
  ['health', 'appointments'],
  ['health', 'habits'],
  ['calendar', 'events'],
  ['kids', 'applications'],
  ['kids', 'activities'],
  ['home', 'issues'],
  ['home', 'deliveries'],
  ['home', 'renewals'],
  ['business', 'pipeline']
];

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
  { id: 'health_term', test: (line) => HEALTH.test(line) || DOSE.test(line) || LAB_VALUE.test(line) },
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

function walkBannedKeys(value, hits, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkBannedKeys(item, hits, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_HEALTH_KEYS.has(key.toLowerCase())) hits.push({ rule: 'clinical_detail', line: 1, path: `${path}.${key}` });
    walkBannedKeys(child, hits, `${path}.${key}`);
  }
}

export function clinicalHits(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const hits = scanText(text).filter((hit) => hit.rule === 'health_term').map((hit) => ({ ...hit, rule: 'clinical_detail' }));
  if (value && typeof value === 'object') walkBannedKeys(value, hits, 'health');
  return hits;
}

export function assertClinical(value, label = 'health') {
  const hits = clinicalHits(value);
  if (!hits.length) return;
  const summary = hits.map((hit) => `${label}:${hit.line} ${hit.rule}`).join('; ');
  const error = new Error(`privacy: ${summary}`);
  error.code = 'privacy';
  error.hits = hits;
  throw error;
}

export function personalSeedHits(value) {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== 'object') return [];
  if (typeof data.section === 'string' && !data.health && !data.calendar && !data.kids && !data.home && !data.business) {
    return personalSeedHits({ [data.section]: data });
  }
  const hits = [];
  for (const [section, listName] of PERSONAL_LISTS) {
    const sectionBody = data[section];
    if (!sectionBody) continue;
    if (sectionBody.example !== true) hits.push({ rule: 'unlabeled_personal', line: 1, path: section });
    const list = sectionBody[listName];
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (!item || item.example !== true) {
        hits.push({ rule: 'unlabeled_personal', line: 1, path: `${section}.${listName}[${index}]` });
      }
    });
    walkBannedKeys(sectionBody, hits, section);
  }
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
