import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Global body scroll lock counter to support nested/stacked overlays.
 */
let scrollLockCount = 0;
let originalOverflow = '';

export function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = originalOverflow || '';
  }
}

/**
 * Standard CSS selector for focusable elements within dialogs/overlays.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Custom hook to handle focus trapping, Escape dismiss, click-outside,
 * scroll locking, and returning focus to the trigger.
 */
export function useOverlay({
  isOpen,
  onClose,
  containerRef,
  triggerRef = null,
  trapFocus = true,
  lockScroll = false,
  closeOnEscape = true,
  closeOnClickOutside = true,
}) {
  const previousActiveElementRef = useRef(null);

  // Focus preservation and scroll lock
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement;

    if (lockScroll) {
      lockBodyScroll();
    }

    // Auto-focus the first interactive element or the container
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const firstFocusable = containerRef.current.querySelector(FOCUSABLE_SELECTOR);
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          containerRef.current.focus?.();
        }
      }
    }, 20);

    return () => {
      clearTimeout(timer);
      if (lockScroll) {
        unlockBodyScroll();
      }
      // Return focus to trigger
      if (triggerRef?.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      } else if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === 'function' &&
        document.body.contains(previousActiveElementRef.current)
      ) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, lockScroll, triggerRef, containerRef]);

  // Keyboard navigation: Escape key & focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }

      if (trapFocus && e.key === 'Tab' && containerRef.current) {
        const focusables = Array.from(
          containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null); // only visible elements

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.elementFromPoint ? document.activeElement === first : document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, closeOnEscape, trapFocus, containerRef]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen || !closeOnClickOutside) return;

    const handlePointerDown = (e) => {
      // If click was inside container, ignore
      if (containerRef.current && containerRef.current.contains(e.target)) {
        return;
      }
      // If click was inside trigger button, ignore (trigger has its own toggle handler)
      if (triggerRef?.current && triggerRef.current.contains(e.target)) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen, onClose, closeOnClickOutside, containerRef, triggerRef]);
}

/**
 * Universal Portal component that mounts children directly into document.body.
 */
export function OverlayPortal({ children }) {
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

/**
 * Positioned dropdown portal that computes exact top/left/right coordinates
 * from a trigger element, ensuring it never overflows the viewport on any screen size.
 */
export function DropdownPortal({
  isOpen,
  onClose,
  triggerRef,
  children,
  align = 'right',
  placement = null,
  offset = 8,
  className = '',
  role = 'menu',
  ariaLabel = 'Menu',
}) {
  const panelRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 'auto' });

  // Resolve alignment from either align or placement prop
  const effectiveAlign = (placement && (placement.includes('start') || placement === 'left'))
    ? 'left'
    : (align === 'left' || align === 'start' ? 'left' : 'right');

  const updatePosition = useCallback(() => {
    if (!triggerRef?.current || !isOpen) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Viewport-safe horizontal clamping
    const panelWidth = panelRef.current ? panelRef.current.offsetWidth : 280;
    let top = rect.bottom + offset;
    let left;

    if (effectiveAlign === 'right') {
      left = rect.right - panelWidth;
      // Clamp to screen bounds
      if (left < 12) left = 12;
      if (left + panelWidth > vw - 12) left = vw - panelWidth - 12;
    } else {
      left = rect.left;
      if (left + panelWidth > vw - 12) left = vw - panelWidth - 12;
      if (left < 12) left = 12;
    }

    // Flip upwards if overflowing bottom of viewport
    const panelHeight = panelRef.current ? panelRef.current.offsetHeight : 200;
    if (top + panelHeight > vh - 16 && rect.top - panelHeight - offset > 16) {
      top = rect.top - panelHeight - offset;
    }

    setCoords({
      top: Math.round(top),
      left: Math.round(left),
      maxWidth: `calc(100vw - 24px)`,
    });
  }, [triggerRef, isOpen, effectiveAlign, offset]);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useOverlay({
    isOpen,
    onClose,
    containerRef: panelRef,
    triggerRef,
    trapFocus: true,
    lockScroll: false,
    closeOnEscape: true,
    closeOnClickOutside: true,
  });

  if (!isOpen) return null;

  return (
    <OverlayPortal>
      <div
        ref={panelRef}
        role={role}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`overlay-dropdown-panel ${className}`.trim()}
        style={{
          position: 'fixed',
          top: `${coords.top}px`,
          left: `${coords.left}px`,
          maxWidth: coords.maxWidth,
          zIndex: 1100,
        }}
      >
        {children}
      </div>
    </OverlayPortal>
  );
}

export default OverlayPortal;
