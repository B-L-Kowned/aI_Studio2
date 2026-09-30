import React from 'react';
import { AlertCircle } from 'lucide-react';

/** What a page shows before its data arrives: loading, or why it did not. */
export default function LoadState({ error, retry, label = 'Loading…' }) {
  if (!error) return <p className="muted">{label}</p>;
  return (
    <div className="decisiongroup warning">
      <b>Could not load this</b>
      <div><AlertCircle size={15} /> {error.message}</div>
      {retry && <div><button onClick={retry}>Retry</button></div>}
    </div>
  );
}
