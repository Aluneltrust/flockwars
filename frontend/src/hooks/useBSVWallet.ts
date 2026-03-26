// ============================================================================
// USE WALLET HOOK
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { PrivateKey } from '@bsv/sdk';
import { BSV_NETWORK } from '../constants/gameConstants';
import { fetchBalance } from '../services/BSVWalletService';

export interface WalletState {
  privateKey: PrivateKey | null;
  address: string;
  balance: number;
  isLoading: boolean;
}

export const useWallet = () => {
  const [privateKey, setPrivateKey] = useState<PrivateKey | null>(null);
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Load wallet from localStorage on mount
  useEffect(() => {
    const savedWif = localStorage.getItem('herdswacker_wif');
    if (savedWif) {
      try {
        const pk = PrivateKey.fromWif(savedWif);
        setPrivateKey(pk);
        const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
        setAddress(addr);
        refreshBalance(addr);
      } catch (e) {
        console.error('Failed to load wallet:', e);
      }
    }
  }, []);

  const refreshBalance = useCallback(async (addr?: string) => {
    const targetAddr = addr || address;
    if (!targetAddr) return;

    setIsLoading(true);
    try {
      const bal = await fetchBalance(targetAddr);
      setBalance(bal);
    } catch (err) {
      console.warn('Balance fetch failed:', err);
    }
    setIsLoading(false);
  }, [address]);

  const createWallet = useCallback(async () => {
    setIsLoading(true);
    try {
      const pk = PrivateKey.fromRandom();
      const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      
      setPrivateKey(pk);
      setAddress(addr);
      localStorage.setItem('herdswacker_wif', pk.toWif());
      
      await refreshBalance(addr);
      return { success: true, address: addr };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  }, [refreshBalance]);

  const importWallet = useCallback(async (wif: string) => {
    setIsLoading(true);
    try {
      const pk = PrivateKey.fromWif(wif);
      const addr = pk.toPublicKey().toAddress(BSV_NETWORK === 'main' ? 'mainnet' : 'testnet');
      
      setPrivateKey(pk);
      setAddress(addr);
      localStorage.setItem('herdswacker_wif', wif);
      
      await refreshBalance(addr);
      return { success: true, address: addr };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  }, [refreshBalance]);

  const exportWif = useCallback(() => {
    return privateKey?.toWif() || null;
  }, [privateKey]);

  return {
    privateKey,
    address,
    balance,
    isLoading,
    createWallet,
    importWallet,
    refreshBalance,
    exportWif,
  };
};