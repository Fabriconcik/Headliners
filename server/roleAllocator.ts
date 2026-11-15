import {
  computeRoleSlots,
  type Role,
  type RoleSlotLimits,
  type SaboteurClass,
} from '../shared/constants.js';
import type { PlayerInfo } from '../shared/protocol.js';

const ALL_SABOTEUR_CLASSES: SaboteurClass[] = ['vandal', 'hacker', 'director'];

export function countTakenRoles(players: PlayerInfo[]): Record<Role, number> {
  const counts: Record<Role, number> = { writer: 0, artist: 0, saboteur: 0 };
  for (const p of players) {
    if (p.role) counts[p.role]++;
  }
  return counts;
}

export function canTakeRole(
  players: PlayerInfo[],
  playerId: string,
  role: Role,
  limits: RoleSlotLimits,
): boolean {
  const others = players.filter((p) => p.id !== playerId);
  const counts = countTakenRoles(others);
  return counts[role] < limits[role];
}

export function randomSaboteurClass(): SaboteurClass {
  return ALL_SABOTEUR_CLASSES[Math.floor(Math.random() * ALL_SABOTEUR_CLASSES.length)];
}

export function finalizePlayerRoles(players: PlayerInfo[], testMode: boolean): RoleSlotLimits {
  const limits = computeRoleSlots(players.length, testMode);
  const counts = countTakenRoles(players);
  const order: Role[] = ['writer', 'artist', 'saboteur'];

  // Assign unassigned players to remaining open slots in strict priority order: writer -> artist -> saboteur
  for (const player of players) {
    if (!player.role) {
      const available = order.find((r) => counts[r] < limits[r]);
      player.role = available ?? 'saboteur';
      counts[player.role] = (counts[player.role] ?? 0) + 1;
    }

    if (player.role === 'saboteur' && !player.saboteurClass) {
      player.saboteurClass = randomSaboteurClass();
    }
    if (player.role !== 'saboteur') {
      player.saboteurClass = null;
    }
  }

  return limits;
}
