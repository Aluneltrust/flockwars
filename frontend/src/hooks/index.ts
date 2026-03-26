// Hooks barrel export

// useWallet hook (file is useBSVWallet.ts but exports useWallet)
export { useWallet } from './useBSVWallet';
export type { WalletState } from './useBSVWallet';

// useMultiplayer hook
export { useMultiplayer } from './useMultiplayer';
export type { MultiplayerCallbacks, PaymentRequest  } from './useMultiplayer';

