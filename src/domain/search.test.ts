import { describe, expect, it } from 'vitest';
import {
  buildMemberSearchFields,
  fullNameHasPrefix,
  inferSearch,
  normalizeMobile,
  normalizeText,
  prefixRange,
} from './search';

describe('normalizeText', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeText('  Rahul   SHARMA \t')).toBe('rahul sharma');
  });

  it('applies NFKD so composed and decomposed forms match', () => {
    expect(normalizeText('José')).toBe(normalizeText('José'));
  });

  it('keeps non-Latin text (no stripping of combining marks)', () => {
    expect(normalizeText('राहुल')).toBe('राहुल');
  });
});

describe('normalizeMobile (NEW-14)', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['09876543210', '9876543210'],
    ['91-9876543210', '9876543210'],
    ['(987) 654-3210', '9876543210'],
    ['6000000000', '6000000000'],
  ])('%j -> %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each(['', '12345', '5876543210', '98765432101', '98765abcde', '+1 415 555 2671', '0000000000'])(
    'returns null for %j',
    (input) => {
      expect(normalizeMobile(input)).toBeNull();
    },
  );
});

describe('buildMemberSearchFields', () => {
  it('derives the full, reversed and mobile keys plus the display name', () => {
    expect(buildMemberSearchFields({ firstName: ' Rahul ', lastName: 'Sharma', mobile: '9876543210' })).toEqual({
      displayName: 'Rahul Sharma',
      searchFullName: 'rahul sharma',
      searchReverseName: 'sharma rahul',
      searchMobile: '9876543210',
    });
  });

  it('collapses internal spaces in multi-word names', () => {
    const f = buildMemberSearchFields({ firstName: 'Mary  Ann', lastName: 'De   Souza', mobile: '9876543210' });
    expect(f.searchFullName).toBe('mary ann de souza');
    expect(f.searchReverseName).toBe('de souza mary ann');
  });
});

describe('inferSearch (US-2.8b/c)', () => {
  it('empty / whitespace = no search', () => {
    expect(inferSearch('')).toEqual({ kind: 'none' });
    expect(inferSearch('   ')).toEqual({ kind: 'none' });
  });

  it('digits = mobile prefix', () => {
    expect(inferSearch('98765')).toEqual({ kind: 'mobile', term: '98765' });
    expect(inferSearch('98765 43')).toEqual({ kind: 'mobile', term: '9876543' });
    expect(inferSearch('+91 98765')).toEqual({ kind: 'mobile', term: '98765' });
  });

  it('starts with gym (any case) = member ID prefix, upper-cased', () => {
    expect(inferSearch('gym-2026-00')).toEqual({ kind: 'memberId', term: 'GYM-2026-00' });
    expect(inferSearch('GYM')).toEqual({ kind: 'memberId', term: 'GYM' });
    expect(inferSearch(' Gym 2026')).toEqual({ kind: 'memberId', term: 'GYM2026' });
  });

  it('otherwise = normalized name prefix', () => {
    expect(inferSearch('  Rah ')).toEqual({ kind: 'name', term: 'rah' });
    expect(inferSearch('Rahul  Sh')).toEqual({ kind: 'name', term: 'rahul sh' });
  });

  it('a name that merely contains digits is a name search', () => {
    expect(inferSearch('rahul2')).toEqual({ kind: 'name', term: 'rahul2' });
  });
});

describe('prefix matching is prefix-only (US-2.8b)', () => {
  it('prefixRange bounds cover values starting with the term and nothing else', () => {
    const { lo, hi } = prefixRange('rah');
    const inRange = (v: string) => v >= lo && v <= hi;
    expect(inRange('rahul sharma')).toBe(true);
    expect(inRange('rah')).toBe(true);
    expect(inRange('ra')).toBe(false);
    expect(inRange('rai')).toBe(false);
    expect(inRange('ahul')).toBe(false);
    expect(inRange('mrahul')).toBe(false);
  });

  it('"ahul" does not match "rahul sharma"; "sha" matches only via the reverse-name key', () => {
    expect(fullNameHasPrefix('rahul sharma', 'ahul')).toBe(false);
    expect(fullNameHasPrefix('rahul sharma', 'rah')).toBe(true);
    expect(fullNameHasPrefix('rahul sharma', 'sha')).toBe(false);
    expect(fullNameHasPrefix('sharma rahul', 'sha')).toBe(true);
    expect(fullNameHasPrefix('rahul sharma', 'rahul sh')).toBe(true);
  });
});
