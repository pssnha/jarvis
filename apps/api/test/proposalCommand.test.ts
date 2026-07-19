import { describe, expect, it } from 'vitest';
import { resolveProposalCommand } from '@jarvis/agent';

/**
 * The numeric confirm/reject resolver must map replies to the CURRENT pending
 * codes only — this is what stops the assistant anchoring on stale numbered
 * lists left in the conversation history (the "add 1 and 2 → I only see 18–23"
 * bug). Unrecognised free-form text must defer to the LLM (null).
 */
describe('resolveProposalCommand', () => {
  const pending = ['1', '2'];

  it('confirms the numbers named in "add 1 and 2"', () => {
    expect(resolveProposalCommand('add 1 and 2', pending)).toEqual({
      confirm: ['1', '2'],
      reject: [],
      unknown: [],
    });
  });

  it('ignores a sender-name prefix', () => {
    expect(resolveProposalCommand('Prakash: add 1 and 2', pending)).toEqual({
      confirm: ['1', '2'],
      reject: [],
      unknown: [],
    });
  });

  it('confirms a bare number reply "1" (notify UX: reply with which to add)', () => {
    expect(resolveProposalCommand('1', pending)).toEqual({
      confirm: ['1'],
      reject: [],
      unknown: [],
    });
  });

  it('confirms bare "1 and 2" with no verb', () => {
    expect(resolveProposalCommand('1 and 2', pending)).toEqual({
      confirm: ['1', '2'],
      reject: [],
      unknown: [],
    });
  });

  it('defers "1 pm" — a bare number with a real word is not a command', () => {
    expect(resolveProposalCommand('1 pm', pending)).toBeNull();
  });

  it('handles "add all"', () => {
    expect(resolveProposalCommand('add all', pending)).toEqual({
      confirm: ['1', '2'],
      reject: [],
      unknown: [],
    });
  });

  it('handles a mixed add/skip reply', () => {
    expect(resolveProposalCommand('no - 2 add - 1', pending)).toEqual({
      confirm: ['1'],
      reject: ['2'],
      unknown: [],
    });
  });

  it('flags numbers not in the current pending set instead of guessing', () => {
    expect(resolveProposalCommand('add 18 and 19', pending)).toEqual({
      confirm: [],
      reject: [],
      unknown: ['18', '19'],
    });
  });

  it('normalises zero-padded numbers', () => {
    expect(resolveProposalCommand('confirm 02', pending)).toEqual({
      confirm: ['2'],
      reject: [],
      unknown: [],
    });
  });

  it('rejection wins when a code is named on both sides', () => {
    expect(resolveProposalCommand('add 1 no 1', pending)).toEqual({
      confirm: [],
      reject: ['1'],
      unknown: [],
    });
  });

  it('defers a bare "yes"/"no" to the LLM (could answer another question)', () => {
    expect(resolveProposalCommand('yes', pending)).toBeNull();
    expect(resolveProposalCommand('no', pending)).toBeNull();
  });

  it('defers free-form scheduling requests that merely contain a number', () => {
    expect(resolveProposalCommand('add a dentist appointment at 2pm', pending)).toBeNull();
    expect(resolveProposalCommand('add return flight UA 1863', pending)).toBeNull();
  });

  it('returns null when nothing is pending', () => {
    expect(resolveProposalCommand('add 1 and 2', [])).toBeNull();
  });
});
