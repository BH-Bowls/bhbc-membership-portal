import { Team } from '@/lib/types/friendlies';
import { getPositionLabel } from './PositionBadge';

interface TeamDisplayProps {
  team: Team;
  showDriving?: boolean;
  className?: string;
}

export function TeamDisplay({ team, showDriving = false, className = '' }: TeamDisplayProps) {
  return (
    <div className={`border-2 border-gray-300 rounded-lg p-4 ${className}`}>
      <h4 className="font-bold text-lg mb-3 text-center bg-gray-100 py-2 rounded">
        Team {team.team}
      </h4>
      <div className="space-y-2">
        {team.players.map((player, idx) => (
          <div
            key={idx}
            className={`flex justify-between p-2 rounded ${
              player.isCaptain ? 'bg-purple-100 font-bold' : 'bg-gray-50'
            }`}
          >
            <span>
              {player.name}
              {player.isCaptain && ' ★'}
            </span>
            <span className="text-gray-600">{getPositionLabel(player.position)}</span>
          </div>
        ))}
      </div>
      {showDriving && team.players.some(p => p.driving) && (
        <div className="mt-3 pt-2 border-t border-gray-300 text-sm">
          <strong>Drivers:</strong>{' '}
          {team.players
            .filter(p => p.driving === 'Y')
            .map(p => `${p.name}${p.carNumber ? ` (Car ${p.carNumber})` : ''}`)
            .join(', ')}
        </div>
      )}
    </div>
  );
}
