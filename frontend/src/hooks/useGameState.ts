// ============================================================================
// USE GAME STATE — Board state, herd placement, shot handling
// ============================================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  MAX_SHEEP,
  CELL_EMPTY,
  CELL_SHEEP,
  CELL_HIT,
  CELL_MISS,
  createEmptyArena,
  autoPlaceHerds,
  HERD_SHAPES,
  getValidPlacementCells,
} from '../constants';

export function useGameState(
  gamePhase: string,
  setMessage: (msg: string) => void,
) {
  // Board state
  const [playerArena, setPlayerArena] = useState<Record<string, number>>(createEmptyArena());
  const [opponentArena, setOpponentArena] = useState<Record<string, number>>(createEmptyArena());
  const [playerShots, setPlayerShots] = useState<Record<string, number>>(createEmptyArena());
  const [opponentShots, setOpponentShots] = useState<Record<string, number>>(createEmptyArena());
  const [sheepPlaced, setSheepPlaced] = useState(0);

  // Herd placement state
  const [currentHerdIndex, setCurrentHerdIndex] = useState(0);
  const [currentHerdCells, setCurrentHerdCells] = useState<[number, number][]>([]);
  const [placedHerds, setPlacedHerds] = useState<boolean[]>([false, false, false, false]);
  const [herdCellMap, setHerdCellMap] = useState<Record<string, number>>({});
  const [validCells, setValidCells] = useState<Set<string>>(new Set());

  // Transactions
  const [transactions, setTransactions] = useState<any[]>([]);

  // Update valid cells whenever placement state changes
  useEffect(() => {
    if (currentHerdIndex > 3 || placedHerds[currentHerdIndex]) {
      setValidCells(new Set());
      return;
    }
    const herd = HERD_SHAPES[currentHerdIndex];
    if (currentHerdCells.length >= herd.size) {
      setValidCells(new Set());
      return;
    }
    const cells = getValidPlacementCells(currentHerdCells, playerArena);
    setValidCells(new Set(cells.map(([r, c]) => `${r}-${c}`)));
  }, [currentHerdIndex, currentHerdCells, playerArena, placedHerds]);

  // ==========================================================================
  // HERD PLACEMENT
  // ==========================================================================

  const handlePlayerCellClick = useCallback((row: number, col: number) => {
    if (gamePhase !== 'setup') return;

    const key = `${row}-${col}`;
    const current = playerArena[key] || CELL_EMPTY;

    // --- UNDO: clicking an existing sheep removes it ---
    if (current === CELL_SHEEP) {
      const cellHerdIndex = herdCellMap[key];

      if (cellHerdIndex !== undefined && placedHerds[cellHerdIndex]) {
        const cellsToRemove = Object.entries(herdCellMap)
          .filter(([_, idx]) => idx === cellHerdIndex)
          .map(([k]) => k);

        setPlayerArena(prev => {
          const newArena = { ...prev };
          cellsToRemove.forEach(k => delete newArena[k]);
          return newArena;
        });
        setHerdCellMap(prev => {
          const newMap = { ...prev };
          cellsToRemove.forEach(k => delete newMap[k]);
          return newMap;
        });
        setSheepPlaced(prev => prev - cellsToRemove.length);
        setPlacedHerds(prev => {
          const newPlaced = [...prev];
          newPlaced[cellHerdIndex] = false;
          return newPlaced;
        });
        setCurrentHerdIndex(cellHerdIndex);
        setCurrentHerdCells([]);
        setMessage(`${HERD_SHAPES[cellHerdIndex].name} removed. Place it again!`);
        return;
      }

      if (cellHerdIndex === currentHerdIndex) {
        const lastCell = currentHerdCells[currentHerdCells.length - 1];
        if (lastCell && `${lastCell[0]}-${lastCell[1]}` === key) {
          setPlayerArena(prev => {
            const newArena = { ...prev };
            delete newArena[key];
            return newArena;
          });
          setHerdCellMap(prev => {
            const newMap = { ...prev };
            delete newMap[key];
            return newMap;
          });
          setCurrentHerdCells(prev => prev.slice(0, -1));
          setSheepPlaced(prev => prev - 1);
          setMessage(`Undo! ${HERD_SHAPES[currentHerdIndex].name}: ${currentHerdCells.length - 1}/${HERD_SHAPES[currentHerdIndex].size}`);
        } else {
          setMessage('Can only undo the last placed sheep!');
        }
        return;
      }

      return;
    }

    // --- PLACE: add a sheep to the current herd ---
    let activeHerd = currentHerdIndex;
    if (placedHerds[activeHerd]) {
      const next = placedHerds.findIndex((placed, i) => i > activeHerd && !placed);
      if (next === -1) {
        const any = placedHerds.findIndex(placed => !placed);
        if (any === -1) {
          setMessage('All herds placed!');
          return;
        }
        activeHerd = any;
      } else {
        activeHerd = next;
      }
      setCurrentHerdIndex(activeHerd);
      setCurrentHerdCells([]);
    }

    const herd = HERD_SHAPES[activeHerd];
    const liveHerdCells = (activeHerd === currentHerdIndex) ? currentHerdCells : [];
    const liveValidCells = getValidPlacementCells(liveHerdCells, playerArena);
    const liveValidSet = new Set(liveValidCells.map(([r, c]) => `${r}-${c}`));

    if (!liveValidSet.has(key)) {
      if (liveHerdCells.length === 0) {
        setMessage('Cell is occupied!');
      } else {
        setMessage(`Must place adjacent to your ${herd.name}!`);
      }
      return;
    }

    const newHerdCells: [number, number][] = [...liveHerdCells, [row, col]];

    setPlayerArena(prev => ({ ...prev, [key]: CELL_SHEEP }));
    setHerdCellMap(prev => ({ ...prev, [key]: activeHerd }));
    setCurrentHerdCells(newHerdCells);
    setSheepPlaced(prev => prev + 1);

    // Flash the cell
    if (newHerdCells.length === 1) {
      const cellEl = document.querySelector(`[data-cell="${key}"]`);
      if (cellEl) {
        cellEl.classList.add('herd-start');
        setTimeout(() => cellEl.classList.remove('herd-start'), 600);
      }
    }

    if (newHerdCells.length >= herd.size) {
      setPlacedHerds(prev => {
        const newPlaced = [...prev];
        newPlaced[activeHerd] = true;
        return newPlaced;
      });

      const nextUnplaced = placedHerds.findIndex((placed, i) => i !== activeHerd && !placed);
      if (nextUnplaced !== -1) {
        setCurrentHerdIndex(nextUnplaced);
        setCurrentHerdCells([]);
        setMessage(`${herd.name} done! Now place: ${HERD_SHAPES[nextUnplaced].name} (${HERD_SHAPES[nextUnplaced].size} sheep)`);
      } else {
        setCurrentHerdCells([]);
        setMessage('All herds placed! Hit Ready when you\'re set!');
      }
    } else {
      const updatedArena = { ...playerArena, [key]: CELL_SHEEP };
      const nextValid = getValidPlacementCells(newHerdCells, updatedArena);

      if (nextValid.length === 0) {
        setPlayerArena(prev => {
          const newArena = { ...prev };
          delete newArena[key];
          return newArena;
        });
        setHerdCellMap(prev => {
          const newMap = { ...prev };
          delete newMap[key];
          return newMap;
        });
        setSheepPlaced(prev => prev - 1);
        setCurrentHerdCells(prev => prev.slice(0, -1));
        setMessage(`Dead end! Can't extend ${herd.name} from there. Try a different cell.`);
      } else {
        const remaining = herd.size - newHerdCells.length;
        setMessage(`${herd.name}: ${newHerdCells.length}/${herd.size} — ${remaining} more (must be adjacent)`);
      }
    }
  }, [gamePhase, playerArena, herdCellMap, placedHerds, currentHerdIndex, currentHerdCells, setMessage]);

  const autoPlaceSheep = useCallback(() => {
    const newArena = autoPlaceHerds();
    const sheepCount = Object.values(newArena).filter(v => v === CELL_SHEEP).length;

    setPlayerArena(newArena);
    setSheepPlaced(sheepCount);
    setPlacedHerds([true, true, true, true]);
    setCurrentHerdIndex(0);
    setCurrentHerdCells([]);
    const newMap: Record<string, number> = {};
    Object.keys(newArena).forEach((key, i) => {
      if (newArena[key] === CELL_SHEEP) {
        if (i < 1) newMap[key] = 0;
        else if (i < 3) newMap[key] = 1;
        else if (i < 6) newMap[key] = 2;
        else newMap[key] = 3;
      }
    });
    setHerdCellMap(newMap);
  }, []);

  const clearSheep = useCallback(() => {
    setPlayerArena(createEmptyArena());
    setSheepPlaced(0);
    setPlacedHerds([false, false, false, false]);
    setCurrentHerdIndex(0);
    setCurrentHerdCells([]);
    setHerdCellMap({});
  }, []);

  const addTransaction = useCallback((amount: number, description: string, txid: string | null = null) => {
    setTransactions(prev => [{ amount, description, txid }, ...prev].slice(0, 10));
  }, []);

  const resetBoards = useCallback(() => {
    setPlayerArena(createEmptyArena());
    setOpponentArena(createEmptyArena());
    setPlayerShots(createEmptyArena());
    setOpponentShots(createEmptyArena());
    setSheepPlaced(0);
    setCurrentHerdIndex(0);
    setCurrentHerdCells([]);
    setPlacedHerds([false, false, false, false]);
    setHerdCellMap({});
  }, []);

  // Restore boards from reconnect data
  const restoreFromReconnect = useCallback((gameState: any) => {
    if (gameState.shotsReceived) {
      const newOpponentShots = createEmptyArena();
      for (const [key, result] of Object.entries(gameState.shotsReceived)) {
        newOpponentShots[key] = result === 'hit' ? CELL_HIT : CELL_MISS;
      }
      setOpponentShots(newOpponentShots);
    }
    if (gameState.shotsFiredResults) {
      const newPlayerShots = createEmptyArena();
      const newOpponentArena = createEmptyArena();
      for (const [key, result] of Object.entries(gameState.shotsFiredResults)) {
        newPlayerShots[key] = result === 'hit' ? CELL_HIT : CELL_MISS;
        if (result === 'hit') newOpponentArena[key] = CELL_HIT;
      }
      setPlayerShots(newPlayerShots);
      setOpponentArena(newOpponentArena);
    }
  }, []);

  return {
    // Board state
    playerArena,
    opponentArena,
    playerShots,
    opponentShots,
    sheepPlaced,
    validCells,
    transactions,

    // Herd placement
    currentHerdIndex,
    currentHerdCells,
    placedHerds,
    herdCellMap,

    // Setters (for shot callbacks)
    setPlayerArena,
    setOpponentArena,
    setPlayerShots,
    setOpponentShots,
    setTransactions,

    // Actions
    handlePlayerCellClick,
    autoPlaceSheep,
    clearSheep,
    addTransaction,
    resetBoards,
    restoreFromReconnect,
  };
}