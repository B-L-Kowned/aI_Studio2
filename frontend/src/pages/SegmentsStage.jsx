import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Play, Volume2, RefreshCw, Lock, Film, User, Users, Headphones, X } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import PresenterPick from '../components/PresenterPick.jsx';

/**
 * The segment is the unit of script, take, presenter, shot, quality and render.
 * Re-render one, not all.
 *
 * THE HARD GATE: nothing renders unheard. A take is an audition in the voice
 * that will actually ship, and editing the line revokes its approval — approving
 * a sound and then changing the words is not approval of the new words.
 */
const BLOCK_LABEL = {
  presenter: 'No presenter',
  avatar: 'Presenter has no avatar',
  audition: 'Never auditioned',
  unheard: 'Not approved',
};

export default function SegmentsStage() {
  const { production, mutate } = useStudio();
  const [data, setData] = useState(null);
  const [castable, setCastable] = useState([]);
  const [busy, setBusy] = useState(null);
  const [read, setRead] = useState(null);
  const [confirmRender, setConfirmRender] = useState(null); // segment awaiting a paid yes
  const [path, setPath] = useState(null);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([api.segments(production.id), api.castablePresenters()]);
    setData(d);
    setCastable(c);
  }, [production.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.heygenStatus().then((h) => setPath(h.renderPath)).catch(() => {}); }, []);
  if (!data) return <p className="muted">Loading…</p>;

  const { segments, gate, speakers } = data;
  // Cast, and needing a take — a stale take counts, because the only way past
  // it is a new one.
  const pendingAudition = segments.filter(
    (x) => x.needsAudition && x.presenter?.avatar && x.presenter?.voice
  ).length;
  // Editing a line is a save; auditioning and rendering are not. `mutate`
  // reports the outcome itself, so this must not report it a second time.
  // Returns the response. It used to swallow it, so a caller that needed the
  // result — the read-through, which IS its result — silently got undefined.
  const run = async (key, fn, { tracksSave = false } = {}) => {
    setBusy(key);
    try {
      const res = await mutate(fn, null, { tracksSave });
      await load();
      return res;
    } catch { return null; /* mutate has already said what went wrong */ }
    finally { setBusy(null); }
  };

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Segments</h2>
          <p>One line, one take, one render. Nothing renders unheard.</p>
        </div>
        <div className="sectionactions">
          {pendingAudition > 0 && (
            <button
              className="primary"
              disabled={busy === 'all'}
              title="Real speech on your HeyGen plan — this uses credits"
              onClick={() => run('all', () => api.auditionAll(production.id))}
            >
              <Volume2 size={14} /> Audition {pendingAudition} line{pendingAudition === 1 ? '' : 's'}
            </button>
          )}
          {segments.length > 0 && (
            <button
              onClick={async () => {
                const r = await run('read', () => api.readThrough(production.id));
                if (r?.data) setRead(r.data);
              }}
              disabled={busy === 'read'}
              title="Hear the words in a local voice. Costs nothing."
            >
              <Headphones size={14} /> {busy === 'read' ? 'Reading…' : 'Read aloud — free'}
            </button>
          )}
          <button onClick={() => run('build', () => api.buildSegments(production.id))}
            disabled={busy === 'build'}>
            <RefreshCw size={14} /> {segments.length ? 'Rebuild from script' : 'Build from script'}
          </button>
        </div>
      </div>

      {read && (
        /* The free pass: what the words sound like and how long they actually
           run. Deliberately not the shipping voice, and deliberately unable to
           open the render gate — it answers "are these the right words", not
           "is this the right delivery". */
        <div className="readout">
          <span className="readhead">
            <Headphones size={13} />
            <b>Read-through</b>
            <i>local voice · nothing spent</i>
          </span>
          {(() => {
            // The target is "m:ss"; compare in seconds so "0:21 vs 2:00" is a
            // fact on screen rather than arithmetic you do in your head.
            const [tm, ts] = String(read.targetRuntime ?? '').split(':').map(Number);
            const target = Number.isFinite(tm) ? tm * 60 + (ts || 0) : null;
            const off = target ? read.spokenSeconds / target : null;
            const tone = off == null ? '' : off < 0.6 ? ' short' : off > 1.15 ? ' over' : ' ok';
            return (
              <span className={'readlen' + tone}>
                {Math.floor(read.spokenSeconds / 60)}:{String(read.spokenSeconds % 60).padStart(2, '0')} spoken
                {read.targetRuntime ? ` · target ${read.targetRuntime}` : ''}
              </span>
            );
          })()}
          {read.audio && <audio controls preload="none" src={read.audio} />}
          <button className="readclose" onClick={() => setRead(null)}><X size={13} /></button>
        </div>
      )}

      {segments.length > 0 && (
        <>
          {/* Casting is a decision about a SPEAKER. Making it per line meant the
              one line you missed was the one that blocked the render. */}
          <div className="castingstrip">
            <span className="castinglabel"><Users size={13} /> Casting</span>
            {speakers.map((sp) => (
              <span className={'castrole' + (sp.mixed ? ' mixed' : '')} key={sp.speaker}>
                <b>{sp.speaker}</b>
                <i>{sp.lines} line{sp.lines === 1 ? '' : 's'}</i>
                <PresenterPick
                  items={castable}
                  value={sp.mixed ? null : (sp.presenter?.id ?? null)}
                  placeholder={sp.mixed ? 'mixed — pick one' : 'not cast'}
                  clearLabel="Not cast"
                  onChange={(id) =>
                    run(`sp${sp.speaker}`, () => api.updateSegment(production.id, sp.firstSegmentId, {
                      presenterId: id,
                      applyToSpeaker: true,
                    }), { tracksSave: true })}
                />
              </span>
            ))}
            {castable.length === 0 && (
              <small className="castwarn">
                No presenter is cast to a real avatar and voice yet — do that on the Presenters page.
              </small>
            )}
          </div>
        </>
      )}

      {segments.length === 0 ? (
        <p className="sectionempty">
          <Film size={15} /> No segments yet. Build them from the accepted script.
        </p>
      ) : (
        <>
          <div className={'gatebar' + (gate.ready ? ' open' : '')}>
            {gate.ready
              ? <><Check size={15} /> <b>All {gate.total} segments approved.</b> This production can render.</>
              : <><Lock size={15} /> <b>{gate.heard} of {gate.total} approved.</b> {gate.blocked.length} still blocked — nothing renders unheard.</>}
          </div>

          <div className="seglist">
            {segments.map((s) => (
              <div className={'segrow' + (s.heard ? ' heard' : '')} key={s.id}>
                <span className="segnum">{String(s.position + 1).padStart(2, '0')}</span>

                <div className="segmain">
                  <div className="segspeaker">
                    <User size={12} /> {s.speaker}
                    {s.presenter && <em>as {s.presenter.name}</em>}
                  </div>
                  <textarea
                    defaultValue={s.text}
                    rows={2}
                    onBlur={(e) => {
                      if (e.target.value !== s.text) {
                        run(`t${s.id}`, () => api.updateSegment(production.id, s.id, { text: e.target.value }), { tracksSave: true });
                      }
                    }}
                  />
                  {s.take && (!s.textMatchesTake || s.take.stale) && (
                    <small className="segwarn">
                      <AlertCircle size={11} />{' '}
                      {s.take.staleReason ?? 'The line changed after the last take'} — audition again.
                    </small>
                  )}
                </div>

                <div className="segcontrols">
                  <PresenterPick
                    items={castable}
                    value={s.presenter?.id ?? null}
                    onChange={(id) =>
                      run(`p${s.id}`, () => api.updateSegment(production.id, s.id, {
                        presenterId: id,
                      }), { tracksSave: true })}
                  />

                  <select
                    value={s.quality}
                    onChange={(e) =>
                      run(`q${s.id}`, () => api.updateSegment(production.id, s.id, { quality: e.target.value }), { tracksSave: true })}
                  >
                    <option value="draft">draft · 720p</option>
                    <option value="final">final · 1080p</option>
                  </select>
                </div>

                <div className="segstate">
                  {s.heard ? (
                    <span className="okv"><Check size={12} /> approved</span>
                  ) : (
                    <span className="unknownv" title={BLOCK_LABEL[s.blockedBy]}>
                      <Lock size={12} /> {BLOCK_LABEL[s.blockedBy] ?? 'blocked'}
                    </span>
                  )}

                  {s.take?.audioUrl && (
                    <audio controls preload="none" src={s.take.audioUrl} className="segaudio" />
                  )}

                  <div className="segactions">
                    <button
                      title="Synthesise this line in the voice that will ship"
                      disabled={busy === `a${s.id}` || !s.presenter}
                      onClick={() => run(`a${s.id}`, () => api.auditionSegment(production.id, s.id))}
                    >
                      <Volume2 size={13} /> Audition
                    </button>

                    {s.take && !s.heard && s.textMatchesTake && !s.take.stale && (
                      <button
                        className="primary"
                        disabled={!s.take.audioUrl}
                        title={s.take.audioUrl ? 'Approve this take' : 'Nothing to hear yet'}
                        onClick={() => run(`h${s.id}`, () => api.markHeard(production.id, s.id, s.take.id, true))}
                      >
                        <Check size={13} /> Approve
                      </button>
                    )}

                    {s.heard && (confirmRender === s.id ? (
                      <>
                        <button onClick={() => setConfirmRender(null)}>Cancel</button>
                        <button
                          className="primary"
                          onClick={() => {
                            setConfirmRender(null);
                            run(`r${s.id}`, () => api.renderSegment(production.id, s.id, true));
                          }}
                        >
                          Charge my plan
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={busy === `r${s.id}`}
                        title={path && !path.free ? 'Charged to your HeyGen plan' : path?.reason ?? ''}
                        onClick={() => (path && !path.free
                          ? setConfirmRender(s.id)
                          : run(`r${s.id}`, () => api.renderSegment(production.id, s.id, true)))}
                      >
                        <Play size={13} /> Render line
                      </button>
                    ))}
                  </div>

                  {s.render && (
                    <span className={'vchip ' + (s.render.status === 'completed' ? 'complete' : s.render.status)
                      + (s.render.stale ? ' stale' : '')}>
                      v{s.render.version} · {s.render.status}{s.render.stale ? ' · stale' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
