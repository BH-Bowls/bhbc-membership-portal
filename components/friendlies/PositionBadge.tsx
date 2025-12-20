import { Position } from '@/lib/types/friendlies';

interface PositionBadgeProps {
  position: Position;
  className?: string;
}

export function PositionBadge({ position, className = '' }: PositionBadgeProps) {
  const labels: { [key in Position]: string } = {
    '': '-',
    'S': 'Skip',
    '1': 'Lead',
    '2': 'Second',
    '3': 'Third',
  };

  const colors: { [key in Position]: string } = {
    '': 'bg-gray-100 text-gray-800',
    'S': 'bg-purple-100 text-purple-800',
    '1': 'bg-blue-100 text-blue-800',
    '2': 'bg-green-100 text-green-800',
    '3': 'bg-yellow-100 text-yellow-800',
  };

  return (
    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${colors[position]} ${className}`}>
      {labels[position]}
    </span>
  );
}

export function getPositionLabel(position: Position): string {
  const labels: { [key in Position]: string } = {
    '': '-',
    'S': 'Skip',
    '1': 'Lead',
    '2': 'Second',
    '3': 'Third',
  };
  return labels[position] || position;
}
