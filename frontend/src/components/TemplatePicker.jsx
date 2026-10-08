import React from 'react';
import { useStudio } from '../context/studio-context.jsx';

/** Purpose labels, in the order a track is usually run. */
const PURPOSE_LABEL = {
  promotion: 'Promotion — reach and awareness',
  gtm: 'Go to market — buyers deciding now',
  investor: 'Investor — capital and board',
  training: 'Training — learning to use it',
  recruiting: 'Recruiting — people who might join',
  internal: 'Internal — the team',
};
const PURPOSE_ORDER = ['promotion', 'gtm', 'investor', 'training', 'recruiting', 'internal'];

// Inside New production (`group/tpm` on its modal) the picker gets the desktop
// canvas: taller, and each purpose group laid out as two columns.
const ROW = 'block w-full text-left border border-solid rounded-sm cursor-pointer p-[6px_8px] hover:bg-surface group-[]/tpm:min-h-[50px]';
const ROW_ON = 'bg-surface border-accent';
const ROW_OFF = 'bg-transparent border-transparent';
const ROW_NAME = 'block text-[13px] font-[560] text-ink';
const ROW_FACTS = 'flex flex-wrap gap-[4px_10px] mt-[1px]';
const FACT = 'not-italic text-[11px] text-faint';
const MODE = 'not-italic text-[9.5px] tracking-[.04em] uppercase p-[0_5px] rounded-[999px] border border-solid';

/**
 * Choose a template.
 *
 * This was a <select> whose options read "Name · mode · runtime" — three
 * facts crushed into one string, which is unreadable at six templates and
 * worse at seventeen. They are separate fields, so they are laid out as
 * separate fields, grouped by what the track is FOR.
 *
 * The program bubble decides which group comes first: making a comedy video
 * should not open on a podcast template. Nothing is hidden — a licence that
 * grants both programs can use either, and saying so beats silently filtering.
 */
export default function TemplatePicker({ templates, value, allowBlank, onChange }) {
  const { scopeMode } = useStudio();

  const inScope = (t) => !scopeMode || t.mode === scopeMode || t.mode === 'both';
  const ordered = [...templates].sort((a, b) => {
    if (inScope(a) !== inScope(b)) return inScope(a) ? -1 : 1;
    const pa = PURPOSE_ORDER.indexOf(a.purpose);
    const pb = PURPOSE_ORDER.indexOf(b.purpose);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });

  const groups = [];
  for (const t of ordered) {
    const key = `${inScope(t) ? 'in' : 'out'}:${t.purpose ?? 'other'}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, purpose: t.purpose, inScope: inScope(t), items: [] }));
    g.items.push(t);
  }

  return (
    // Scrolls rather than growing the modal past the window.
    <div className="max-h-[260px] overflow-y-auto border border-solid border-line rounded-sm bg-canvas p-[4px] group-[]/tpm:max-h-[min(340px,42vh)] group-[]/tpm:p-[6px]">
      {allowBlank && (
        <button
          type="button"
          className={`${ROW} blank ${value === '' ? `on ${ROW_ON}` : ROW_OFF}`}
          onClick={() => onChange('')}
        >
          <b className={ROW_NAME}>Blank</b>
          <span className={`${ROW_FACTS} ${FACT}`}>No template — an empty brief and outline</span>
        </button>
      )}

      {groups.map((g) => (
        <div
          className="[&+&]:mt-[6px] group-[]/tpm:grid group-[]/tpm:grid-cols-[repeat(2,minmax(0,1fr))] group-[]/tpm:gap-[4px_6px] group-[]/tpm:[align-content:start] group-[]/tpm:[&+&]:mt-[8px] group-[]/tpm:lte720:grid-cols-[1fr]"
          key={g.key}
        >
          <small
            className={'block p-[6px_7px_4px] text-[10px] tracking-[.04em] uppercase text-faint group-[]/tpm:[grid-column:1/-1]'
              + (g.inScope ? '' : ' other opacity-[.65]')}
          >
            {PURPOSE_LABEL[g.purpose] ?? 'Other'}
            {!g.inScope && ' · other program'}
          </small>
          {g.items.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`${ROW} ${value === t.id ? `on ${ROW_ON}` : ROW_OFF}`}
              onClick={() => onChange(t.id)}
            >
              <b className={ROW_NAME}>{t.name}</b>
              <span className={ROW_FACTS}>
                <i className={FACT}>{t.format}</i>
                <i className={FACT}>{t.runtime}</i>
                <i className={FACT}>{t.sections} section{t.sections === 1 ? '' : 's'}</i>
                <i className={`${MODE} ${t.mode === 'comedy' ? 'text-accent border-accent-line' : 'text-faint border-line-2'}`}>
                  {t.mode}
                </i>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
