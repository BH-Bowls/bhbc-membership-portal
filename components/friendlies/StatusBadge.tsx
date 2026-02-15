import { GameStatus } from '@/lib/types/friendlies';

interface StatusBadgeProps {
  status: GameStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const badges: { [key in GameStatus]: { label: string; color: string } } = {
    '': { label: 'Upcoming', color: 'bg-gray-500' },
    'O': { label: 'Open', color: 'bg-green-500' },
    'L': { label: 'Allocating', color: 'bg-amber-500' },
    'X': { label: 'Selecting', color: 'bg-yellow-500' },
    'S': { label: 'Selected', color: 'bg-blue-500' },
    'P': { label: 'Played', color: 'bg-purple-500' },
    'C': { label: 'Cancelled', color: 'bg-red-500' },
    'A': { label: 'Abandoned', color: 'bg-orange-500' },
  };

  const badge = badges[status] || badges[''];

  return (
    <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color} ${className}`}>
      {badge.label}
    </span>
  );
}
