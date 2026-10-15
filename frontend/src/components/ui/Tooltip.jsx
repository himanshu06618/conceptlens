import React, { useState, useRef, useEffect } from 'react';
import { OverlayPortal } from './Overlay';

/**
 * Clean Tooltip rendered through OverlayPortal into document.body
 */
export default function Tooltip({
  children,
  text,
  position = 'top',
  className = ''
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let top = 0;
    let left = rect.left + rect.width / 2;

    if (position === 'top') {
      top = rect.top - 8;
    } else if (position === 'bottom') {
      top = rect.bottom + 8;
    } else if (position === 'left') {
      top = rect.top + rect.height / 2;
      left = rect.left - 8;
    } else {
      top = rect.top + rect.height / 2;
      left = rect.right + 8;
    }
    setCoords({ top, left });
  };

  useEffect(() => {
    if (visible) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [visible, position]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`tooltip-wrapper ${className}`.trim()}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {visible && text && (
        <OverlayPortal>
          <div
            className={`tooltip-bubble tooltip-${position}`}
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              transform: position === 'top' ? 'translate(-50%, -100%)' :
                         position === 'bottom' ? 'translate(-50%, 0)' :
                         position === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
              zIndex: 99999,
              pointerEvents: 'none'
            }}
          >
            {text}
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
