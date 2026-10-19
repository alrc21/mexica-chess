import type { Color, PieceSymbol } from 'chess.js';

/** Which model carries each chess.js piece, and what it is called. */
export const MODEL: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const LORE: Record<PieceSymbol, { name: string; role: string }> = {
  k: { name: 'Huey Tlatoani', role: 'The king' },
  q: { name: 'Cihuacoatl', role: 'The queen' },
  b: { name: 'Cuauhtli', role: 'The bishop · eagle warrior' },
  n: { name: 'Ocelotl', role: 'The knight · jaguar warrior' },
  r: { name: 'Teocalli', role: 'The rook · Templo Mayor' },
  p: { name: 'Macehualli', role: 'The pawn · foot soldier' },
};

export const STONE: Record<Color, 'tezontle' | 'basalt'> = { w: 'tezontle', b: 'basalt' };
export const SIDE: Record<Color, string> = { w: 'Tezontle', b: 'Basalt' };
