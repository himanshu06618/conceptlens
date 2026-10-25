import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import sys

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))
from extractor_choice.service import run_extraction

def load_ground_truth(xlsx_path):
    with zipfile.ZipFile(xlsx_path, 'r') as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'d': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in tree.findall('.//d:si', ns):
                strings.append(''.join([t.text or '' for t in si.findall('.//d:t', ns)]))
        
        wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
        ns = {'d': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        r_id = None
        for s in wb_tree.findall('.//d:sheet', ns):
            if s.attrib.get('name') == 'Claude vs tools':
                r_id = s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
                break
        
        rels_tree = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        ns_rels = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
        target = None
        for rel in rels_tree.findall('.//r:Relationship', ns_rels):
            if rel.attrib['Id'] == r_id:
                target = rel.attrib['Target']
                break
        sheet_path = ('xl/' + target) if not target.startswith('/') else target[1:]

        sheet_tree = ET.fromstring(z.read(sheet_path))
        rows = sheet_tree.findall('.//d:row', ns)
        
        # Parse headers from row 1 to identify accepted phrase columns
        header_row = sheet_tree.find(".//d:row[@r='1']", ns)
        accepted_cols = set()
        for c in header_row.findall('./d:c', ns):
            ref = c.attrib.get('r')
            col = ''.join([ch for ch in ref if ch.isalpha()])
            t = c.attrib.get('t')
            v = c.find('d:v', ns)
            val = v.text if v is not None else ''
            if t == 's' and val:
                val = strings[int(val)]
            if val and val.lower().startswith('accepted tool phrase'):
                accepted_cols.add(col)
        
        concepts = []
        for row in rows:
            r_idx = int(row.attrib.get('r', 0))
            if r_idx == 1:
                continue
            cells = {}
            for c in row.findall('./d:c', ns):
                ref = c.attrib.get('r')
                col = ''.join([ch for ch in ref if ch.isalpha()])
                t = c.attrib.get('t')
                v = c.find('d:v', ns)
                val = v.text if v is not None else ''
                if t == 's' and val:
                    val = strings[int(val)]
                elif t == 'inlineStr':
                    is_elem = c.find('d:is', ns)
                    if is_elem is not None:
                        val = ''.join([t_elem.text or '' for t_elem in is_elem.findall('.//d:t', ns)])
                cells[col] = (val or '').strip()
            
            b_val = cells.get('B', '')
            if b_val in ['—', '–', '-', '---']:
                break
            if not b_val:
                continue
            
            accepted = []
            for col in accepted_cols:
                phrase = cells.get(col, '')
                if phrase:
                    accepted.append(phrase.strip())
            
            concepts.append({
                'row': r_idx,
                'concept': b_val,
                'accepted': accepted
            })
            
    return concepts

def evaluate_items(extracted_items, concepts):
    # extracted_items is a list of strings
    # concepts is list of {'concept': ..., 'accepted': [...]}
    total_items = len(extracted_items)
    if total_items == 0:
        return {
            'items': 0,
            'precision': 0.0,
            'recall': 0.0,
            'f1': 0.0,
            'correct_items': 0,
            'matched_concepts': 0,
            'total_concepts': len(concepts)
        }
    
    # Map normalized accepted phrase to concept index
    phrase_to_concept = {}
    for idx, c in enumerate(concepts):
        for acc in c['accepted']:
            phrase_to_concept[acc.lower().strip()] = idx
            
    correct_count = 0
    matched_concept_indices = set()
    
    for item in extracted_items:
        norm = item.lower().strip()
        if norm in phrase_to_concept:
            correct_count += 1
            matched_concept_indices.add(phrase_to_concept[norm])
            
    precision = correct_count / total_items
    recall = len(matched_concept_indices) / len(concepts) if concepts else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    
    return {
        'items': total_items,
        'correct_items': correct_count,
        'matched_concepts': len(matched_concept_indices),
        'total_concepts': len(concepts),
        'precision': precision,
        'recall': recall,
        'f1': f1
    }

if __name__ == "__main__":
    print("Evaluating baseline on both PDFs...")
    gt_l18 = load_ground_truth("research/precision_data/Lecture18_concept_extraction_comparison.xlsx")
    gt_phys = load_ground_truth("research/precision_data/Polarisation_LASER_FibreOptics_concept_extraction_comparison.xlsx")
    
    # 1. Physics chapter
    phys_pdf = "research/precision_data/Polarisation LASER & Fibre Optics -PPW.pdf"
    res_phys = run_extraction(phys_pdf, method="yake")
    phys_items = [c["name"] for c in res_phys["concepts"]]
    metrics_phys = evaluate_items(phys_items, gt_phys)
    print(f"Physics Baseline: {metrics_phys['items']} items, "
          f"P={metrics_phys['precision']:.1%}, R={metrics_phys['recall']:.1%}, F1={metrics_phys['f1']:.1%}")
    
    # 2. Lecture 18
    l18_pdf = "research/precision_data/Lecture 18 Pseudopolynomial.pdf"
    res_l18 = run_extraction(l18_pdf, method="yake")
    l18_items = [c["name"] for c in res_l18["concepts"]]
    metrics_l18 = evaluate_items(l18_items, gt_l18)
    print(f"Lecture 18 Baseline: {metrics_l18['items']} items, "
          f"P={metrics_l18['precision']:.1%}, R={metrics_l18['recall']:.1%}, F1={metrics_l18['f1']:.1%}")
