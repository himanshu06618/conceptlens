import React from 'react';
import { Check, Sparkles } from 'lucide-react';

/**
 * Premium Pipeline Stepper Component
 * A luxury multi-stage pipeline indicator with smooth progress fill,
 * luminous active node glow, and structured typography hierarchy.
 *
 * Props:
 * - steps: Array of { id, label, desc }
 * - currentStepIndex: number (0-based)
 * - className: string
 * - style: object
 */
export default function Stepper({
  steps = [],
  currentStepIndex = 0,
  className = '',
  style = {}
}) {
  // Clamp percentage calculation
  const totalSteps = steps.length;
  const safeIndex = Math.min(Math.max(0, currentStepIndex), totalSteps - 1);
  const percentComplete = totalSteps > 1
    ? (safeIndex / (totalSteps - 1)) * 100
    : 0;

  return (
    <div className={`premium-stepper-root ${className}`.trim()} style={style}>
      {/* Background Track with Luminous Gradient Fill */}
      <div className="premium-stepper-track-bg">
        <div
          className="premium-stepper-track-active"
          style={{ width: `${percentComplete}%` }}
        >
          <div className="track-shimmer-glow" />
        </div>
      </div>

      {/* Step Nodes Row */}
      <div className="premium-stepper-steps-row">
        {steps.map((step, idx) => {
          const isCompleted = idx < currentStepIndex;
          const isActive = idx === currentStepIndex;
          const isPending = idx > currentStepIndex;

          let statusClass = 'step-pending';
          if (isCompleted) statusClass = 'step-completed';
          if (isActive) statusClass = 'step-active';

          return (
            <div
              key={step.id || idx}
              className={`premium-stepper-column ${statusClass}`}
              aria-current={isActive ? 'step' : undefined}
            >
              {/* Circular Interactive Node */}
              <div className="premium-stepper-node-wrap">
                {isCompleted ? (
                  <div className="node-circle node-circle-completed">
                    <Check size={16} strokeWidth={2.6} className="node-icon-check" />
                  </div>
                ) : isActive ? (
                  <div className="node-circle node-circle-active">
                    <div className="node-active-pulse-ring" />
                    <div className="node-active-spinner" />
                    <span className="node-active-core" />
                  </div>
                ) : (
                  <div className="node-circle node-circle-pending">
                    <span className="node-number">{idx + 1}</span>
                  </div>
                )}
              </div>

              {/* Status Pill Tag */}
              <div className="premium-stepper-badge-wrap">
                {isCompleted && (
                  <span className="status-pill status-pill-completed">Done</span>
                )}
                {isActive && (
                  <span className="status-pill status-pill-active">
                    <span className="status-pulse-dot" />
                    In Progress
                  </span>
                )}
                {isPending && (
                  <span className="status-pill status-pill-pending">Step {idx + 1}</span>
                )}
              </div>

              {/* Structured Typography: Label & Description (Never collides) */}
              <div className="premium-stepper-text-group">
                <span className="step-title-text">{step.label}</span>
                {step.desc && (
                  <span className="step-desc-text">{step.desc}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
