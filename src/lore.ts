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

/** What the pieces are carved in: the volcanic stone, or the minerals (phase 9a). */
export type Carving = 'stone' | 'amber' | 'jade';
export const CARVING: Record<Carving, { label: string; sides: Record<Color, string>; line: string }> = {
  stone: { label: 'Stone', sides: { w: 'Tezontle', b: 'Basalt' }, line: 'Chess carved in volcanic stone. Red tezontle against black basalt,' },
  amber: { label: 'Amber', sides: { w: 'Amber', b: 'Obsidian' }, line: 'Chess carved in resin and volcanic glass. Honey amber against smoked obsidian,' },
  jade: { label: 'Jade', sides: { w: 'Jade', b: 'Obsidian' }, line: 'Chess carved in jade and volcanic glass. Green jade against smoked obsidian,' },
};
/** The armies' names in play; they follow the carving. */
export const SIDE: Record<Color, string> = { ...CARVING.stone.sides };
