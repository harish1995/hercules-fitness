import { createElement, type ComponentType } from 'react';
import { PlaceholderPage } from '../components/common/PlaceholderPage';

/** Build a "Coming in a later phase" page component for a not-yet-built destination. */
export function placeholderFor(title: string): ComponentType {
  const Placeholder = () => createElement(PlaceholderPage, { title });
  Placeholder.displayName = `Placeholder(${title})`;
  return Placeholder;
}
