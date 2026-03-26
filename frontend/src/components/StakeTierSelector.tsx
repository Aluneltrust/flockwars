// ============================================================================
// STAKE TIER SELECTOR COMPONENT
// ============================================================================

import React from 'react';
import {
  Egg, Shield, Swords, Crosshair, Coins, Anchor, Wind, Flame, Trophy,
} from 'lucide-react';
import { STAKE_TIERS } from '../constants';
import { bsvPriceService } from '../services';

interface StakeTierSelectorProps {
  selectedTier: number;
  onSelectTier: (tier: number) => void;
  disabled?: boolean;
  showSatsConversion?: boolean;
  compact?: boolean;
}

// Tier lucide icons
const TIER_ICONS: Record<number, React.ReactNode> = {
  1:   <Egg size={28} />,        // Penny - Rookie
  5:   <Shield size={28} />,     // Nickel - Shepherd
  10:  <Swords size={28} />,     // Dime - Rancher
  25:  <Crosshair size={28} />,  // Quarter - Cowboy
  50:  <Coins size={28} />,      // Half - High Roller
  100: <Anchor size={28} />,     // Dollar - Whale
};

const TIER_ICONS_SMALL: Record<number, React.ReactNode> = {
  1:   <Egg size={20} />,
  5:   <Shield size={20} />,
  10:  <Swords size={20} />,
  25:  <Crosshair size={20} />,
  50:  <Coins size={20} />,
  100: <Anchor size={20} />,
};

export default function StakeTierSelector({ 
  selectedTier, 
  onSelectTier, 
  disabled = false,
  showSatsConversion = true,
  compact = false,
}: StakeTierSelectorProps) {
  
  const formatCents = (cents: number): string => {
    if (cents >= 100) {
      return `$${(cents / 100).toFixed(2)}`;
    }
    return `${cents}¢`;
  };

  const getSatsEquivalent = (cents: number): string => {
    try {
      const sats = bsvPriceService.centsToSats(cents);
      return `≈${sats.toLocaleString()} sats`;
    } catch {
      return '';
    }
  };

  return (
    <div className={`tier-selector ${compact ? 'compact' : ''}`}>
      <div className="tier-label">
        <span>Select Stakes</span>
        {showSatsConversion && (
          <span className="bsv-price">BSV: {bsvPriceService.getPriceDisplay()}</span>
        )}
      </div>
      
      <div className="tier-grid">
        {STAKE_TIERS.map(tier => (
          <button
            key={tier.tier}
            className={`tier-btn ${selectedTier === tier.tier ? 'selected' : ''}`}
            onClick={() => onSelectTier(tier.tier)}
            disabled={disabled}
            title={`${tier.name} - ${formatCents(tier.tier)} per game`}
          >
            <span className="tier-icon">{TIER_ICONS[tier.tier] || <Crosshair size={28} />}</span>
            <span className="tier-name">{tier.name}</span>
            <span className="tier-amount">{formatCents(tier.tier)}</span>
            {showSatsConversion && !compact && (
              <span className="tier-sats">{getSatsEquivalent(tier.tier)}</span>
            )}
          </button>
        ))}
      </div>
      
      <div className="fee-notice">
        <span><Wind size={14} className="icon-inline" /> Miss → Escrow Pot</span>
        <span><Flame size={14} className="icon-inline" /> Hit → Paid by defender</span>
        <span><Trophy size={14} className="icon-inline" /> Winner gets 50% of pot</span>
      </div>
      
      {selectedTier > 0 && (
        <div className="selected-tier-info">
          <span className="selected-icon">{TIER_ICONS_SMALL[selectedTier]}</span>
          <span className="selected-name">
            {STAKE_TIERS.find(t => t.tier === selectedTier)?.name} Mode
          </span>
        </div>
      )}
    </div>
  );
}