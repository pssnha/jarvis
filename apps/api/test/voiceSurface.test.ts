import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, toolsForSurface } from '@jarvis/agent';

/**
 * The voice surface (Siri / in-app voice) is the enforcement point for two
 * product rules: trip itineraries are read-only by voice, and replies must be
 * speakable. Both are checked at the tool-surface and prompt level so a prompt
 * drift can't quietly re-enable itinerary edits.
 */
describe('voice tool surface', () => {
  const names = toolsForSurface('voice').map((t) => t.spec.name);

  it('exposes full calendar scheduling including single-occurrence edits', () => {
    for (const n of [
      'create_event',
      'list_events',
      'find_event',
      'update_event',
      'update_event_occurrence',
      'cancel_event',
      'cancel_event_occurrence',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('can read trips but never edit itineraries', () => {
    expect(names).toContain('list_trips');
    expect(names).not.toContain('add_trip_item');
    expect(names).not.toContain('cancel_trip_item');
  });

  it('does not expose proposal codes (nothing to read them from by voice)', () => {
    expect(names).not.toContain('confirm_proposal');
    expect(names).not.toContain('reject_proposal');
  });

  it('is a strict subset of the general surface', () => {
    const all = toolsForSurface('general').map((t) => t.spec.name);
    for (const n of names) expect(all).toContain(n);
    expect(names.length).toBeLessThan(all.length);
  });
});

describe('voice system prompt', () => {
  const trips = [
    { id: 't1', title: 'Lisbon', destinations: 'Portugal', start: '2026-10-01', end: '2026-10-10' },
  ];
  const prompt = buildSystemPrompt('America/Los_Angeles', { surface: 'voice', trips });

  it('asks for spoken, list-free replies and confirms before cancelling', () => {
    expect(prompt).toMatch(/SPOKEN ALOUD/);
    expect(prompt).toMatch(/No markdown, bullet points/);
    expect(prompt).toMatch(/cancel only after a spoken yes/);
  });

  it('frames the shared circle calendar, not private items', () => {
    expect(prompt).toMatch(/SHARED calendar/);
    expect(prompt).not.toMatch(/PRIVATE to this person/);
  });

  it('lists trips as read-only and never instructs add_trip_item', () => {
    expect(prompt).toContain('[trip:t1] Lisbon');
    expect(prompt).toMatch(/READ-ONLY/);
    expect(prompt).not.toMatch(/add_trip_item/);
    expect(prompt).not.toMatch(/cancel_trip_item/);
  });

  it('leaves the other surfaces unchanged', () => {
    const general = buildSystemPrompt('America/Los_Angeles', { surface: 'general', trips });
    expect(general).toMatch(/add_trip_item/);
    expect(general).not.toMatch(/SPOKEN ALOUD/);
    const calendar = buildSystemPrompt('America/Los_Angeles', { surface: 'calendar', trips });
    expect(calendar).not.toMatch(/\[trip:t1\]/);
  });
});
