// ============================================================================
// CUSTOM GAME ICONS — Flock Wars / Herdswacker
// Uses PNG sheep variants with deterministic assignment per cell
// ============================================================================

import React, { useMemo } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// 10 unique animated sheep variants
const SHEEP_VARIANTS = [
  '/images/sheep/sheep-1.webp',
  '/images/sheep/sheep-2.webp',
  '/images/sheep/sheep-3.webp',
  '/images/sheep/sheep-4.webp',
  '/images/sheep/sheep-5.webp',
  '/images/sheep/sheep-6.webp',
  '/images/sheep/sheep-7.webp',
  '/images/sheep/sheep-8.webp',
  '/images/sheep/sheep-9.webp',
  '/images/sheep/sheep-10.webp',
];

/**
 * Returns a deterministic sheep variant index based on cell coordinates.
 * Same cell always gets same sheep — won't change until hit.
 */
function getSheepVariant(row: number, col: number): number {
  // Simple hash: mix row and col to get stable index
  const hash = (row * 7 + col * 13 + row * col * 3) % SHEEP_VARIANTS.length;
  return Math.abs(hash);
}

/**
 * Sheep icon — renders a unique PNG variant based on cell position.
 * Pass row & col props for deterministic variant selection.
 */
interface SheepIconProps extends IconProps {
  row?: number;
  col?: number;
  isHit?: boolean;
}

export const SheepIcon: React.FC<SheepIconProps> = ({ 
  size = 24, 
  className = '', 
  row = 0, 
  col = 0,
  isHit = false 
}) => {
  const variantIndex = useMemo(() => getSheepVariant(row, col), [row, col]);
  const src = isHit ? '/images/sheep/sheep-hit.png' : SHEEP_VARIANTS[variantIndex];

  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="🐑"
      className={`sheep-img ${isHit ? 'sheep-hit' : ''} ${className}`}
      style={{ pointerEvents: 'none', objectFit: 'contain' }}
      draggable={false}
    />
  );
};

/**
 * Game logo — shield with crosshair overlay
 */
export const GameLogo: React.FC<IconProps> = ({ size = 48, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M24 4L6 12v12c0 11 8 18 18 20 10-2 18-9 18-20V12L24 4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path
      d="M24 8L10 14v10c0 9 6.5 14.5 14 16.5 7.5-2 14-7.5 14-16.5V14L24 8z"
      fill="currentColor"
      opacity="0.12"
    />
    <line x1="24" y1="14" x2="24" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="24" y1="28" x2="24" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="15" y1="24" x2="21" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="27" y1="24" x2="33" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="24" cy="24" r="2" fill="currentColor" />
  </svg>
);

/**
 * Hit marker — explosion/impact burst
 */
export const HitIcon: React.FC<IconProps> = ({ size = 24, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L14 8.5L20 6L16.5 11.5L22 14L15.5 14.5L17 21L12 16.5L7 21L8.5 14.5L2 14L7.5 11.5L4 6L10 8.5L12 2z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.5"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Miss marker — subtle puff/smoke
 */
export const MissIcon: React.FC<IconProps> = ({ size = 24, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="12" cy="14" r="5" fill="currentColor" opacity="0.3" />
    <circle cx="8" cy="12" r="3.5" fill="currentColor" opacity="0.25" />
    <circle cx="16" cy="11" r="4" fill="currentColor" opacity="0.2" />
    <circle cx="12" cy="9" r="3" fill="currentColor" opacity="0.15" />
    <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
  </svg>
);

/**
 * Alert triangle
 */
export const AlertIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L1 21h22L12 2z"
      fill="currentColor"
      opacity="0.15"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="17.5" r="1" fill="currentColor" />
  </svg>
);

/**
 * Info icon
 */
export const InfoIcon: React.FC<IconProps> = ({ size = 16, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor" opacity="0.1" />
    <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="12" cy="8" r="1" fill="currentColor" />
  </svg>
);