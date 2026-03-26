// ============================================================================
// WALLET PAGE COMPONENT
// ============================================================================

import React, { useState, useEffect } from 'react';
import { PrivateKey } from '@bsv/sdk';

// Constants & Services
import { BSV_NETWORK } from '../constants';
import { bsvWalletService, fetchBalance, bsvPriceService } from '../services';

// Styles - uses index.css which imports WalletStyles.css
import '../styles/index.css';

interface WalletPageProps {
  onBack: () => void;
  walletPrivateKey: PrivateKey | null;
  walletAddress: string;
}

interface Transaction {
  txid: string;
  height: number;
  time?: number;
  net: number;
  type: 'receive' | 'send';
}

export default function WalletPage({ onBack, walletPrivateKey, walletAddress: propAddress }: WalletPageProps) {
  // ============================================================================
  // STATE
  // ============================================================================
  
  // Wallet state — initialized from props (already unlocked by game component)
  const [privateKey, setPrivateKey] = useState<PrivateKey | null>(walletPrivateKey);
  const [walletAddress, setWalletAddress] = useState(propAddress);
  const [balance, setBalance] = useState(0);
  
  // UI state
  const [activeTab, setActiveTab] = useState<'receive' | 'send' | 'history'>('receive');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error'>('info');
  
  // Send form
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  
  // Transaction history
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  // QR Code state
  const [showQR, setShowQR] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  
  // Price
  const [bsvPrice, setBsvPrice] = useState(50);

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  useEffect(() => {
    loadWallet();
    bsvPriceService.updatePrice().then(setBsvPrice);
  }, []);

  const loadWallet = async () => {
    const savedWif = localStorage.getItem('herdswacker_wif');
    if (savedWif) {
      try {
        const pk = PrivateKey.fromWif(savedWif);
        setPrivateKey(pk);
        const address = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
        setWalletAddress(address);
        await refreshBalance(address);
        fetchTransactionHistory(address);
      } catch (e) {
        showMessage('Failed to load wallet', 'error');
      }
    }
  };

  // ============================================================================
  // BALANCE & REFRESH
  // ============================================================================

  const refreshBalance = async (address?: string) => {
    const addr = address || walletAddress;
    if (!addr) return;

    setIsLoading(true);
    try {
      const bal = await fetchBalance(addr);
      setBalance(bal);
    } catch (err) {
      console.warn('Balance fetch failed:', err);
    }
    setIsLoading(false);
  };

  // ============================================================================
  // TRANSACTION HISTORY
  // ============================================================================

  const fetchTransactionHistory = async (address: string) => {
    try {
      const response = await fetch(
        `https://api.whatsonchain.com/v1/bsv/${BSV_NETWORK}/address/${address}/history`
      );
      
      if (response.ok) {
        const data = await response.json();
        const recentTxs = data.slice(0, 20);
        
        const txDetails = await Promise.all(
          recentTxs.map(async (tx: any) => {
            try {
              const txResponse = await fetch(
                `https://api.whatsonchain.com/v1/bsv/${BSV_NETWORK}/tx/hash/${tx.tx_hash}`
              );
              if (txResponse.ok) {
                const txData = await txResponse.json();
                return {
                  txid: tx.tx_hash,
                  height: tx.height,
                  time: txData.time,
                  ...calculateTxAmount(txData, address),
                };
              }
            } catch {
              return null;
            }
          })
        );
        
        setTransactions(txDetails.filter((t): t is Transaction => t !== null));
      }
    } catch (err) {
      console.warn('History fetch failed:', err);
    }
  };

  const calculateTxAmount = (tx: any, myAddress: string) => {
    let received = 0;
    let sent = 0;
    
    tx.vout?.forEach((out: any) => {
      if (out.scriptPubKey?.addresses?.includes(myAddress)) {
        received += Math.round((out.value || 0) * 100000000);
      }
    });
    
    tx.vin?.forEach((inp: any) => {
      if (inp.addr === myAddress) {
        sent += inp.valueSat || 0;
      }
    });
    
    const net = received - sent;
    return {
      net,
      type: net >= 0 ? 'receive' as const : 'send' as const,
    };
  };

  // ============================================================================
  // SEND TRANSACTION
  // ============================================================================

  const sendTransaction = async () => {
    if (!privateKey) {
      showMessage('No wallet loaded', 'error');
      return;
    }

    if (!sendAddress || !sendAmount) {
      showMessage('Please enter address and amount', 'error');
      return;
    }

    const amountSats = parseInt(sendAmount);
    if (isNaN(amountSats) || amountSats < 546) {
      showMessage('Minimum amount is 546 sats (dust limit)', 'error');
      return;
    }

    if (amountSats > balance - 50) {
      showMessage('Insufficient balance (need extra for fee)', 'error');
      return;
    }

    // Basic address validation
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(sendAddress)) {
      showMessage('Invalid BSV address format', 'error');
      return;
    }

    setIsLoading(true);
    showMessage('Building transaction...', 'info');

    try {
      // Connect wallet service with our key
      await bsvWalletService.connect(privateKey.toWif());
      
      // Send payment
      const result = await bsvWalletService.sendPayment(sendAddress, amountSats, 'Herdswacker wallet transfer');

      if (result.success) {
        showMessage(`✅ Sent! TX: ${result.txid?.substring(0, 16)}...`, 'success');
        setSendAddress('');
        setSendAmount('');
        
        // Refresh after delay
        setTimeout(() => {
          refreshBalance();
          fetchTransactionHistory(walletAddress);
        }, 2000);
      } else {
        showMessage(`❌ Failed: ${result.error}`, 'error');
      }
    } catch (error: any) {
      showMessage(`❌ Error: ${error.message}`, 'error');
    }

    setIsLoading(false);
  };

  // ============================================================================
  // HELPERS
  // ============================================================================

  const showMessage = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setMessage(text);
    setMessageType(type);
    
    // Auto-clear success messages
    if (type === 'success') {
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showMessage('📋 Copied to clipboard!', 'success');
  };

  const formatSats = (sats: number): string => {
    return sats.toLocaleString() + ' sats';
  };

  const formatBSV = (sats: number): string => {
    return (sats / 100000000).toFixed(8) + ' BSV';
  };

  const formatUSD = (sats: number): string => {
    const bsv = sats / 100000000;
    const usd = bsv * bsvPrice;
    return '$' + usd.toFixed(2);
  };

  const formatDate = (timestamp?: number): string => {
    if (!timestamp) return 'Pending...';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const exportPrivateKey = () => {
    if (privateKey) {
      const wif = privateKey.toWif();
      copyToClipboard(wif);
      showMessage('🔑 Private key (WIF) copied! Keep it safe!', 'success');
    }
  };

  const getExplorerUrl = (txid: string): string => {
    return BSV_NETWORK === 'main' 
      ? `https://whatsonchain.com/tx/${txid}`
      : `https://test.whatsonchain.com/tx/${txid}`;
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="wallet-page">
      <img
        src="/images/wallet-bg.png"
        alt=""
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
      <div className="wallet-container">
        {/* Header */}
        <div className="wallet-header">
          <button className="back-button" onClick={onBack}>
             Back to Game
          </button>
          <h1>💰 Wallet</h1>
        </div>

        {/* Balance Card */}
        <div className="balance-card">
          <div className="balance-label">Balance</div>
          <div className="balance-amount">{formatSats(balance)}</div>
          <div className="balance-secondary">
            <span className="balance-bsv">{formatBSV(balance)}</span>
            <span className="balance-usd">{formatUSD(balance)}</span>
          </div>
          <button 
            className="refresh-btn" 
            onClick={() => refreshBalance()}
            disabled={isLoading}
          >
            {isLoading ? '⏳' : '↻'} Refresh
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`wallet-message ${messageType}`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="wallet-tabs">
          <button 
            className={`tab ${activeTab === 'receive' ? 'active' : ''}`}
            onClick={() => setActiveTab('receive')}
          >
             Receive
          </button>
          <button 
            className={`tab ${activeTab === 'send' ? 'active' : ''}`}
            onClick={() => setActiveTab('send')}
          >
             Send
          </button>
          <button 
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => { setActiveTab('history'); fetchTransactionHistory(walletAddress); }}
          >
             History
          </button>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {/* RECEIVE TAB */}
          {activeTab === 'receive' && (
            <div className="receive-tab">
              <div className="address-section">
                <div className="address-label">Your BSV Address</div>
                <div 
                  className="address-box"
                  onClick={() => copyToClipboard(walletAddress)}
                  title="Click to copy"
                >
                  <span className="address-text">{walletAddress}</span>
                  <span className="copy-icon">📋</span>
                </div>
                <p className="address-hint">Click address to copy • Send BSV here to fund your game wallet</p>
              </div>
              
              <div className="qr-section">
                <button 
                  className="btn btn-secondary"
                  onClick={() => setShowQR(!showQR)}
                >
                  {showQR ? 'Hide QR' : 'Show QR Code'}
                </button>
                
                {showQR && (
                  <div className="qr-code">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${walletAddress}`}
                      alt="QR Code"
                    />
                  </div>
                )}
              </div>

              <div className="backup-section">
                <div className="backup-title">🔐 Backup Your Wallet</div>
                <button 
                  className="btn btn-warning"
                  onClick={exportPrivateKey}
                >
                   Export Private Key (WIF)
                </button>
                <p className="backup-warning">
                  ⚠️ Never share your private key! Store it safely to recover your wallet.
                </p>
              </div>
            </div>
          )}

          {/* SEND TAB */}
          {activeTab === 'send' && (
            <div className="send-tab">
              <div className="form-group">
                <label>Recipient Address</label>
                <input
                  type="text"
                  placeholder="1ABC... or 3XYZ..."
                  value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)}
                  className={sendAddress && !/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(sendAddress) ? 'invalid' : ''}
                />
              </div>

              <div className="form-group">
                <label>Amount (satoshis)</label>
                <input
                  type="number"
                  placeholder="10000"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  min="546"
                  max={balance - 50}
                />
                <div className="amount-helpers">
                  <button onClick={() => setSendAmount('10000')}>10k</button>
                  <button onClick={() => setSendAmount('100000')}>100k</button>
                  <button onClick={() => setSendAmount('500000')}>500k</button>
                  <button onClick={() => setSendAmount(String(Math.max(0, balance - 100)))}>Max</button>
                </div>
              </div>

              {sendAmount && parseInt(sendAmount) > 0 && (
                <div className="send-preview">
                  <div className="preview-row">
                    <span>Sending:</span>
                    <span className="preview-value">{formatSats(parseInt(sendAmount) || 0)}</span>
                  </div>
                  <div className="preview-row">
                    <span>Network Fee:</span>
                    <span className="preview-value">~50 sats</span>
                  </div>
                  <div className="preview-row total">
                    <span>Total:</span>
                    <span className="preview-value">{formatSats((parseInt(sendAmount) || 0) + 50)}</span>
                  </div>
                  <div className="preview-row usd">
                    <span>≈</span>
                    <span>{formatUSD((parseInt(sendAmount) || 0) + 50)}</span>
                  </div>
                </div>
              )}

              <button 
                className="btn btn-primary send-btn"
                onClick={sendTransaction}
                disabled={isLoading || !sendAddress || !sendAmount || parseInt(sendAmount) < 546}
              >
                {isLoading ? '⏳ Sending...' : '📤 Send BSV'}
              </button>

              {parseInt(sendAmount) > balance - 50 && (
                <div className="insufficient-warning">
                  ⚠️ Insufficient balance
                </div>
              )}
            </div>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
            <div className="history-tab">
              {transactions.length === 0 ? (
                <div className="no-history">
                  <div className="no-history-icon">📭</div>
                  <div>No transactions yet</div>
                  <div className="no-history-hint">Fund your wallet to get started!</div>
                </div>
              ) : (
                <div className="tx-list">
                  {transactions.map((tx, i) => (
                    <div key={i} className={`tx-item ${tx.type}`}>
                      
                      <div className="tx-details">
                        <div className="tx-amount">
                          {tx.net >= 0 ? '+' : ''}{formatSats(tx.net)}
                        </div>
                        <div className="tx-date">{formatDate(tx.time)}</div>
                      </div>
                      <div 
                        className="tx-link"
                        onClick={() => window.open(getExplorerUrl(tx.txid), '_blank')}
                        title="View on explorer"
                      >
                        🔗
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <button 
                className="btn btn-secondary refresh-history-btn"
                onClick={() => fetchTransactionHistory(walletAddress)}
                disabled={isLoading}
              >
                {isLoading ? '⏳' : '↻'} Refresh History
              </button>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="wallet-footer">
          <div className="network-badge">
            {BSV_NETWORK === 'main' ? '🟢 Mainnet' : '🟡 Testnet'}
          </div>
          <div className="price-info">
            BSV: ${bsvPrice.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}