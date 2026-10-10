import React, { useRef } from 'react';

/**
 * Premium Card with Desktop Cursor Spotlight
 * Clean white surface, 1px border, layered soft shadow, 18px radius.
 * On desktop hover, a soft radial champagne-gold highlight gently follows the cursor.
 */
export default function Card({
  children,
  className = '',
  hoverable = false,
  spotlight = true,
  elevation = 'sm', // 'sm', 'md', 'lg'
  onClick,
  ...props
}) {
  const cardRef = useRef(null);

  const handleMouseMove = (e) => {
    if (!spotlight || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty('--mouse-x', `${x}px`);
    cardRef.current.style.setProperty('--mouse-y', `${y}px`);
  };

  const elevationClass = elevation === 'lg' ? 'shadow-lg' : elevation === 'md' ? 'shadow-md' : 'shadow-sm';
  const hoverClass = hoverable ? 'card-hoverable' : '';
  const spotlightClass = spotlight ? 'spotlight-card' : '';

  return (
    <div
      ref={cardRef}
      className={`premium-card ${elevationClass} ${hoverClass} ${spotlightClass} ${className}`.trim()}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}
