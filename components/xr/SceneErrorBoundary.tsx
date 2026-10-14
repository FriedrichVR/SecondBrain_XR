'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered instead of the children once something throws. */
  fallback?: (error: Error) => ReactNode;
  onError?: (error: Error) => void;
  /** Remount the subtree when this changes — used to retry after a new payload. */
  resetKey?: string | number;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures in the 3D stage.
 *
 * Without this a single throw inside the canvas (a WebXR polyfill quirk, a
 * failed WASM/font fetch, an unsupported context) unwinds the whole React
 * subtree and the user gets a blank rectangle with no explanation. Here it
 * degrades to a readable message instead.
 *
 * Note: this only catches render/lifecycle errors. It does not catch async
 * WebGL rejections — those surface through the capability probe instead.
 */
export default class SceneErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prev: Props) {
    // New dataset -> give the subtree a clean chance instead of staying dead
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? this.props.fallback(error) : null;
    }
    return this.props.children;
  }
}