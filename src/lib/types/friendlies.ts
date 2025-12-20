// Game status types
export type GameStatus = '' | 'O' | 'X' | 'S' | 'P' | 'C' | 'A';

// Player entry status types (Players sheet)
export type PlayerEntryStatus = 'E' | 'P' | 'R' | 'T' | 'A' | 'EW' | 'PW' | 'RW' | 'TW' | 'AW' | 'C';

// Selection status types (Game sheet column F)
export type SelectionStatus = '' | 'Y' | 'R' | 'T';

// Confirmation status types (Game sheet column K)
export type ConfirmationStatus = '' | 'Y' | 'W';

// Position types
export type Position = '' | 'S' | '1' | '2' | '3';

// Home/Away type
export type HomeAway = 'H' | 'A';

// Game from Games sheet
export interface Game {
  rowNumber: number;
  date: string;
  tabDate: string;
  time: string;
  clubName: string;
  homeAway: HomeAway;
  format: string;
  ladiesMen: string;
  dress: string;
  league: string;
  tabName: string;
  status: GameStatus;
  include?: string;
  entered: number;
  selected: number;
  reserves: number;
  bhbcScore: number | null;
  opponentScore: number | null;
  reason: string;
  who: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
}

// Game with user's entry status
export interface GameWithUserStatus extends Game {
  userEntered: boolean;
  userStatus: PlayerEntryStatus | null;
}

// Player entry from Players sheet
export interface PlayerEntry {
  tabName: string;
  status: PlayerEntryStatus;
}

// Player from game sheet (for captain selection)
export interface GameSheetPlayer {
  rowNumber: number;
  name: string;
  nameDown: number;
  picked: number;
  percentPlayed: number;
  driverBar: string;
  selected: SelectionStatus;
  team: number | null;
  position: Position;
  driving: string;
  carNumber: string;
  status: ConfirmationStatus;
  captain: string;
  last6Games?: string;
}

// Player stats
export interface PlayerStats {
  nameDown: number;
  picked: number;
  percentPlayed: number;
  withdrawn: number;
  cancelled: number;
  last6Games: string[];
}

// Driver/Bar info
export interface DriverBarInfo {
  driver: boolean;
  bar: boolean;
  code: string;
}

// Tea Rota entry
export interface TeaRota {
  date: string;
  time: string;
  clubName: string;
  ladiesMen: string;
  format: string;
  lead: string;
  second: string;
  third: string;
  shortLead: string;
  shortSecond: string;
  shortThird: string;
}

// Club details from Match Day Contacts
export interface ClubDetails {
  clubName: string;
  clubNumber: string;
  clubMobile: string;
  clubEmail: string;
  clubEmailNote: string;
  generalInfo: string;
  drivingBand: string;
  petrolCost: number;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  postCode: string;
  googleAddress: string;
  bowlsEnglandUrl: string;
  website: string;
  bhWebsite: string;
  latitude: string;
  longitude: string;
}

// Club contact from Match Day Contacts
export interface ClubContact {
  clubName: string;
  role: string;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  mobileNumber: string;
  notes: string;
  email: string;
}

// Team for match card display
export interface Team {
  team: number;
  players: {
    name: string;
    position: Position;
    status: ConfirmationStatus;
    driving?: string;
    carNumber?: string;
    isCaptain?: boolean;
  }[];
}

// Reserve player
export interface ReservePlayer {
  name: string;
  team: number | null;
  position: Position;
  status: ConfirmationStatus;
}

// Match card data
export interface MatchCardData {
  game: {
    tabDate: string;
    date: string;
    time: string;
    clubName: string;
    homeAway: HomeAway;
    format: string;
    ladiesMen: string;
    dress?: string;
  };
  teams: Team[];
  reserves: ReservePlayer[];
  reserveTeams: Team[];
  captain: string;
  teaRota?: {
    lead: string;
    second: string;
    third: string;
  } | null;
  clubDetails?: {
    address: string;
    postCode: string;
    generalInfo: string;
    petrolCost: number;
    drivingBand: string;
    directionsUrl: string;
    clubNumber: string;
    clubMobile: string;
    clubEmail: string;
    website: string;
  } | null;
  clubContacts?: {
    name: string;
    role: string;
    phone: string;
    mobile: string;
    email: string;
  }[] | null;
}

// API request/response types
export interface EnterGamesRequest {
  user_name?: string; // Optional, can get from session
  game_ids: string[];
}

export interface EnterGamesResponse {
  success: boolean;
  results: {
    game_id: string;
    entered: boolean;
    error?: string;
  }[];
}

export interface ConfirmParticipationRequest {
  user_name?: string; // Optional, can get from session
  tab_date: string;
  action: 'confirm';
}

export interface WithdrawRequest {
  user_name?: string; // Optional, can get from session
  tab_date: string;
}

export interface ChangeStatusRequest {
  tab_date: string;
  action: 'open' | 'close' | 'publish' | 'played' | 'cancel' | 'abandon';
  bhbc_score?: number;
  opponent_score?: number;
  reason?: string;
  who?: string;
}

export interface ChangeStatusResponse {
  success: boolean;
  new_status: GameStatus;
  game_sheet_created?: boolean;
}

export interface AddPlayerRequest {
  tab_date: string;
  user_name: string;
}

export interface UpdateSelectionRequest {
  tab_date: string;
  selections: {
    row_number: number;
    selected?: SelectionStatus;
    team?: number | null;
    position?: Position;
    driving?: string;
    car_number?: string;
    captain?: string;
  }[];
}

export interface UpdateSelectionResponse {
  success: boolean;
  sorted_players: GameSheetPlayer[];
}

export interface UpdateStatsRequest {
  tab_date: string;
}

export interface UpdateStatsResponse {
  success: boolean;
  stats_updated: number;
}

export interface GetStatsRequest {
  tab_date: string;
}
