import { getDb } from '../db/index.js';
import { renderGate } from './segments.js';

const gate = (key, label, status, detail, action = null) => ({ key, label, status, detail, action });

/**
 * One truthful answer to "may this production render?"
 *
 * Individual screens used to each know one small prerequisite. That made the
 * render button the first place a person discovered missing work. This reads
 * the durable approvals together and returns every blocker at once.
 */
export function productionLock(productionId) {
  const db = getDb();
  const production = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  if (!production) return null;

  const research = db
    .prepare('SELECT * FROM website_research WHERE production_id = ? ORDER BY id')
    .all(productionId);
  const accepted = db
    .prepare("SELECT * FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC LIMIT 1")
    .get(productionId);
  const segments = db.prepare('SELECT * FROM segments WHERE production_id = ? ORDER BY position').all(productionId);
  const voice = renderGate(productionId);
  const unresolved = db
    .prepare("SELECT COUNT(*) n FROM decisions WHERE production_id = ? AND kind = 'warning' AND resolution IS NULL")
    .get(productionId).n;

  const castIds = [...new Set(segments.map((s) => s.presenter_id).filter(Boolean))];
  const appearanceMissing = [];
  for (const presenterId of castIds) {
    const presenter = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
    if (!presenter || presenter.kind === 'avatar') continue;
    const proof = db
      .prepare(
        `SELECT * FROM appearance_proofs
          WHERE production_id = ? AND presenter_id = ? AND status = 'approved'
          ORDER BY id DESC LIMIT 1`
      )
      .get(productionId, presenterId);
    if (!proof) appearanceMissing.push(presenter.name);
  }

  const researchFailed = research.filter((r) => r.status === 'failed');
  const researchUnreviewed = research.filter((r) => r.status === 'complete' && !r.reviewed);
  const gates = [];

  if (!research.length) {
    gates.push(gate('research', 'Source research', 'pass', 'No website source is attached; nothing to review.', 'Plan · Sources'));
  } else if (researchFailed.length) {
    gates.push(gate('research', 'Source research', 'block', `${researchFailed.length} website source${researchFailed.length === 1 ? '' : 's'} could not be researched.`, 'Plan · Sources'));
  } else if (researchUnreviewed.length) {
    gates.push(gate('research', 'Source research', 'block', 'The website evidence has not been reviewed by you.', 'Plan · Sources'));
  } else {
    gates.push(gate('research', 'Source research', 'pass', 'Website evidence reviewed.', 'Plan · Sources'));
  }

  gates.push(gate(
    'outline', 'Outline', production.outline_approved ? 'pass' : 'block',
    production.outline_approved ? 'Approved.' : 'Approve the outline.', 'Plan · Outline'
  ));
  gates.push(gate(
    'scenes', 'Scene plan', production.scenes_approved ? 'pass' : 'block',
    production.scenes_approved ? 'Approved.' : 'Develop and approve the scene plan.', 'Plan · Scenes'
  ));
  gates.push(gate(
    'script', 'Script', accepted && !accepted.stale ? 'pass' : 'block',
    !accepted ? 'Accept a script version.' : accepted.stale ? accepted.stale_reason || 'The accepted script is stale.' : `Version ${accepted.version} accepted.`,
    'Script'
  ));
  gates.push(gate(
    'segments', 'Production segments', segments.length ? 'pass' : 'block',
    segments.length ? `${segments.length} production line${segments.length === 1 ? '' : 's'} built.` : 'Build segments from the accepted script.',
    'Segments'
  ));
  gates.push(gate(
    'voice', 'Shipping voice', voice.total > 0 && voice.ready ? 'pass' : 'block',
    !voice.total
      ? 'No production segments exist yet.'
      : voice.ready
        ? `All ${voice.total} takes were auditioned and approved.`
        : `${voice.blocked.length} of ${voice.total} line${voice.total === 1 ? '' : 's'} still need casting, an audition or approval.`,
    'Segments'
  ));
  gates.push(gate(
    'appearance', 'Appearance', !appearanceMissing.length && segments.length ? 'pass' : 'block',
    !segments.length
      ? 'Build and cast the production before approving appearance.'
      : appearanceMissing.length
        ? `Approve an appearance proof for ${appearanceMissing.join(', ')}.`
        : 'Every personal or fictional performer has an approved proof; stock avatars use their selected provider appearance.',
    'Plan · People & look'
  ));
  gates.push(gate(
    'decisions', 'Open decisions', unresolved ? 'warn' : 'pass',
    unresolved ? `${unresolved} planning decision${unresolved === 1 ? '' : 's'} remain open.` : 'No open planning decisions.',
    'Plan · Decisions'
  ));

  const blockers = gates.filter((g) => g.status === 'block');
  return {
    ready: blockers.length === 0,
    gates,
    blockers,
    warnings: gates.filter((g) => g.status === 'warn'),
  };
}
