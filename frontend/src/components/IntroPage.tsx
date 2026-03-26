// ============================================================================
// INTRO PAGE — First-time landing page for Flock Wars
// ============================================================================

import React, { useState, useEffect } from 'react';
import {
  Hexagon, Coins, Trophy, Swords, Shield, Lock,
  Landmark, ChevronRight, Zap, Target, Wind, Flame,
} from 'lucide-react';
import { GameLogo } from './GameIcons';

interface IntroPageProps {
  onGetStarted: () => void;
}

export default function IntroPage({ onGetStarted }: IntroPageProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div className={`intro-page ${visible ? 'intro-visible' : ''}`}>
      <video
        className="intro-bg-video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/videos/intro-bg.mp4" type="video/mp4" />
      </video>

      <div className="intro-content">
        {/* Hero */}
        <div className="intro-hero">
          <div className="intro-logo">
            <GameLogo size={72} className="intro-logo-icon" />
          </div>
          <h1 className="intro-title">
            Flock Wars<span className="intro-tm">™</span>
          </h1>
          <p className="intro-tagline">On-Chain Multiplayer Sheep Battle</p>
        </div>

        {/* Description */}
        <div className="intro-description">
          <p>
            Hide your herd. Hunt theirs. Every shot costs real satoshis — 
            misses fill the pot, hits punish the defender. The last shepherd 
            standing takes 80% of the escrow. All payments settle live on the 
            BSV blockchain. No accounts. No middlemen. Just your wallet 
            and your wits.
          </p>
        </div>

        {/* How It Works */}
        <div className="intro-steps">
          <div className="intro-step">
            <div className="step-icon"><Hexagon size={22} /></div>
            <div className="step-text">
              <span className="step-label">Place</span>
              <span className="step-desc">Hide 14 sheep across 4 herds on a hex grid</span>
            </div>
          </div>

          <div className="intro-step">
            <div className="step-icon"><Target size={22} /></div>
            <div className="step-text">
              <span className="step-label">Shoot</span>
              <span className="step-desc">Hide 10 sheep across 4 herds on a hex grid</span>
            </div>
          </div>

          <div className="intro-step">
            <div className="step-icon"><Coins size={22} /></div>
            <div className="step-text">
              <span className="step-label">Pay</span>
              <span className="step-desc">Miss → you pay the escrow. Hit → defender pays you</span>
            </div>
          </div>

          <div className="intro-step">
            <div className="step-icon"><Trophy size={22} /></div>
            <div className="step-text">
              <span className="step-label">Win</span>
              <span className="step-desc">Destroy all enemy sheep to claim 80% of the pot</span>
            </div>
          </div>
        </div>

        {/* Stakes callout */}
        <div className="intro-stakes">
          <div className="stakes-row">
            <span className="stakes-item"><Wind size={14} /> 1¢ – 100¢ stakes</span>
            <span className="stakes-divider">·</span>
            <span className="stakes-item"><Lock size={14} /> Server-held escrow</span>
            <span className="stakes-divider">·</span>
            <span className="stakes-item"><Zap size={14} /> Instant BSV settlement</span>
          </div>
        </div>

        {/* CTA */}
        <button className="intro-cta" onClick={onGetStarted}>
          <span>Get Started</span>
          <ChevronRight size={20} />
        </button>

        <p className="intro-footnote">
          Free to create a wallet. Fund it with BSV to start playing.
        </p>
      </div>
    </div>
  );
}