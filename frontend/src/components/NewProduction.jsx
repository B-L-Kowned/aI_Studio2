import React, { useState } from 'react';
import { X, Lock, AlertCircle, Upload, ArrowLeft } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import TemplatePicker from './TemplatePicker.jsx';

// The dialog asks for whatever the starting point actually needs, at the moment
// it is named. "New production from an existing video" used to ask for a title,
// a template and a campaign — and never once mentioned a video. You created a
// production, then went hunting in Plan → Sources for the thing the dialog was
// named after.

const SOURCE = {
  idea: { label: 'a blank idea', needs: null },
  template: { label: 'a template', needs: null },
  existing_video: {
    label: 'an existing video',
    needs: 'video',
    help: 'Measured locally with ffmpeg as soon as the production is created. Nothing is uploaded.',
  },
  existing_script: {
    label: 'an existing script',
    needs: 'script',
    help: 'One line per speaker, as "Name: their line". It lands as an accepted script version.',
  },
  existing_project: {
    label: 'an existing project',
    needs: 'project',
    help: 'Brief, outline and scenes are copied. Scripts, renders and publications are not — those are work, not plan.',
  },
  url: {
    label: 'a source URL',
    needs: 'url',
    help: 'The app reads the public page, preserves the evidence and waits for your review before rendering.',
  },
};

export default function NewProduction({
  sourceType, campaignId: initialCampaign = null, prefillTitle = '', onClose, onBack, onDone,
}) {
  const { workspace, collections, productions, createProduction, scopeMode } = useStudio();
  const source = SOURCE[sourceType] ?? SOURCE.idea;

  const [title, setTitle] = useState(prefillTitle);
  // The first template IN THIS PROGRAM, not the first in the array. Opening
  // the modal in Comedy pre-selected "Pat — 20 Minute Podcast" — a content
  // podcast, sitting below the fold under "other program", so the default was
  // both wrong and invisible.
  const [templateId, setTemplateId] = useState(() => {
    const fits = (x) => !scopeMode || x.mode === scopeMode || x.mode === 'both';
    return (workspace.templates.find(fits) ?? workspace.templates[0])?.id ?? '';
  });
  const [campaignId, setCampaignId] = useState(initialCampaign ?? '');
  const [videoFile, setVideoFile] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [copyFromId, setCopyFromId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  // null = not creating one; a string = the name being typed.
  const [newCampaignName, setNewCampaignName] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const desktop = typeof window !== 'undefined' && window.studio?.desktop;
  const templates = workspace.templates;
  const needsTemplate = sourceType === 'template';

  const chooseVideo = async () => {
    const picked = await window.studio.pickVideo();
    if (picked) setVideoFile(picked);
  };

  const ready =
    source.needs !== 'unavailable' &&
    (source.needs !== 'video' || !!videoFile.trim()) &&
    (source.needs !== 'script' || !!scriptText.trim()) &&
    (source.needs !== 'project' || !!copyFromId) &&
    (source.needs !== 'url' || !!sourceUrl.trim());

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      // Make the campaign first, so the production lands in it rather than
      // being created loose and moved.
      let campaign = campaignId ? Number(campaignId) : null;
      if (newCampaignName !== null && newCampaignName.trim()) {
        const made = await api.createCampaign({ name: newCampaignName.trim() });
        campaign = made.data?.id ?? made.data?.campaign?.id ?? null;
      }

      await createProduction({
        sourceType,
        templateId: needsTemplate ? templateId : (templateId || null),
        title: title.trim() || undefined,
        campaignId: campaign,
        videoFile: videoFile.trim() || null,
        scriptText: scriptText.trim() || null,
        copyFromId: copyFromId ? Number(copyFromId) : null,
        sourceUrl: sourceUrl.trim() || null,
      });
      onDone?.();
      onClose();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={'modal newproductionmodal' + (source.needs !== 'project' ? ' has-template-picker' : '')}>
        <div className="modalhead">
          <b>
            {onBack && (
              <button className="backbtn" type="button" onClick={onBack} title="Choose a different starting point">
                <ArrowLeft size={14} />
              </button>
            )}
            New production from {source.label}
          </b>
          <button onClick={onClose}><X size={15} /></button>
        </div>

        <form onSubmit={submit}>
          {/* The thing this route is named after comes FIRST. */}
          {source.needs === 'video' && (
            <label className="oblabel">
              The video
              {desktop ? (
                <span className="pickrow">
                  <button type="button" onClick={chooseVideo}>
                    <Upload size={13} /> {videoFile ? 'Choose a different file' : 'Choose a video…'}
                  </button>
                  {videoFile && <code>{videoFile}</code>}
                </span>
              ) : (
                <input
                  className="obinput"
                  placeholder="/Users/you/Movies/interview.mp4"
                  value={videoFile}
                  onChange={(e) => setVideoFile(e.target.value)}
                  autoFocus
                />
              )}
              <small className="obhelp">{source.help}</small>
            </label>
          )}

          {source.needs === 'script' && (
            <label className="oblabel">
              The script
              <textarea
                className="obinput scriptbox"
                rows={10}
                placeholder={'Pat: So the thing about agents is that they fail quietly.\nChristine: Which is the worst way to fail.'}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                autoFocus
              />
              <small className="obhelp">{source.help}</small>
            </label>
          )}

          {source.needs === 'url' && (
            <label className="oblabel">
              Website URL
              <input
                className="obinput"
                type="text"
                inputMode="url"
                placeholder="https://example.com"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                autoFocus
              />
              <small className="obhelp">{source.help}</small>
            </label>
          )}

          {source.needs === 'project' && (
            <label className="oblabel">
              Copy the plan from
              <select
                className="obinput"
                value={copyFromId}
                onChange={(e) => setCopyFromId(e.target.value)}
                autoFocus
              >
                <option value="">Choose a production…</option>
                {productions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · {p.counts.sections} sections · {p.counts.scenes} scenes
                  </option>
                ))}
              </select>
              <small className="obhelp">{source.help}</small>
            </label>
          )}

          <label className="oblabel">
            Title
            <input
              className="obinput"
              placeholder="e.g. Why Agents Keep Failing"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={!source.needs}
            />
          </label>

          {/* A copied plan brings its own outline, so offering a template here
              would be offering to overwrite what you just chose to copy. */}
          {source.needs !== 'project' && (
            <div className="oblabel">
              Template {needsTemplate ? '' : '(optional — sets the starting brief and outline)'}
              <TemplatePicker
                templates={templates}
                value={templateId}
                allowBlank={!needsTemplate}
                onChange={setTemplateId}
              />
            </div>
          )}

          {templates.length === 0 && (
            <p className="oberr"><Lock size={14} /> Your licence includes no templates.</p>
          )}

          <label className="oblabel">
            Campaign (optional)
            <select
              className="obinput"
              value={newCampaignName === null ? campaignId : '__new'}
              onChange={(e) => {
                if (e.target.value === '__new') setNewCampaignName('');
                else { setNewCampaignName(null); setCampaignId(e.target.value); }
              }}
            >
              <option value="">No campaign — a one-off</option>
              {collections.campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.mode}</option>
              ))}
              <option value="__new">＋ New campaign…</option>
            </select>
            {newCampaignName !== null && (
              <input
                className="obinput"
                style={{ marginTop: 6 }}
                placeholder="Name the campaign"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                autoFocus
              />
            )}
          </label>

          {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={busy || !ready}>
              {busy
                ? (source.needs === 'video' ? 'Measuring…' : source.needs === 'url' ? 'Researching…' : 'Creating…')
                : 'Create production'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
