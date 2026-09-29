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
    <div className="tpick">
      {allowBlank && (
        <button
          type="button"
          className={'tpickrow blank' + (value === '' ? ' on' : '')}
          onClick={() => onChange('')}
        >
          <b>Blank</b>
          <span>No template — an empty brief and outline</span>
        </button>
      )}

      {groups.map((g) => (
        <div className="tpickgroup" key={g.key}>
          <small className={g.inScope ? '' : 'other'}>
            {PURPOSE_LABEL[g.purpose] ?? 'Other'}
            {!g.inScope && ' · other program'}
          </small>
          {g.items.map((t) => (
            <button
              type="button"
              key={t.id}
              className={'tpickrow' + (value === t.id ? ' on' : '')}
              onClick={() => onChange(t.id)}
            >
              <b>{t.name}</b>
              <span>
                <i>{t.format}</i>
                <i>{t.runtime}</i>
                <i>{t.sections} section{t.sections === 1 ? '' : 's'}</i>
                <i className={'tmode ' + t.mode}>{t.mode}</i>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
