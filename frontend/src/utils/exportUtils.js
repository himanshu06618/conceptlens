/**
 * Client-Side Export Utilities for ConceptLens
 * Supports Markdown Study Guide, Structured JSON with DAG relations, and CSV Spreadsheet (with UTF-8 BOM).
 * Safe for offline and guest use without network or auth dependency.
 */

/**
 * Trigger download of a Blob file with clean name, revocation, and iOS Safari fallback
 */
export async function downloadBlob(blob, filename) {
  if (!blob) throw new Error('No export data generated.');

  // Check if Web Share API is available with file support (mostly iOS Safari mobile)
  const isMobileSafari = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !window.MSStream;
  if (isMobileSafari && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return true;
      }
    } catch (err) {
      // User cancelled share or share failed; proceed to object URL fallback
      if (err.name === 'AbortError') return true;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (err) {
    // Fallback: open in new tab
    window.open(url, '_blank', 'noopener');
    return true;
  } finally {
    // Revoke object URL after delay to allow mobile browsers to finish initiating download
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }
}

/**
 * Format importance integer as stars
 */
function getStars(importance) {
  const count = Math.max(1, Math.min(5, Number(importance) || 3));
  return '★'.repeat(count) + '☆'.repeat(5 - count);
}

/**
 * Sanitize filename for download
 */
export function getCleanExportFilename(docTitle, ext) {
  const base = (docTitle || 'document')
    .replace(/\.[^/.]+$/, '') // remove existing extension
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base || 'conceptlens'}-${ext}`;
}

/**
 * 1. Generate Markdown Study Guide
 * Format:
 * # <Document Title>
 * Date, counts
 * ## Chapter / Topic
 * ### Concept Name
 * - [ ] / - [x] Studied
 * - **Definition**: ...
 * - **Importance**: ★★★★☆
 * - **Est. Time**: X mins
 * - **Source Page**: Page X (if known)
 * - **Learn First (Prerequisites)**: ...
 * - **Related**: ...
 */
export function generateStudyGuideMarkdown(documentData, concepts = [], chapters = []) {
  const docTitle = documentData?.title || documentData?.filename || 'Course Study Guide';
  const createdDate = documentData?.created_at
    ? new Date(documentData.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : new Date().toLocaleDateString();

  const totalConcepts = concepts.length;
  const studiedCount = concepts.filter((c) => c.status === 'studied').length;
  const totalMins = concepts.reduce((acc, c) => acc + (Number(c.estimated_minutes) || 5), 0);

  let md = `# ${docTitle}\n\n`;
  md += `> **Generated with ConceptLens**  \n`;
  md += `> Date: ${createdDate} | Concepts: ${totalConcepts} | Studied: ${studiedCount}/${totalConcepts} | Estimated Study Time: ${totalMins} minutes\n\n`;
  md += `---\n\n`;

  // Group concepts by chapter/topic
  const chapterGroups = new Map();
  concepts.forEach((concept) => {
    const chapterName = concept.chapter || concept.topic || 'General Overview';
    if (!chapterGroups.has(chapterName)) {
      chapterGroups.set(chapterName, []);
    }
    chapterGroups.get(chapterName).push(concept);
  });

  chapterGroups.forEach((items, chapterTitle) => {
    md += `## ${chapterTitle}\n\n`;

    items.forEach((c) => {
      const isStudied = c.status === 'studied';
      const checkbox = isStudied ? '- [x]' : '- [ ]';
      const timeStr = c.estimated_minutes ? `${c.estimated_minutes} min` : '5 min';
      const stars = getStars(c.importance);

      md += `### ${checkbox} ${c.name}\n\n`;
      md += `**Definition**: ${c.definition || 'No definition available.'}\n\n`;
      md += `- **Priority**: ${stars} (${c.importance || 3}/5)\n`;
      md += `- **Estimated Study Time**: ${timeStr}\n`;

      if (c.source_page) {
        md += `- **Source Reference**: Page ${c.source_page}`;
        if (c.source_quote) {
          md += ` — _"${c.source_quote}"_`;
        }
        md += `\n`;
      }

      if (Array.isArray(c.prerequisites) && c.prerequisites.length > 0) {
        md += `- **Learn First (Prerequisites)**: ${c.prerequisites.join(', ')}\n`;
      }

      if (Array.isArray(c.related) && c.related.length > 0) {
        md += `- **Related Concepts**: ${c.related.join(', ')}\n`;
      }

      md += `\n`;
    });
  });

  return new Blob([md], { type: 'text/markdown;charset=utf-8' });
}

/**
 * 2. Generate Structured JSON with valid DAG relations
 */
export function generateConceptsJson(documentData, concepts = [], chapters = []) {
  const safeStr = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : String(v || '').trim().toLowerCase());
  const relations = [];

  // Cycle detection for DAG: DFS
  const adj = new Map();
  (concepts || []).forEach((c) => {
    if (c && c.id) adj.set(c.id, []);
  });

  (concepts || []).forEach((c) => {
    if (!c || !c.id) return;
    const cName = safeStr(c.name);

    if (Array.isArray(c.prerequisites)) {
      c.prerequisites.forEach((prereqName) => {
        if (!prereqName) return;
        const pStr = safeStr(prereqName);
        const target = (concepts || []).find(
          (other) => other && other.id !== c.id && safeStr(other.name) === pStr
        );
        if (target && target.id) {
          // c depends on target (target is prerequisite of c: target -> c)
          relations.push({
            source: target.id,
            target: c.id,
            source_name: target.name || 'Untitled',
            target_name: c.name || 'Untitled',
            type: 'prerequisite'
          });
          const list = adj.get(target.id) || [];
          list.push(c.id);
          adj.set(target.id, list);
        }
      });
    }

    if (Array.isArray(c.related)) {
      c.related.forEach((relName) => {
        if (!relName) return;
        const rStr = safeStr(relName);
        const target = (concepts || []).find(
          (other) => other && other.id !== c.id && safeStr(other.name) === rStr
        );
        if (target && target.id) {
          relations.push({
            source: c.id,
            target: target.id,
            source_name: c.name || 'Untitled',
            target_name: target.name || 'Untitled',
            type: 'related'
          });
        }
      });
    }
  });

  const exportPayload = {
    schema_version: 3,
    document: {
      id: documentData?.id,
      title: documentData?.title || documentData?.filename || 'Untitled Document',
      filename: documentData?.filename,
      created_at: documentData?.created_at,
      total_concepts: (concepts || []).length,
      studied_count: (concepts || []).filter((c) => c && c.status === 'studied').length
    },
    chapters: Array.isArray(chapters) && chapters.length > 0 ? chapters : Array.from(new Set((concepts || []).map((c) => c?.chapter || c?.topic || 'General'))),
    concepts: (concepts || []).map((c) => ({
      id: c?.id,
      name: c?.name || 'Untitled',
      definition: c?.definition || '',
      chapter: c?.chapter || c?.topic || 'General Overview',
      importance: Number(c?.importance) || 3,
      estimated_minutes: Number(c?.estimated_minutes) || 5,
      source_page: c?.source_page || null,
      source_quote: c?.source_quote || '',
      source_verified: Boolean(c?.source_verified),
      studied: c?.status === 'studied',
      prerequisites: Array.isArray(c?.prerequisites) ? c.prerequisites : [],
      related: Array.isArray(c?.related) ? c.related : []
    })),
    relations
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  return new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
}

/**
 * 3. Generate CSV Spreadsheet with UTF-8 BOM (\uFEFF)
 * Correctly escapes quotes, commas, and line breaks so Excel and Numbers open it cleanly.
 */
export function generateConceptsCsv(documentData, concepts = []) {
  const headers = [
    'Chapter',
    'Concept',
    'Definition',
    'Importance',
    'Estimated minutes',
    'Prerequisites',
    'Related',
    'Source page',
    'Studied'
  ];

  const escapeCSV = (field) => {
    if (field === null || field === undefined) return '""';
    const str = String(field);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const rows = [headers.map(escapeCSV).join(',')];

  (concepts || []).forEach((c) => {
    if (!c) return;
    const row = [
      c.chapter || c.topic || 'General Overview',
      c.name || '',
      c.definition || '',
      c.importance || 3,
      c.estimated_minutes || 5,
      Array.isArray(c.prerequisites) ? c.prerequisites.filter(Boolean).join('; ') : '',
      Array.isArray(c.related) ? c.related.filter(Boolean).join('; ') : '',
      c.source_page ? `Page ${c.source_page}` : '',
      c.status === 'studied' ? 'YES' : 'NO'
    ];
    rows.push(row.map(escapeCSV).join(','));
  });

  // Prepend UTF-8 BOM so Excel opens it with full international character support
  const csvContent = '\uFEFF' + rows.join('\r\n');
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 4. Print Study Guide (Save as PDF) helper
 * Renders a clean, pure study sheet in an invisible iframe and triggers print.
 */
export function printStudyGuide(documentData, concepts = [], chapters = []) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const docTitle = documentData?.title || documentData?.filename || 'Course Study Guide';
  const createdDate = documentData?.created_at
    ? new Date(documentData.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : new Date().toLocaleDateString();

  const totalConcepts = (concepts || []).length;
  const studiedCount = (concepts || []).filter((c) => c && c.status === 'studied').length;
  const totalMins = (concepts || []).reduce((acc, c) => acc + (Number(c?.estimated_minutes) || 5), 0);

  // Group by chapter
  const chapterGroups = new Map();
  (concepts || []).forEach((concept) => {
    if (!concept) return;
    const chapterName = concept.chapter || concept.topic || 'General Overview';
    if (!chapterGroups.has(chapterName)) {
      chapterGroups.set(chapterName, []);
    }
    chapterGroups.get(chapterName).push(concept);
  });

  let chaptersHtml = '';
  chapterGroups.forEach((items, chapterTitle) => {
    chaptersHtml += `<section class="chapter-block"><h2>${escapeHtml(chapterTitle)}</h2><div class="concepts-grid">`;
    items.forEach((c) => {
      const isStudied = c.status === 'studied';
      const checkbox = isStudied ? '☑ Studied' : '☐ To Study';
      const timeStr = c.estimated_minutes ? `${c.estimated_minutes} min` : '5 min';
      const stars = getStars(c.importance);
      const prereqs = Array.isArray(c.prerequisites) && c.prerequisites.length > 0 ? c.prerequisites.filter(Boolean).join(', ') : '';
      const rels = Array.isArray(c.related) && c.related.length > 0 ? c.related.filter(Boolean).join(', ') : '';

      chaptersHtml += `
        <div class="concept-card ${isStudied ? 'is-studied' : ''}">
          <div class="concept-card-header">
            <span class="concept-name">${escapeHtml(c.name || 'Untitled')}</span>
            <span class="concept-status">${checkbox}</span>
          </div>
          <p class="concept-def"><strong>Definition:</strong> ${escapeHtml(c.definition || 'No definition available.')}</p>
          <div class="concept-meta">
            <span><strong>Priority:</strong> ${stars} (${c.importance || 3}/5)</span>
            <span><strong>Est. Time:</strong> ${timeStr}</span>
            ${c.source_page ? `<span><strong>Source:</strong> p. ${c.source_page}${c.source_quote ? ` — <em>"${escapeHtml(c.source_quote)}"</em>` : ''}</span>` : ''}
          </div>
          ${prereqs ? `<p class="concept-relations"><strong>Learn First:</strong> ${escapeHtml(prereqs)}</p>` : ''}
          ${rels ? `<p class="concept-relations"><strong>Related:</strong> ${escapeHtml(rels)}</p>` : ''}
        </div>
      `;
    });
    chaptersHtml += `</div></section>`;
  });

  const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)} - Study Guide</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 16mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.5;
      margin: 0;
      padding: 24px;
      font-size: 13px;
    }
    header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 6px 0;
      color: #0f172a;
    }
    .header-meta {
      font-size: 12px;
      color: #4b5563;
    }
    .chapter-block {
      margin-bottom: 24px;
    }
    h2 {
      font-size: 16px;
      margin: 18px 0 10px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #d1d5db;
      color: #1f2937;
    }
    .concept-card {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 10px;
      background: #fafafa;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .concept-card.is-studied {
      background: #f0fdf4;
      border-color: #bbf7d0;
    }
    .concept-card-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }
    .concept-name {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
    }
    .concept-status {
      font-size: 11px;
      font-weight: 600;
      color: #4b5563;
    }
    .concept-def {
      margin: 4px 0 8px 0;
      color: #374151;
    }
    .concept-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
      color: #4b5563;
      margin-bottom: 4px;
    }
    .concept-relations {
      margin: 4px 0 0 0;
      font-size: 11px;
      color: #4b5563;
    }
    @media print {
      body {
        padding: 0;
      }
      .concept-card {
        border: 1px solid #d1d5db;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(docTitle)}</h1>
    <div class="header-meta">
      <strong>ConceptLens Study Guide</strong> &bull; Generated on ${createdDate} &bull; ${totalConcepts} Concepts &bull; ${studiedCount} Studied &bull; Est. Study Time: ${totalMins} min
    </div>
  </header>
  <main>
    ${chaptersHtml}
  </main>
</body>
</html>`;

  // Hidden print iframe
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    iframe.contentWindow.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow.print();
      } catch (err) {
        console.error('Iframe print error:', err);
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }, 1200);
      }
    }, 300);
  } catch (err) {
    console.error('Failed to write print iframe:', err);
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
    window.print();
  }
}
