import React from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';

const STEP_WORDS = { plan: 'Plan', script: 'Script', voice: 'Voice', render: 'Render', edit: 'Edit', export: 'Finish', publish: 'Post it' };

/**
 * The work in the program you are in, when the page's usual view belongs to
 * the other one: Today and Create in Comedy, where there is no register of
 * IDed business videos. Each piece of work, where it stands, and a way in.
 */
export default function ProgramWork({ go, title, lead }) {
  const { productions, inScope, openProduction, scopeMode } = useStudio();
  // Comedy makes bits; Content makes videos.
  const noun = scopeMode === 'comedy' ? { one: 'bit', many: 'bits' } : { one: 'video', many: 'videos' };
  const mine = (productions ?? []).filter((p) => inScope(p.mode))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const open = async (p) => { await openProduction(p.id); go('Create'); };
  const where = (p) => {
    const steps = p.steps ?? [];
    const next = steps.find((s) => s.state !== 'complete' && s.state !== 'done');
    return next ? `next: ${STEP_WORDS[next.key] ?? next.key}` : 'finished';
  };
  return (
    <>
      <header className="flex flex-wrap items-baseline gap-[8px_14px] mb-[16px]">
        <h1 className="m-0">{title}</h1>
        <span className="text-[13px] text-muted">{lead ?? `${mine.length} ${mine.length === 1 ? noun.one : noun.many}`}</span>
        <button className="ml-auto" onClick={() => go('Plan')}><Plus size={14} /> Start a new {noun.one}</button>
      </header>
      {mine.length ? (
        <ul className="list-none m-0 p-0 border border-solid border-line rounded-lg bg-surface overflow-clip max-w-[900px]">
          {mine.map((p) => (
            <li key={p.id} className="[&+&]:[border-top:1px_solid_var(--line)]">
              <button type="button" onClick={() => open(p)}
                className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] gap-[14px] items-center text-left p-[12px_16px] [border:0] rounded-none bg-transparent hover:bg-surface-2">
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-[580] truncate">{p.title}</b>
                  <span className="block text-[12px] text-muted truncate">{p.campaign ?? 'No campaign'}</span>
                </span>
                <span className="text-[12px] text-ink-2">{where(p)}</span>
                <ArrowRight size={14} className="text-muted" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sectionempty">Nothing here yet. Park an idea in Plan → Parking lot, then “Make it”.</p>
      )}
    </>
  );
}
