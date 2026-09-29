import React, { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Choose who says this line.
 *
 * This was a native <select> over every castable presenter. That was fine at
 * two and unusable the moment the comedy roster was cast from the previous
 * build's avatar allocation — 158 names in an unsearchable list, twice on the
 * Segments page. Making casting work broke the thing that consumes casting.
 *
 * The list is already on the client, so the filter is local: no request, no
 * debounce, no spinner. It matches the name, the tagline and the avatar, so
 * "news" finds Chad Newsworthy and "Aditya" finds whoever wears that face.
 */
export default function PresenterPick({
  value, items, onChange, placeholder = 'presenter…', clearLabel = 'Not cast',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const current = items.find((p) => p.id === value) ?? null;

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((p) =>
      [p.name, p.tagline, p.description, p.avatar?.name, p.voice?.name]
        .some((s) => String(s ?? '').toLowerCase().includes(needle)));
  }, [items, q]);

  return (
    <div className={'ppick' + (current ? ' set' : '')}>
      <button type="button" className="ppickbtn" onClick={() => setOpen((v) => !v)}>
        <span>{current ? current.name : placeholder}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <>
          <div className="ppickscrim" onClick={() => setOpen(false)} />
          <div className="ppickpanel">
            <input
              className="ppicksearch"
              placeholder="Search the cast…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              autoFocus
            />
            {/* Says what was searched, so an empty result is never mistaken
                for an empty roster. */}
            <div className="ppickmeta">{matches.length} of {items.length}</div>
            <div className="ppicklist">
              <button
                type="button"
                className={'ppickclear' + (value ? '' : ' cur')}
                onClick={() => { onChange(null); setOpen(false); }}
              >
                {clearLabel}
              </button>
              {matches.length === 0 && <p className="muted">Nobody matches.</p>}
              {matches.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={p.id === value ? 'cur' : ''}
                  onClick={() => { onChange(p.id); setOpen(false); }}
                >
                  <b>{p.name}</b>
                  {/* The face and voice they will actually speak with — the
                      thing you are really choosing between. */}
                  <i>{[p.avatar?.name, p.voice?.name].filter(Boolean).join(' · ') || p.tagline}</i>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
