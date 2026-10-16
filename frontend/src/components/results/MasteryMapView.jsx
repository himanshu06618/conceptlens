import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  BookOpen,
  ArrowRight,
  AlertTriangle,
  Lock,
  CheckCircle2,
  Play,
  RotateCcw,
  Target,
  Layers,
  ChevronRight,
  TrendingUp,
  Award
} from 'lucide-react';
import { fetchMasteryMap } from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';

export default function MasteryMapView({
  onOpenRoadmapChapter = () => {},
  onSelectConcept = () => {},
  isAuthenticated = true
}) {
  const [masteryData, setMasteryData] = useState({
    lectures: [],
    ready_to_learn_next: [],
    total_concepts: 0,
    total_studied: 0,
    overall_percentage: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchMasteryMap();
      setMasteryData(data);
    } catch (err) {
      setError(err.message || 'Failed to load mastery map.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading && masteryData.lectures.length === 0) {
    return (
      <div className="mastery-loader-wrap" style={{ minHeight: 450, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BookshelfLoader message="Aggregating course mastery and chapter progress..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mastery-error-card" role="alert">
        <AlertTriangle size={20} className="text-amber" />
        <div>
          <strong>Could not load mastery map</strong>
          <p>{error}</p>
        </div>
        <button type="button" onClick={loadData} className="mastery-retry-btn">
          <RotateCcw size={14} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  const { lectures, ready_to_learn_next, total_concepts, total_studied, overall_percentage } = masteryData;

  return (
    <div className="mastery-container" role="region" aria-label="Course Concept Mastery Map">
      {/* 1. Header Overview Card */}
      <div className="mastery-summary-card">
        <div className="mastery-summary-left">
          <div className="mastery-badge-icon">
            <Award size={24} />
          </div>
          <div className="mastery-summary-text">
            <span className="mastery-eyebrow">STUDENT KNOWLEDGE PROGRESS</span>
            <h2 className="mastery-headline">Course Mastery Map</h2>
            <p className="mastery-subhead">
              Track concept retention across lectures, identify weak areas, and follow targeted prerequisite paths.
            </p>
          </div>
        </div>

        <div className="mastery-stats-col">
          <div className="mastery-stat-item">
            <span className="mastery-stat-num">{overall_percentage}%</span>
            <span className="mastery-stat-label">Total Retention</span>
          </div>
          <div className="mastery-stat-divider" />
          <div className="mastery-stat-item">
            <span className="mastery-stat-num">{total_studied} / {total_concepts}</span>
            <span className="mastery-stat-label">Concepts Studied</span>
          </div>
        </div>
      </div>

      {/* 2. "Ready to Learn Next" Recommendation Tile */}
      {ready_to_learn_next && ready_to_learn_next.length > 0 && (
        <div className="mastery-ready-card" role="region" aria-label="Ready to Learn Next Recommendations">
          <div className="mastery-ready-header">
            <div className="mastery-ready-title-group">
              <Sparkles size={18} className="text-brand" />
              <h3>Ready to Learn Next</h3>
            </div>
            <span className="mastery-ready-badge">High Priority</span>
          </div>
          <p className="mastery-ready-desc">
            These foundational concepts have all prerequisite dependencies satisfied and unlock subsequent topics:
          </p>

          <div className="mastery-ready-grid">
            {ready_to_learn_next.map((rec) => (
              <div key={rec.concept_id} className="mastery-ready-item">
                <div className="mastery-ready-info">
                  <span className="mastery-ready-chapter">{rec.chapter}</span>
                  <strong className="mastery-ready-name">{rec.name}</strong>
                  <span className="mastery-ready-reason">{rec.reason}</span>
                </div>
                <button
                  type="button"
                  className="mastery-ready-btn"
                  onClick={() => onSelectConcept({ id: rec.concept_id, name: rec.name, document_id: rec.document_id })}
                  aria-label={`Start learning ${rec.name}`}
                >
                  <Play size={13} fill="currentColor" />
                  <span>Start</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Lectures & Chapter Tiles Grid (Screen 4) */}
      <div className="mastery-lectures-list">
        {lectures.map((lec) => (
          <div key={lec.document_id} className="mastery-lecture-section">
            <div className="mastery-lecture-header">
              <BookOpen size={16} className="text-brand" />
              <h3 className="mastery-lecture-title">{lec.document_title}</h3>
              <span className="mastery-lecture-count">{lec.chapters.length} chapters</span>
            </div>

            <div className="mastery-chapter-grid">
              {lec.chapters.map((chap, cIdx) => {
                const isWeakest = chap.is_weakest && chap.studied < chap.total;
                const isCompleted = chap.percentage === 100;
                const isLocked = !isAuthenticated && cIdx > 1;

                return (
                  <div
                    key={cIdx}
                    className={`mastery-chapter-card ${isWeakest ? 'is-weakest' : ''} ${isCompleted ? 'is-completed' : ''} ${isLocked ? 'is-locked' : ''}`}
                    role="region"
                    aria-label={`Chapter ${chap.chapter_name}, ${chap.percentage}% mastered`}
                  >
                    {/* Weakest Area Flag */}
                    {isWeakest && (
                      <div className="mastery-weakest-marker">
                        <AlertTriangle size={12} />
                        <span>Weakest area &bull; Needs review</span>
                      </div>
                    )}

                    <div className="mastery-chapter-top">
                      <h4 className="mastery-chapter-name" title={chap.chapter_name}>
                        {chap.chapter_name}
                      </h4>
                      <span className="mastery-chapter-percent">{chap.percentage}%</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="mastery-progress-track">
                      <div
                        className="mastery-progress-fill"
                        style={{ width: `${chap.percentage}%` }}
                      />
                    </div>

                    <div className="mastery-chapter-meta">
                      <span className="mastery-count-text">
                        <strong>{chap.studied}</strong> of {chap.total} concepts studied
                      </span>
                    </div>

                    {/* Next Up Concept */}
                    {chap.next_up && (
                      <div className="mastery-nextup-row">
                        <span className="mastery-nextup-label">NEXT UP:</span>
                        <strong className="mastery-nextup-name" title={chap.next_up}>
                          {chap.next_up}
                        </strong>
                      </div>
                    )}

                    {/* Locked Explanation */}
                    {isLocked ? (
                      <div className="mastery-locked-note">
                        <Lock size={12} />
                        <span>Sign in to unlock interactive progress tracking</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mastery-open-roadmap-btn"
                        onClick={() => onOpenRoadmapChapter(lec.document_id, chap.chapter_name)}
                        aria-label={`Open Roadmap at chapter ${chap.chapter_name}`}
                      >
                        <span>Open in Roadmap</span>
                        <ChevronRight size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
