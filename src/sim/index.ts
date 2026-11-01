// Public simulation API (see api.ts). Everything gameplay-relevant lives here, deterministic.
import type { SimApi } from './api';
import { forecast } from './forecast';
import { tileOf, tileX, tileY } from './grid';
import { hashState } from './hash';
import { createRound } from './round';
import { step } from './step';
import { isOpen } from './world';

export { createRound, step, forecast, hashState, tileOf, tileX, tileY, isOpen };
export { tileAt, centerOf, DIRS, DX, DY } from './grid';
export { SPAWNS } from './arena';

// Compile-time check that the exports match the contract.
export const sim: SimApi = { createRound, step, forecast, hashState, tileOf, tileX, tileY, isOpen };
