import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

/**
 * Which of your personas presents this video — its personality steers the
 * writing, its looks come first in Render, its pace is the starting speed.
 * A quiet select in the video's facts line, like How it's made.
 */
export default function PersonaChooser({ onChange }) {
  const { production, mutate } = useStudio();
  const [current, setCurrent] = useState(null);
  const [personas, setPersonas] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.all([api.videoPersona(production.id), api.presenters(false)]).then(([p, d]) => {
      if (!live) return;
      setCurrent(p);
      setPersonas(d.tabs.find((t) => t.id === 'personal')?.presenters ?? []);
    }).catch(() => {});
    return () => { live = false; };
  }, [production.id]);
  if (!current || personas.length < 2) return null;
  const pick = async (id) => {
    const r = await mutate(() => api.setVideoPersona(production.id, Number(id)), null, { silent: true }).catch(() => null);
    if (r?.data) { setCurrent(r.data); onChange?.(r.data); }
  };
  return (
    <label className="relative inline-flex items-center text-[12.5px] text-ink-2 font-[560] cursor-pointer" title="The persona presenting this video">
      <span>{current.name}</span>
      <ChevronDown size={12} className="ml-[3px] text-muted" />
      <select className="absolute inset-0 opacity-0 cursor-pointer" value={current.id} onChange={(e) => pick(e.target.value)} aria-label="Persona">
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}
