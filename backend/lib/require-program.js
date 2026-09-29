import { getDb } from '../db/index.js';
import { programsForEntitlement, hasProgram, PROGRAM_INFO } from './programs.js';
import { fail } from '../utils/respond.js';

/**
 * Refuse a route the licence does not include, with 402.
 *
 * The client never decides access, only what it draws — so hiding a segment from
 * the nav is not a gate. Without this, a typed URL or a bookmark kept from before
 * a downgrade renders a page that then fails on its first request.
 */
export function requireProgram(program) {
  return (req, res, next) => {
    const w = getDb().prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
    if (hasProgram(programsForEntitlement(w?.entitlement), program)) return next();
    return fail(
      res, 402, 'PROGRAM_NOT_LICENSED',
      `${PROGRAM_INFO[program]?.label ?? program} is not part of your plan.`
    );
  };
}
