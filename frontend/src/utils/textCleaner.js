/**
 * Utility functions for cleaning concept names, definitions, excerpts, and topic headings.
 */

const COMMON_ACRONYMS = new Set([
  'AI', 'ML', 'NLP', 'OCR', 'API', 'SQL', 'DB', 'REST', 'HTTP', 'HTTPS',
  'CPU', 'GPU', 'RAM', 'ROM', 'HTML', 'CSS', 'JS', 'TS', 'UI', 'UX',
  'OS', 'URL', 'JSON', 'XML', 'PDF', 'PWA', 'SVM', 'CNN', 'RNN', 'LLM',
  'BERT', 'GPT', 'GAN', 'AWS', 'GCP', 'IOT', 'TCP', 'IP', 'DNS', 'TOC', 'USA'
]);

const MINOR_WORDS = new Set(['of', 'and', 'in', 'to', 'for', 'on', 'a', 'an', 'the', 'by', 'with', 'at']);

/**
 * Removes table-of-contents leader dots (e.g. "Statement ........ 5"),
 * repeated underscores, dashes, and redundant whitespace.
 */
export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/(?:\.\s*){2,}/g, ' ')   // removes repeated dots or dot leaders
    .replace(/(?:_\s*){2,}/g, ' ')   // removes repeated underscores
    .replace(/(?:-\s*){3,}/g, ' ')   // removes repeated hyphens
    .replace(/([a-z])([A-Z])/g, '$1 $2') // split glued camelCase words from OCR
    .replace(/([:;,])([A-Za-z0-9])/g, '$1 $2') // ensure space after punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes concept display names to consistent Title Case style,
 * keeping recognized acronyms uppercase (e.g. "algorithms" -> "Algorithms", "api" -> "API").
 */
export function normalizeConceptDisplayName(name) {
  if (!name) return '';
  const cleaned = cleanText(name).replace(/\s+\d+$/, ''); // remove trailing page numbers
  if (!cleaned) return '';

  const words = cleaned.split(/(\s+)/);
  const normalized = words.map((w) => {
    if (!w || /^\s+$/.test(w)) return w;
    const cleanWord = w.replace(/[^A-Za-z0-9]/g, '');
    const upperClean = cleanWord.toUpperCase();

    if (COMMON_ACRONYMS.has(upperClean)) {
      return w.replace(/[A-Za-z0-9]+/, upperClean);
    }
    // Keep 2-4 letter uppercase words if they look like acronyms (e.g. DNA)
    if (cleanWord.length >= 2 && cleanWord.length <= 4 && /^[A-Z]+$/.test(cleanWord)) {
      return w;
    }
    // Capitalize first letter
    return w.charAt(0).toUpperCase() + w.slice(1);
  });

  return normalized.join('').trim();
}

/**
 * Backwards compatible alias for cleanConceptName
 */
export function cleanConceptName(name) {
  return normalizeConceptDisplayName(name);
}

/**
 * Cleans OCR topic/heading text:
 * 1. Joins sequences of single letters separated by spaces into words ("D A T A L O G I C" -> "DATALOGIC")
 * 2. Strips "(cont'd)", "(contd)", and "continued"
 * 3. Collapses repeated spaces
 * 4. Converts ALL CAPS to Title Case (keeping acronyms uppercase)
 * 5. Caps topic labels at 32 characters
 */
export function cleanTopicHeading(text, maxLength = 32) {
  if (!text) return 'General';
  
  // 1. Join sequences of single letters separated by spaces into words
  let cleaned = text.replace(/\b([A-Za-z](?:\s+[A-Za-z])+)\b/g, (match) => match.replace(/\s+/g, ''));

  // 2. Strip (cont'd), (contd), and continued
  cleaned = cleaned.replace(/\s*[\(\[\{]?(?:cont'?d|continued)[\)\]\}]?/gi, '');

  // 3. Collapse repeated spaces and trim punctuation
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[\s\-:,.;]+|[\s\-:,.;]+$/g, '');

  if (!cleaned || ['none', 'null', 'general'].includes(cleaned.toLowerCase())) {
    return 'General';
  }

  // 4. Convert ALL CAPS to Title Case, keeping acronyms uppercase
  const words = cleaned.split(' ');
  const titleWords = words.map((w, idx) => {
    const cleanW = w.replace(/[^A-Za-z0-9]/g, '');
    const upper = cleanW.toUpperCase();
    if (COMMON_ACRONYMS.has(upper)) {
      return upper;
    }
    if (idx > 0 && MINOR_WORDS.has(cleanW.toLowerCase())) {
      return w.toLowerCase();
    }
    if (cleanW.length > 1 && cleanW === cleanW.toUpperCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    if (w === w.toLowerCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }
    return w;
  });
  cleaned = titleWords.join(' ');

  // 5. Cap topic labels at 32 characters
  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).replace(/[\s\-:,.;]+$/, '');
  }

  return cleaned || 'General';
}
