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
// Every row in the list. Hover/selected backgrounds are doubled-class (`&&`) so
// they still beat the generic `button:hover:not(:disabled)` rule, as the old
// `.ppicklist button:hover` did by coming later at equal specificity.
const ROW = 'block w-full text-left [border:0] cursor-pointer p-[5px_7px] rounded-sm';
const rowState = (cur) => (cur
  ? ' bg-accent-soft [&&:hover]:bg-accent-soft'
  : ' bg-transparent [&&:hover]:bg-canvas');

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
    <div className={'relative min-w-0' + (current ? ' set' : '')}>
      <button
        type="button"
        className={'flex items-center justify-between gap-[5px] w-full p-[4px_7px] border border-solid border-line rounded-sm bg-surface text-[11.5px] cursor-pointer text-left hover:border-line-2 [&_svg]:shrink-0 [&_svg]:text-faint'
          + (current ? ' text-ink' : ' text-muted')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="overflow-hidden whitespace-nowrap text-ellipsis">{current ? current.name : placeholder}</span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Anchored to the trigger inside a table row / card, above the scrim. */}
          <div className="absolute top-[calc(100%+3px)] left-0 z-[41] min-w-[260px] max-w-[340px] bg-surface border border-solid border-line-2 rounded-sm [box-shadow:var(--shadow-pop)] p-[6px]">
            <input
              className="w-full p-[5px_7px] text-[12px] border border-solid border-line rounded-sm bg-canvas"
              placeholder="Search the cast…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              autoFocus
            />
            {/* Says what was searched, so an empty result is never mistaken
                for an empty roster. */}
            <div className="p-[4px_3px_5px] text-[10.5px] text-faint">{matches.length} of {items.length}</div>
            {/* b/i styles stay descendant selectors (0,1,2) so the casting
                strip's `.castrole b` / `.castrole i` cannot override them. */}
            <div className="flex flex-col max-h-[250px] overflow-y-auto [&_button_b]:block [&_button_b]:text-[12px] [&_button_b]:font-[500] [&_button_b]:text-ink [&_button_i]:block [&_button_i]:not-italic [&_button_i]:text-[10.5px] [&_button_i]:text-faint [&_button_i]:overflow-hidden [&_button_i]:whitespace-nowrap [&_button_i]:text-ellipsis">
              <button
                type="button"
                className={ROW + ' !text-muted ![border-bottom:1px_solid_var(--line)] !rounded-none text-[11.5px]'
                  + (value ? '' : ' cur') + rowState(!value)}
                onClick={() => { onChange(null); setOpen(false); }}
              >
                {clearLabel}
              </button>
              {matches.length === 0 && <p className="muted m-0 p-[5px_3px] text-[11.5px]">Nobody matches.</p>}
              {matches.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={ROW + (p.id === value ? ' cur' : '') + rowState(p.id === value)}
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
