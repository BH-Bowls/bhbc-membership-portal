// src/lib/mock-competitions-data.ts
// Static mock data for the competitions UI preview
// Names are looked up from the member map — only usernames live in match data

import type { Competition, CompMatch, CompMemberInfo } from '@/types/competitions';

// ---------------------------------------------------------------------------
// Mock member directory (username → info)
// In production this comes from the Members sheet
// ---------------------------------------------------------------------------

export const MOCK_MEMBERS: Record<string, CompMemberInfo> = {
  jsmith:    { username: 'jsmith',    fullName: 'John Smith',       handicap: 8,  memberType: 'Playing Man' },
  rbrown:    { username: 'rbrown',    fullName: 'Robert Brown',      handicap: 4,  memberType: 'Playing Man' },
  mkelly:    { username: 'mkelly',    fullName: 'Michael Kelly',     handicap: 7,  memberType: 'Playing Man' },
  jwilson:   { username: 'jwilson',   fullName: 'James Wilson',      handicap: 3,  memberType: 'Playing Man' },
  dmartin:   { username: 'dmartin',   fullName: 'David Martin',      handicap: 9,  memberType: 'Playing Man' },
  pclarke:   { username: 'pclarke',   fullName: 'Peter Clarke',      handicap: 5,  memberType: 'Playing Man' },
  ataylor:   { username: 'ataylor',   fullName: 'Alan Taylor',       handicap: 6,  memberType: 'Playing Man' },
  rwhite:    { username: 'rwhite',    fullName: 'Richard White',     handicap: 2,  memberType: 'Playing Man' },
  gjones:    { username: 'gjones',    fullName: 'Gary Jones',        handicap: 7,  memberType: 'Playing Man' },
  bthomas:   { username: 'bthomas',   fullName: 'Brian Thomas',      handicap: 4,  memberType: 'Playing Man' },
  hmoore:    { username: 'hmoore',    fullName: 'Harry Moore',       handicap: 6,  memberType: 'Playing Man' },
  ldavis:    { username: 'ldavis',    fullName: 'Lee Davis',         handicap: 3,  memberType: 'Playing Man' },
  gthompson: { username: 'gthompson', fullName: 'Graham Thompson',   handicap: 5,  memberType: 'Playing Man' },
  sanderson: { username: 'sanderson', fullName: 'Steve Anderson',    handicap: 8,  memberType: 'Playing Man' },
  mjackson:  { username: 'mjackson',  fullName: 'Mark Jackson',      handicap: 6,  memberType: 'Playing Man' },
  cwilliams: { username: 'cwilliams', fullName: 'Chris Williams',    handicap: 4,  memberType: 'Playing Man' },
  // Ladies for other comps
  sdavis:    { username: 'sdavis',    fullName: 'Susan Davis',       handicap: 7,  memberType: 'Playing Lady' },
  mjones:    { username: 'mjones',    fullName: 'Mary Jones',        handicap: 5,  memberType: 'Playing Lady' },
  pwhite:    { username: 'pwhite',    fullName: 'Patricia White',    handicap: 8,  memberType: 'Playing Lady' },
  emartin:   { username: 'emartin',   fullName: 'Elizabeth Martin',  handicap: 4,  memberType: 'Playing Lady' },
  ataylor2:  { username: 'ataylor2',  fullName: 'Anne Taylor',       handicap: 6,  memberType: 'Playing Lady' },
  cthompson: { username: 'cthompson', fullName: 'Carol Thompson',    handicap: 3,  memberType: 'Playing Lady' },
  jwilliams: { username: 'jwilliams', fullName: 'Janet Williams',    handicap: 7,  memberType: 'Playing Lady' },
  pbrown:    { username: 'pbrown',    fullName: 'Pauline Brown',     handicap: 5,  memberType: 'Playing Lady' },
};

export function getMember(username: string): CompMemberInfo {
  return MOCK_MEMBERS[username] ?? { username, fullName: username, handicap: null };
}

// ---------------------------------------------------------------------------
// Men's Championship — 16 players, R1 complete, QF in progress
// Current logged-in user: gjones (playing in QF3 vs hmoore)
// ---------------------------------------------------------------------------

export const MENS_CHAMPIONSHIP_MATCHES: CompMatch[] = [
  // Round 1 — all complete
  { matchId: 'MC-R1-1', round: 'R1', position: 1,  side1Usernames: ['jsmith'],    side2Usernames: ['rbrown'],    score1: 21, score2: 14, winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-2', round: 'R1', position: 2,  side1Usernames: ['mkelly'],    side2Usernames: ['jwilson'],   score1: 21, score2: 9,  winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-3', round: 'R1', position: 3,  side1Usernames: ['dmartin'],   side2Usernames: ['pclarke'],   score1: 21, score2: 15, winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-4', round: 'R1', position: 4,  side1Usernames: ['ataylor'],   side2Usernames: ['rwhite'],    score1: 21, score2: 8,  winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-5', round: 'R1', position: 5,  side1Usernames: ['gjones'],    side2Usernames: ['bthomas'],   score1: 21, score2: 17, winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-6', round: 'R1', position: 6,  side1Usernames: ['hmoore'],    side2Usernames: ['ldavis'],    score1: 21, score2: 12, winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-7', round: 'R1', position: 7,  side1Usernames: ['gthompson'], side2Usernames: ['sanderson'], score1: 18, score2: 21, winnerSide: 2, status: 'Complete', playByDate: '2026-02-01' },
  { matchId: 'MC-R1-8', round: 'R1', position: 8,  side1Usernames: ['mjackson'],  side2Usernames: ['cwilliams'], score1: 21, score2: 16, winnerSide: 1, status: 'Complete', playByDate: '2026-02-01' },

  // Quarter Finals — 2 complete, 2 pending
  { matchId: 'MC-QF-1', round: 'QF', position: 1, side1Usernames: ['jsmith'],   side2Usernames: ['mkelly'],    score1: 21, score2: 14, winnerSide: 1, status: 'Complete',  playByDate: '2026-03-01', playedDate: '2026-02-22' },
  { matchId: 'MC-QF-2', round: 'QF', position: 2, side1Usernames: ['dmartin'],  side2Usernames: ['ataylor'],   score1: 21, score2: 10, winnerSide: 1, status: 'Complete',  playByDate: '2026-03-01', playedDate: '2026-02-20' },
  { matchId: 'MC-QF-3', round: 'QF', position: 3, side1Usernames: ['gjones'],   side2Usernames: ['hmoore'],    score1: null, score2: null, winnerSide: null, status: 'Pending', playByDate: '2026-03-15' },
  { matchId: 'MC-QF-4', round: 'QF', position: 4, side1Usernames: ['sanderson'],side2Usernames: ['mjackson'],  score1: null, score2: null, winnerSide: null, status: 'Pending', playByDate: '2026-03-15' },

  // Semi Finals — pending
  { matchId: 'MC-SF-1', round: 'SF', position: 1, side1Usernames: ['jsmith'],  side2Usernames: ['dmartin'],  score1: null, score2: null, winnerSide: null, status: 'Pending', playByDate: '2026-04-12' },
  { matchId: 'MC-SF-2', round: 'SF', position: 2, side1Usernames: ['gjones'], side2Usernames: ['sanderson'], score1: null, score2: null, winnerSide: null, status: 'Pending', playByDate: '2026-04-12' },

  // Final — pending
  { matchId: 'MC-F-1', round: 'F', position: 1, side1Usernames: ['jsmith'], side2Usernames: ['gjones'], score1: null, score2: null, winnerSide: null, status: 'Pending', playByDate: '2026-05-10' },
];

// ---------------------------------------------------------------------------
// Mock competition list
// ---------------------------------------------------------------------------

export const MOCK_COMPETITIONS: Competition[] = [
  {
    compId: 'mens-championship',
    displayName: "Men's Championship",
    compType: 'singles',
    status: 'In Progress',
    year: 2026,
    finalsDate: '2026-05-10',
    r1PlayBy: '2026-02-01',
    qfPlayBy: '2026-03-15',
    sfPlayBy: '2026-04-12',
  },
  {
    compId: 'ladies-maynard',
    displayName: "Ladies' Maynard",
    compType: 'singles',
    status: 'In Progress',
    year: 2026,
    finalsDate: '2026-05-10',
    r1PlayBy: '2026-02-01',
    qfPlayBy: '2026-03-15',
    sfPlayBy: '2026-04-12',
  },
  {
    compId: 'drawn-pairs',
    displayName: 'Drawn Pairs',
    compType: 'pairs',
    status: 'Draw Done',
    year: 2026,
    finalsDate: '2026-05-10',
    r1PlayBy: '2026-02-15',
  },
  {
    compId: 'drawn-triples',
    displayName: 'Drawn Triples',
    compType: 'triples',
    status: 'Draw Done',
    year: 2026,
    finalsDate: '2026-05-10',
    triplesFixedDay: true,
    triplesFixedDate: '2026-02-08',
    r1PlayBy: '2026-03-01',
  },
  {
    compId: 'handicap',
    displayName: 'Handicap',
    compType: 'singles',
    status: 'In Progress',
    year: 2026,
    finalsDate: '2026-05-10',
    r1PlayBy: '2026-02-01',
    qfPlayBy: '2026-03-15',
  },
  {
    compId: 'mens-two-wood',
    displayName: "Men's Two Wood",
    compType: 'singles',
    status: 'Not Started',
    year: 2026,
  },
  {
    compId: 'ladies-two-wood',
    displayName: "Ladies' Two Wood",
    compType: 'singles',
    status: 'Not Started',
    year: 2026,
  },
  {
    compId: 'married-pairs',
    displayName: 'Married Pairs',
    compType: 'pairs',
    status: 'Not Started',
    year: 2026,
  },
  {
    compId: 'australian-pairs',
    displayName: 'Australian Pairs',
    compType: 'pairs',
    status: 'Not Started',
    year: 2026,
  },
  {
    compId: 'oldlands',
    displayName: 'Oldlands',
    compType: 'singles',
    status: 'Complete',
    year: 2026,
    finalsDate: '2026-01-20',
  },
  {
    compId: 'veterans',
    displayName: 'Veterans',
    compType: 'singles',
    status: 'Not Started',
    year: 2026,
  },
];
