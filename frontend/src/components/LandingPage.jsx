import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowRight, 
  ShieldCheck, 
  Zap, 
  HardDrive, 
  FileText, 
  Sparkles,
  GitBranch,
  Quote,
  Camera,
  Search,
  Download,
  Smartphone,
  CheckCircle2,
  Lock,
  Star,
  Eye,
  ExternalLink
} from 'lucide-react';
import { Button, Card, Badge, Logo } from './ui';

// Sample tree data for hero mockup and interactive demo
const SAMPLE_TREE = {
  root: { id: 'root', label: 'Quantum Mechanics', type: 'root', count: 14 },
  topics: [
    { id: 't1', label: 'Wave Mechanics', color: 'indigo', count: 5 },
    { id: 't2', label: 'Mathematical Formalism', color: 'gold', count: 5 },
    { id: 't3', label: 'Quantum Phenomena', color: 'teal', count: 4 }
  ],
  concepts: [
    { id: 'c1', topicId: 't1', label: 'Wave-Particle Duality', def: 'Postulate that physical entities exhibit both wave and particle characteristics.', importance: 5 },
    { id: 'c2', topicId: 't1', label: 'De Broglie Wavelength', def: 'Wavelength associated with any moving mass inversely proportional to its momentum.', importance: 4 },
    { id: 'c3', topicId: 't2', label: 'Schrödinger Equation', def: 'Fundamental differential equation governing deterministic time evolution of states.', importance: 5 },
    { id: 'c4', topicId: 't2', label: 'Wave Function (Ψ)', def: 'Complex probability amplitude whose squared magnitude represents probability density.', importance: 5 },
    { id: 'c5', topicId: 't3', label: 'Quantum Entanglement', def: 'Phenomenon where multiple quantum states are fundamentally linked across distance.', importance: 5 },
    { id: 'c6', topicId: 't3', label: 'Heisenberg Uncertainty', def: 'Mathematical limit on simultaneously measuring conjugate variables like position and momentum.', importance: 4 }
  ]
};

export default function LandingPage({ onOpenAuth }) {
  const navigate = useNavigate();
  const [activeDemoNode, setActiveDemoNode] = useState(SAMPLE_TREE.concepts[0]);
  const [activeTopicFilter, setActiveTopicFilter] = useState('ALL');

  const filteredDemoConcepts = activeTopicFilter === 'ALL'
    ? SAMPLE_TREE.concepts
    : SAMPLE_TREE.concepts.filter((c) => c.topicId === activeTopicFilter);

  return (
    <div className="landing-page-wrap">
      {/* Background Atmosphere - static grid texture only */}
      <div className="hero-grid-texture" aria-hidden="true" />

      {/* =====================================================================
          1. HERO SECTION (Static Clean Typography)
          ===================================================================== */}
      <section className="landing-hero-section">
        <div className="hero-pill-tag">
          <Sparkles size={14} strokeWidth={2} style={{ color: 'var(--gold-deep)' }} />
          <span>Private concept extraction for students</span>
        </div>

        <h1 className="hero-display-headline">
          Turn messy notes into a{' '}
          <span className="headline-gold-highlight">map of ideas.</span>
        </h1>

        <p className="hero-lead-text">
          Upload PDFs, photos, or text and get key concepts, definitions, and a structured concept tree, processed privately on your own device.
        </p>

        <div className="hero-cta-group">
          <Button
            variant="primary"
            size="lg"
            icon={ArrowRight}
            iconPosition="right"
            onClick={() => navigate('/app')}
          >
            Upload your notes
          </Button>

          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              const el = document.getElementById('how-it-works');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            See how it works
          </Button>
        </div>

        {/* =====================================================================
            2. HERO VISUAL MOCKUP: Clean Static Window Frame
            ===================================================================== */}
        <div className="hero-mockup-container">
          <div className="hero-mockup-frame shadow-lg">
            {/* Window titlebar with controls */}
            <div className="mockup-window-header">
              <div className="mockup-dots">
                <span className="dot red" />
                <span className="dot yellow" />
                <span className="dot green" />
              </div>
              <div className="mockup-window-title">
                ConceptLens — Quantum_Mechanics_Lectures.pdf
              </div>
              <div className="mockup-tag">
                <span className="live-dot" /> Concept Map
              </div>
            </div>

            {/* Stage content: Clean static concept tree mockup */}
            <div className="mockup-stage-content">
              <div className="mockup-tree-wrapper">
                {/* Level 0: Root */}
                <div className="mockup-node root-node">
                  <div className="node-eyebrow">ROOT CONCEPT</div>
                  <div className="node-title">Quantum Mechanics</div>
                  <div className="node-meta">14 core definitions</div>
                </div>

                {/* Level 1: Topic Branches */}
                <div className="mockup-branches-row">
                  {SAMPLE_TREE.topics.map((t) => (
                    <div
                      key={t.id}
                      className={`mockup-node topic-node branch-${t.color}`}
                    >
                      <div className="topic-indicator-dot" />
                      <span>{t.label}</span>
                      <span className="branch-count-chip">{t.count}</span>
                    </div>
                  ))}
                </div>

                {/* Level 2: Concept Nodes */}
                <div className="mockup-concepts-row">
                  {SAMPLE_TREE.concepts.slice(0, 4).map((c) => (
                    <div
                      key={c.id}
                      className="mockup-node concept-node"
                    >
                      <div className="concept-node-header">
                        <span className="concept-name">{c.label}</span>
                        <span className="star-rating">★ {c.importance}</span>
                      </div>
                      <p className="concept-def-snippet">{c.def}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. TRUST STRIP
          ===================================================================== */}
      <section className="trust-strip-section">
        <div className="trust-strip-grid">
          <div className="trust-item">
            <div className="trust-icon-box">
              <FileText size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="trust-title">PDF, Images & Text</div>
              <div className="trust-desc">Extract from textbooks, scans, or notes</div>
            </div>
          </div>

          <div className="trust-item">
            <div className="trust-icon-box">
              <HardDrive size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="trust-title">Works Offline-First</div>
              <div className="trust-desc">Local NLP processing & SQLite storage</div>
            </div>
          </div>

          <div className="trust-item">
            <div className="trust-icon-box">
              <Zap size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="trust-title">Free to Try</div>
              <div className="trust-desc">5 guest uploads, no credit card required</div>
            </div>
          </div>

          <div className="trust-item">
            <div className="trust-icon-box">
              <ShieldCheck size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="trust-title">Your Files Stay Private</div>
              <div className="trust-desc">Never sent to external AI providers</div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          4. HOW IT WORKS (3 Large Numbered Steps)
          ===================================================================== */}
      <section id="how-it-works" className="how-it-works-section">
        <div className="section-header-centered">
          <span className="section-kicker">Simple 3-Step Process</span>
          <h2 className="section-display-title">From lecture notes to understanding</h2>
          <p className="section-subtext">
            Three simple steps transform unstructured text and photos into an interactive roadmap.
          </p>
        </div>

        <div className="steps-cards-grid">
          <Card className="step-card" hoverable spotlight>
            <div className="step-number-tag">01</div>
            <div className="step-icon-wrap">
              <FileText size={24} strokeWidth={1.8} />
            </div>
            <h3 className="step-title">Upload your materials</h3>
            <p className="step-description">
              Drop course slide PDFs, handwritten whiteboard photos, or lecture text. Our on-device preprocessor cleans headers and prepares text for extraction.
            </p>
          </Card>

          <Card className="step-card" hoverable spotlight>
            <div className="step-number-tag">02</div>
            <div className="step-icon-wrap">
              <Sparkles size={24} strokeWidth={1.8} />
            </div>
            <h3 className="step-title">Extract key principles</h3>
            <p className="step-description">
              Our local rule-based NLP pipeline extracts definitional patterns, formulas, and terminology, scoring each concept by relevance without external LLM latency.
            </p>
          </Card>

          <Card className="step-card" hoverable spotlight>
            <div className="step-number-tag">03</div>
            <div className="step-icon-wrap">
              <GitBranch size={24} strokeWidth={1.8} />
            </div>
            <h3 className="step-title">Explore the concept tree</h3>
            <p className="step-description">
              Interact with a hierarchical concept tree of your entire unit. Zoom into core sub-branches, inspect source citations, and export to study guides or CSV.
            </p>
          </Card>
        </div>
      </section>

      {/* =====================================================================
          5. FEATURES BENTO GRID (Asymmetric Cards with Spotlight)
          ===================================================================== */}
      <section className="bento-features-section">
        <div className="section-header-centered">
          <span className="section-kicker">Engineered for Students</span>
          <h2 className="section-display-title">Everything you need to master your syllabus</h2>
          <p className="section-subtext">
            Every feature is built around clarity, speed, and privacy.
          </p>
        </div>

        <div className="bento-grid">
          {/* Card 1: Large Concept Tree Feature (Span 8) */}
          <Card className="bento-card bento-span-8" hoverable spotlight>
            <div className="bento-content">
              <Badge variant="amber" size="sm">Signature Feature</Badge>
              <h3 className="bento-title">Interactive Concept Tree & Roadmap</h3>
              <p className="bento-description">
                Visualize how ideas connect across your lecture syllabus. Expand and collapse branches, inspect parent-child relationships, and switch between horizontal and vertical orientations.
              </p>
            </div>
            <div className="bento-visual tree-preview-box">
              <div className="bento-mini-tree">
                <div className="bento-node root">Physics 401</div>
                <div className="bento-connector" />
                <div className="bento-row">
                  <div className="bento-node branch">Waves</div>
                  <div className="bento-node branch">Operators</div>
                  <div className="bento-node branch">States</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Card 2: Definitions with Citations (Span 4) */}
          <Card className="bento-card bento-span-4" hoverable spotlight>
            <div className="bento-content">
              <Quote size={20} strokeWidth={1.8} style={{ color: 'var(--gold-deep)' }} />
              <h3 className="bento-title">Exact Source Citations</h3>
              <p className="bento-description">
                Every extracted definition includes the verbatim lecture excerpt and exact page number, so you can always cross-reference context.
              </p>
            </div>
          </Card>

          {/* Card 3: OCR for Photos & Scans (Span 4) */}
          <Card className="bento-card bento-span-4" hoverable spotlight>
            <div className="bento-content">
              <Camera size={20} strokeWidth={1.8} style={{ color: 'var(--branch-indigo)' }} />
              <h3 className="bento-title">Local OCR for Scans</h3>
              <p className="bento-description">
                Photograph handwritten notebook pages or whiteboard sketches. On-device OCR extracts the text directly into concepts.
              </p>
            </div>
          </Card>

          {/* Card 4: Search & Filters (Span 4) */}
          <Card className="bento-card bento-span-4" hoverable spotlight>
            <div className="bento-content">
              <Search size={20} strokeWidth={1.8} style={{ color: 'var(--branch-teal)' }} />
              <h3 className="bento-title">Instant Search & Filter</h3>
              <p className="bento-description">
                Filter by topic, page range, or importance rating (1 to 5 stars). Search across terms, definitions, and excerpt text instantly.
              </p>
            </div>
          </Card>

          {/* Card 5: Multi-Format Export (Span 4) */}
          <Card className="bento-card bento-span-4" hoverable spotlight>
            <div className="bento-content">
              <Download size={20} strokeWidth={1.8} style={{ color: 'var(--branch-rose)' }} />
              <h3 className="bento-title">Versatile Export Formats</h3>
              <p className="bento-description">
                Export concepts into CSV tables, structured JSON, Study Guides, or formatted notes for study apps.
              </p>
            </div>
          </Card>

          {/* Card 6: Private by Design (Span 6) */}
          <Card className="bento-card bento-span-6" hoverable spotlight>
            <div className="bento-content">
              <ShieldCheck size={20} strokeWidth={1.8} style={{ color: 'var(--success)' }} />
              <h3 className="bento-title">Private & Local by Design</h3>
              <p className="bento-description">
                Your coursework notes, unreleased research papers, and assignments stay strictly on your local machine. No third-party AI training.
              </p>
            </div>
          </Card>

          {/* Card 7: Desktop & Mobile PWA (Span 6) */}
          <Card className="bento-card bento-span-6" hoverable spotlight>
            <div className="bento-content">
              <Smartphone size={20} strokeWidth={1.8} style={{ color: 'var(--branch-sky)' }} />
              <h3 className="bento-title">Responsive & Installable PWA</h3>
              <p className="bento-description">
                Works fluidly from 320px smartphones to 4K desktop displays with touch-first gestures, drawer panels, and offline caching.
              </p>
            </div>
          </Card>
        </div>
      </section>

      {/* =====================================================================
          6. INTERACTIVE DEMO SECTION (ON MIDNIGHT BACKGROUND)
          ===================================================================== */}
      <section className="interactive-demo-section">
        <div className="demo-stage-card">
          <div className="demo-stage-header">
            <div>
              <span className="demo-kicker">Interactive Stage</span>
              <h2 className="demo-stage-title">Experience the concept map</h2>
              <p className="demo-stage-sub">
                Click any concept node below to test how definitions and relationships are structured.
              </p>
            </div>

            <Button
              variant="primary"
              size="md"
              icon={ArrowRight}
              iconPosition="right"
              onClick={() => navigate('/app')}
            >
              Try your own notes
            </Button>
          </div>

          <div className="demo-stage-canvas">
            <div className="tree-stage-glow" />
            <div className="tree-stage-grid" />

            {/* Topic Filter Pills */}
            <div className="demo-controls-bar">
              <button
                type="button"
                className={`demo-filter-btn ${activeTopicFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setActiveTopicFilter('ALL')}
              >
                All Branches
              </button>
              {SAMPLE_TREE.topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`demo-filter-btn ${activeTopicFilter === t.id ? 'active' : ''}`}
                  onClick={() => setActiveTopicFilter(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Interactive Nodes Stage */}
            <div className="demo-nodes-grid">
              {filteredDemoConcepts.map((c) => {
                const isSelected = activeDemoNode?.id === c.id;
                return (
                  <div
                    key={c.id}
                    className={`demo-node-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setActiveDemoNode(c)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="demo-card-head">
                      <span className="demo-node-name">{c.label}</span>
                      <span className="demo-stars">★ {c.importance}</span>
                    </div>
                    <p className="demo-node-def">{c.def}</p>
                  </div>
                );
              })}
            </div>

            {/* Selected Node Inspector Callout */}
            {activeDemoNode && (
              <div className="demo-inspector-callout">
                <div className="inspector-head">
                  <Badge variant="amber" size="sm">ACTIVE CONCEPT</Badge>
                  <span className="inspector-title">{activeDemoNode.label}</span>
                </div>
                <p className="inspector-text">"{activeDemoNode.def}"</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* =====================================================================
          7. PRIVACY SECTION
          ===================================================================== */}
      <section className="privacy-highlight-section">
        <div className="privacy-card-inner">
          <div className="privacy-icon-badge">
            <Lock size={24} strokeWidth={1.8} style={{ color: 'var(--gold-deep)' }} />
          </div>
          <h2 className="privacy-heading">Built for absolute academic privacy</h2>
          <p className="privacy-body">
            ConceptLens runs locally on the machine you control. When you upload PDFs or notes, text extraction, OCR, and relationship modeling happen strictly inside your own environment using open-source Python libraries. No external AI APIs, no cloud training on your papers, and no third-party data sharing.
          </p>
          <div className="privacy-guarantees-row">
            <div className="guarantee-item">
              <CheckCircle2 size={16} strokeWidth={2} style={{ color: 'var(--success)' }} />
              <span>Isolated SQLite user storage</span>
            </div>
            <div className="guarantee-item">
              <CheckCircle2 size={16} strokeWidth={2} style={{ color: 'var(--success)' }} />
              <span>No third-party LLM transmission</span>
            </div>
            <div className="guarantee-item">
              <CheckCircle2 size={16} strokeWidth={2} style={{ color: 'var(--success)' }} />
              <span>Instant one-click document deletion</span>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          8. FINAL CALL TO ACTION (Midnight Band with Gold Glow)
          ===================================================================== */}
      <section className="final-cta-section">
        <div className="final-cta-band shadow-midnight">
          <div className="cta-glow-effect" />
          <h2 className="cta-serif-title">
            Start mapping your course concepts today.
          </h2>
          <p className="cta-subtitle">
            Upload your first lecture notes in seconds. Free for up to 5 documents with zero setup.
          </p>
          <Button
            variant="primary"
            size="lg"
            icon={ArrowRight}
            iconPosition="right"
            onClick={() => navigate('/app')}
          >
            Upload your notes
          </Button>
        </div>
      </section>

      {/* =====================================================================
          9. MINIMAL FOOTER
          ===================================================================== */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-left">
            <Logo size={24} />
            <span className="footer-copy">Local, privacy-first study assistant for students and researchers.</span>
          </div>
          <div className="footer-right">
            <button type="button" className="footer-link" onClick={() => navigate('/app')}>
              Open Workspace
            </button>
            <span className="footer-bullet">•</span>
            <span className="footer-copyright">© {new Date().getFullYear()} ConceptLens.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
