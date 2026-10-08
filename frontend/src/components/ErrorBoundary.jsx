import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * One page throwing must not blank the whole studio. React only offers error
 * boundaries as class components, which is why this one is a class. Keyed by
 * page in main.jsx, so navigating away clears the error.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[page error]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="decisiongroup warning">
        <b>This page hit an error</b>
        <div><AlertCircle size={15} /> {this.state.error.message}</div>
        <div><button onClick={() => this.setState({ error: null })}>Try again</button></div>
      </div>
    );
  }
}
