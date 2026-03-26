import { useState, useEffect, useRef, useCallback } from "react";

const SACK_COLOR = "#8B6914";
const SACK_DARK = "#6B4F0E";
const SACK_LIGHT = "#A88730";
const ROPE_COLOR = "#5C4033";
const COIN_GOLD = "#F5A623";
const COIN_SHINE = "#FFD700";
const COIN_DARK = "#C4841D";

interface SackPinUnlockProps {
  addressHint: string | null;
  pinInput: string;
  setPinInput: (v: string) => void;
  pinError: string;
  onUnlock: (pin: string) => void;
  onDelete: () => void;
}

export function SackPinUnlock({ addressHint, pinInput, setPinInput, pinError, onUnlock, onDelete }: SackPinUnlockProps) {
  const [pin, setPin] = useState<string[]>(["", "", "", ""]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [shake, setShake] = useState(false);
  const [coinDrops, setCoinDrops] = useState([false, false, false, false]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync shake on external pinError
  useEffect(() => {
    if (pinError) {
      setShake(true);
      const t = setTimeout(() => {
        setShake(false);
        setPin(["", "", "", ""]);
        setCoinDrops([false, false, false, false]);
        setActiveIndex(0);
        setPinInput("");
        setTimeout(() => inputRefs.current[0]?.focus(), 80);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [pinError, setPinInput]);

  const handleDigit = useCallback((index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    setPinInput(newPin.join(""));

    if (value) {
      const newDrops = [...coinDrops];
      newDrops[index] = true;
      setCoinDrops(newDrops);

      if (index < 3) {
        setActiveIndex(index + 1);
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    }
  }, [pin, coinDrops, setPinInput]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      setActiveIndex(index - 1);
      const newPin = [...pin];
      newPin[index - 1] = "";
      setPin(newPin);
      setPinInput(newPin.join(""));
      const newDrops = [...coinDrops];
      newDrops[index - 1] = false;
      setCoinDrops(newDrops);
      setTimeout(() => inputRefs.current[index - 1]?.focus(), 50);
    }
    if (e.key === "Enter" && pin.every(d => d !== "")) {
      onUnlock(pin.join(""));
    }
  }, [pin, coinDrops, setPinInput, onUnlock]);

  const handleUnlock = useCallback(() => {
    const code = pin.join("");
    if (code.length < 4) return;
    onUnlock(code);
  }, [pin, onUnlock]);

  const handleDelete = useCallback(() => {
    if (confirm("This will delete your encrypted wallet. Make sure you have your WIF backed up!")) {
      onDelete();
    }
  }, [onDelete]);

  const allFilled = pin.every(d => d !== "");

  return (
    <div className="connect-screen">
      {/* Main sack container */}
      <div style={{
        position: "relative",
        width: 340,
        animation: shake ? "sackShake 0.5s ease" : undefined,
      }}>
        
        {/* Rope knot at top */}
        <div style={{
          position: "relative",
          zIndex: 3,
          display: "flex",
          justifyContent: "center",
          marginBottom: -18,
        }}>
          <svg width="140" height="50" viewBox="0 0 140 50" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }}>
            <path d="M 30 48 Q 35 30, 50 20 Q 58 15, 70 12" 
              fill="none" stroke={ROPE_COLOR} strokeWidth="6" strokeLinecap="round"/>
            <path d="M 110 48 Q 105 30, 90 20 Q 82 15, 70 12" 
              fill="none" stroke={ROPE_COLOR} strokeWidth="6" strokeLinecap="round"/>
            <circle cx="70" cy="14" r="10" fill={ROPE_COLOR}/>
            <circle cx="70" cy="14" r="7" fill="#7A5A40"/>
            <path d="M 63 10 Q 70 18, 77 10" fill="none" stroke="#4A3020" strokeWidth="2"/>
            <path d="M 63 18 Q 70 10, 77 18" fill="none" stroke="#4A3020" strokeWidth="2"/>
          </svg>
        </div>

        {/* Sack body */}
        <div style={{
          position: "relative",
          background: `
            radial-gradient(ellipse at 30% 20%, ${SACK_LIGHT}40 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, ${SACK_DARK}60 0%, transparent 50%),
            linear-gradient(170deg, ${SACK_COLOR}, ${SACK_DARK})
          `,
          borderRadius: "20px 20px 35px 35px",
          padding: "50px 30px 35px",
          boxShadow: `
            0 15px 40px rgba(0,0,0,0.5),
            inset 0 2px 0 ${SACK_LIGHT}50,
            inset 0 -5px 15px ${SACK_DARK}80
          `,
          border: `2px solid ${SACK_DARK}`,
          overflow: "hidden",
        }}>
          {/* Burlap texture overlay */}
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px),
              repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)
            `,
            borderRadius: "inherit",
            pointerEvents: "none",
          }}/>

          {/* Stitching line at top */}
          <div style={{
            position: "absolute",
            top: 20,
            left: 20,
            right: 20,
            height: 2,
            backgroundImage: `repeating-linear-gradient(90deg, ${ROPE_COLOR} 0px, ${ROPE_COLOR} 8px, transparent 8px, transparent 14px)`,
            opacity: 0.5,
          }}/>

          {/* Stitching line at bottom */}
          <div style={{
            position: "absolute",
            bottom: 15,
            left: 25,
            right: 25,
            height: 2,
            backgroundImage: `repeating-linear-gradient(90deg, ${ROPE_COLOR} 0px, ${ROPE_COLOR} 8px, transparent 8px, transparent 14px)`,
            opacity: 0.4,
          }}/>

          {/* Side stitching left */}
          <div style={{
            position: "absolute",
            top: 30,
            left: 12,
            bottom: 25,
            width: 2,
            backgroundImage: `repeating-linear-gradient(0deg, ${ROPE_COLOR} 0px, ${ROPE_COLOR} 8px, transparent 8px, transparent 14px)`,
            opacity: 0.4,
          }}/>

          {/* Side stitching right */}
          <div style={{
            position: "absolute",
            top: 30,
            right: 12,
            bottom: 25,
            width: 2,
            backgroundImage: `repeating-linear-gradient(0deg, ${ROPE_COLOR} 0px, ${ROPE_COLOR} 8px, transparent 8px, transparent 14px)`,
            opacity: 0.4,
          }}/>

          {/* Small Bitcoin logo stamp on sack */}
          <div style={{
            position: "absolute",
            top: 28,
            right: 24,
            fontSize: 18,
            opacity: 0.15,
            color: SACK_DARK,
            fontWeight: 900,
            transform: "rotate(12deg)",
          }}>₿</div>

          {/* Content */}
          <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
            
            {/* Shield icon */}
            <div style={{ marginBottom: 10 }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={COIN_GOLD} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 2px 8px ${COIN_GOLD}40)` }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <line x1="12" y1="8" x2="12" y2="14"/>
                <line x1="9" y1="11" x2="15" y2="11"/>
              </svg>
            </div>

            {/* Title */}
            <h1 style={{
              fontSize: "1.8rem",
              fontWeight: 800,
              margin: "0 0 4px",
              background: `linear-gradient(135deg, ${COIN_SHINE}, ${COIN_GOLD}, ${COIN_DARK})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: 3,
              textShadow: "none",
              fontFamily: "'Georgia', serif",
            }}>FLOCK WARS</h1>

            <p style={{
              fontSize: "0.8rem",
              color: "#D4C5A0",
              margin: "0 0 16px",
              letterSpacing: 1,
              fontFamily: "'Georgia', serif",
            }}>Enter PIN to unlock your treasure</p>

            {/* Address hint */}
            {addressHint && (
              <div style={{
                display: "inline-block",
                padding: "5px 14px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: 6,
                border: `1px solid ${SACK_DARK}`,
                fontFamily: "'Courier New', monospace",
                fontSize: 11,
                color: "#B8A878",
                marginBottom: 20,
                letterSpacing: 0.5,
              }}>
                {addressHint.slice(0, 8)}...{addressHint.slice(-6)}
              </div>
            )}

            {/* PIN Label */}
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 2,
              color: "#9A8A5A",
              marginBottom: 10,
            }}>Enter PIN</div>

            {/* Coin slots */}
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: 14,
              marginBottom: 20,
            }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{ position: "relative" }}>
                  {/* Coin slot hole */}
                  <div style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: `radial-gradient(circle at 40% 35%, ${SACK_DARK}, #3D2B08)`,
                    border: `2px solid ${SACK_DARK}`,
                    boxShadow: `
                      inset 0 3px 8px rgba(0,0,0,0.6),
                      0 1px 0 ${SACK_LIGHT}40
                    `,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    overflow: "hidden",
                  }}>
                    {/* Coin that drops in */}
                    {coinDrops[i] && (
                      <div style={{
                        position: "absolute",
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: `radial-gradient(circle at 35% 30%, ${COIN_SHINE}, ${COIN_GOLD}, ${COIN_DARK})`,
                        border: `2px solid ${COIN_DARK}`,
                        boxShadow: `
                          inset 0 -2px 4px rgba(0,0,0,0.3),
                          0 2px 8px ${COIN_GOLD}60
                        `,
                        animation: "coinDrop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        <span style={{
                          fontSize: 16,
                          fontWeight: 900,
                          color: COIN_DARK,
                          textShadow: `0 1px 0 ${COIN_SHINE}80`,
                          fontFamily: "serif",
                        }}>₿</span>
                      </div>
                    )}
                    
                    {/* Hidden input */}
                    <input
                      ref={el => { inputRefs.current[i] = el; }}
                      type="password"
                      inputMode="numeric"
                      maxLength={1}
                      value={pin[i]}
                      onChange={e => handleDigit(i, e.target.value.replace(/\D/g, ""))}
                      onKeyDown={e => handleKeyDown(i, e)}
                      onFocus={() => setActiveIndex(i)}
                      autoFocus={i === 0}
                      style={{
                        position: "absolute",
                        width: "100%",
                        height: "100%",
                        opacity: 0,
                        cursor: "pointer",
                        borderRadius: "50%",
                        zIndex: 2,
                      }}
                    />
                  </div>

                  {/* Active indicator */}
                  {activeIndex === i && !pin[i] && (
                    <div style={{
                      position: "absolute",
                      inset: -3,
                      borderRadius: "50%",
                      border: `2px solid ${COIN_GOLD}60`,
                      animation: "slotPulse 1.5s ease-in-out infinite",
                      pointerEvents: "none",
                    }}/>
                  )}
                </div>
              ))}
            </div>

            {/* Unlock button */}
            <button
              onClick={handleUnlock}
              disabled={!allFilled}
              style={{
                width: "100%",
                maxWidth: 220,
                padding: "12px 24px",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: allFilled ? "#1a1406" : "#6A5A3A",
                background: allFilled 
                  ? `linear-gradient(135deg, ${COIN_SHINE}, ${COIN_GOLD})`
                  : `linear-gradient(135deg, ${SACK_DARK}, ${SACK_COLOR}80)`,
                border: `2px solid ${allFilled ? COIN_DARK : SACK_DARK}`,
                borderRadius: 10,
                cursor: allFilled ? "pointer" : "not-allowed",
                transition: "all 0.25s ease",
                boxShadow: allFilled 
                  ? `0 4px 16px ${COIN_GOLD}40, inset 0 1px 0 ${COIN_SHINE}60`
                  : "none",
                fontFamily: "'Georgia', serif",
              }}
            >
              Unlock Sack
            </button>

            {/* Error */}
            {pinError && (
              <div style={{
                marginTop: 12,
                padding: "6px 14px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                borderRadius: 8,
                fontSize: 12,
                color: "#f87171",
                animation: "fadeIn 0.3s ease",
              }}>{pinError}</div>
            )}

            {/* Forgot PIN */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${SACK_DARK}40` }}>
              <button
                onClick={handleDelete}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8A7A5A",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "4px 10px",
                  letterSpacing: 0.3,
                  fontFamily: "'Georgia', serif",
                }}
              >
                Forgot PIN? Reset wallet
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes coinDrop {
          0% { transform: translateY(-30px) scale(0.5); opacity: 0; }
          60% { transform: translateY(3px) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        
        @keyframes slotPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        
        @keyframes sackShake {
          0%, 100% { transform: translateX(0) rotate(0); }
          15% { transform: translateX(-8px) rotate(-2deg); }
          30% { transform: translateX(8px) rotate(2deg); }
          45% { transform: translateX(-6px) rotate(-1.5deg); }
          60% { transform: translateX(6px) rotate(1.5deg); }
          75% { transform: translateX(-3px) rotate(-0.5deg); }
          90% { transform: translateX(3px) rotate(0.5deg); }
        }
        
        @keyframes sheepPeekLeft {
          0%, 100% { transform: translateX(0) translateY(0); }
          30% { transform: translateX(5px) translateY(-3px); }
          60% { transform: translateX(2px) translateY(0); }
        }
        
        @keyframes sheepPeekRight {
          0%, 100% { transform: scaleX(-1) translateX(0) translateY(0); }
          40% { transform: scaleX(-1) translateX(5px) translateY(-4px); }
          70% { transform: scaleX(-1) translateX(2px) translateY(0); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}