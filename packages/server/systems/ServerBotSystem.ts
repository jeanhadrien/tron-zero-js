import { query } from 'bitecs';
import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import PlayerSystem, {
  buildDetectionLines,
  buildObstacleLinesExcluding,
  getClosestIntersectingPoint,
  getPlayerTrailLines,
  Position,
  Direction,
  TargetSpeedMult,
  IsAlive,
  PlayerId,
  Player,
} from '@tron0/shared/systems/PlayerSystem';
import { SharedLine, distanceBetween, angleBetween, wrapAngle } from '@tron0/shared/math';
import { Logger } from '@tron0/shared/Logger';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';

const logger = new Logger('BotSystem');

const BOT_COUNT = 3;

type Strategy = 'CUT_OFF' | 'BOX_IN' | 'SPEED_DEMON' | 'TRAPPER';

const FIRST_NAMES = [
  'Kova',
  'Atro',
  'Hayzeur',
  'Nobody',
  'Rampiece',
  'Hyouz',
  'Ksiyae',
  'Koniev',
  'Dys',
  'Shelby',
  'Ryv',
  'Tangz',
  'Kaflao',
  'Boby',
];

const TITLES: Record<Strategy, string> = {
  CUT_OFF: 'The Slicer',
  BOX_IN: 'The Constrictor',
  SPEED_DEMON: 'The Demon',
  TRAPPER: 'The Trapper',
};

function randomStrategy(): Strategy {
  const strategies: Strategy[] = ['CUT_OFF', 'BOX_IN', 'SPEED_DEMON', 'TRAPPER'];
  return strategies[Math.floor(Math.random() * strategies.length)];
}

function randomName(strategy: Strategy): string {
  const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  return `${name} ${TITLES[strategy]}`;
}

interface RelativePosition {
  distance: number;
  angleDiff: number;
  isAhead: boolean;
  isLeft: boolean;
}

type RelativeHeading = 'PARALLEL' | 'HEAD_ON' | 'PERPENDICULAR';

export default class BotSystem extends System {
  readonly key = 'bot';

  private inputBuffer: PlayerInputTickRingBuffer | null = null;
  private lastActionTick = new Map<number, number>();
  private actionCooldownTicks = 8;
  private sightDistance = 100;
  private strategies = new Map<number, Strategy>();
  private botEids: number[] = [];
  private room: ECSGameRoom;

  getComponents(): object[] {
    return [];
  }

  getBotCount(): number {
    return this.botEids.length;
  }

  init(room: ECSGameRoom): void {
    this.room = room;
    for (let i = 1; i <= BOT_COUNT; i++) {
      const botId = `bot${i}`;
      PlayerSystem.createPlayer(this.room, botId);
      PlayerSystem.spawnPlayer(this.room, botId, this.room.tick);
      const eid = PlayerSystem.getPlayerEidByStringId(this.room, botId);
      const strategy = randomStrategy();
      this.botEids.push(eid);
      this.strategies.set(eid, strategy);
      const displayName = randomName(strategy);
      logger.info(`Bot initialized: ${displayName} (Strategy: ${strategy})`);
    }
  }

  setInputBuffer(buffer: PlayerInputTickRingBuffer): void {
    this.inputBuffer = buffer;
  }

  update(getInput?: inputGetter, _getEvents?: eventGetter): void {
    if (!this.inputBuffer) return;

    const tick = this.room.tick;

    for (const eid of this.botEids) {
      if (!IsAlive[eid]) {
        this.room.serverAddEvent({
          type: GameEventType.PlayerSpawn,
          tick: this.room.tick,
          playerId: PlayerId[eid],
        });
        continue;
      }

      const playerId = PlayerId[eid];

      if (getInput?.(playerId)?.turn) continue;

      const lastTick = this.lastActionTick.get(eid) ?? 0;
      if (tick - lastTick < this.actionCooldownTicks) continue;

      const { distFront, distLeft, distRight } = this.computeDistances(eid);

      const nearestEnemyEid = this.getNearestEnemy(this.room, eid);
      const relPos = nearestEnemyEid !== null ? this.getRelativePosition(eid, nearestEnemyEid) : null;

      const strategy = this.strategies.get(eid) || 'CUT_OFF';

      let wantsToSlide = false;
      if (relPos) {
        if (strategy === 'SPEED_DEMON' || relPos.distance > 150) {
          if (TargetSpeedMult[eid] < 1.8 && (distLeft > 15 || distRight > 15)) {
            wantsToSlide = true;
          }
        }
      }

      let currentSightDistance = wantsToSlide ? 9.5 : this.sightDistance;

      if (distLeft < 20 && distRight < 20) {
        currentSightDistance = Math.max(currentSightDistance, 50);
      }

      // Phase 1: Survival override
      if (distFront < currentSightDistance) {
        let turn: 'left' | 'right';
        if (distLeft > distRight + 5) {
          turn = 'left';
        } else if (distRight > distLeft + 5) {
          turn = 'right';
        } else {
          turn = Math.random() > 0.5 ? 'left' : 'right';
        }
        this.room.serverAddInput({
          tick,
          playerId,
          break: false,
          turn,
        });
        this.lastActionTick.set(eid, tick);
        continue;
      }

      // Phase 2: Attack execution & trail seeking
      if (nearestEnemyEid !== null && relPos) {
        // Trail seeking for speed
        if (wantsToSlide && distLeft > 20 && distRight > 20) {
          if (distFront > 50) {
            if (distLeft < distRight && distLeft < 400) {
              this.room.serverAddInput({
                tick,
                playerId,
                break: false,
                turn: 'left',
              });
              this.lastActionTick.set(eid, tick + 18);
              continue;
            } else if (distRight < distLeft && distRight < 400) {
              this.room.serverAddInput({
                tick,
                playerId,
                break: false,
                turn: 'right',
              });
              this.lastActionTick.set(eid, tick + 18);
              continue;
            }
          }
        }

        this.executeAttackPhase(eid, nearestEnemyEid, distLeft, distRight, tick, playerId);
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private computeDistances(eid: number) {
    const sensorFront = new SharedLine();
    const sensorLeft = new SharedLine();
    const sensorRight = new SharedLine();
    buildDetectionLines(eid, sensorFront, sensorLeft, sensorRight);

    const selfLines = getPlayerTrailLines(eid);
    const obstacleLines = buildObstacleLinesExcluding(this.room, eid);
    const collisionLines = [...obstacleLines, ...selfLines];

    const pointFront = getClosestIntersectingPoint(sensorFront, collisionLines, Position.x[eid], Position.y[eid]);
    const pointLeft = getClosestIntersectingPoint(sensorLeft, collisionLines, Position.x[eid], Position.y[eid]);
    const pointRight = getClosestIntersectingPoint(sensorRight, collisionLines, Position.x[eid], Position.y[eid]);

    return {
      distFront: distanceBetween(Position.x[eid], Position.y[eid], pointFront.x, pointFront.y),
      distLeft: distanceBetween(Position.x[eid], Position.y[eid], pointLeft.x, pointLeft.y),
      distRight: distanceBetween(Position.x[eid], Position.y[eid], pointRight.x, pointRight.y),
    };
  }

  private getNearestEnemy(room: ECSGameRoom, selfEid: number): number | null {
    let nearest: number | null = null;
    let minDistance = Infinity;

    for (const eid of Array.from(query(room.world, [Player]))) {
      if (eid === selfEid || !IsAlive[eid]) continue;
      const dist = distanceBetween(Position.x[selfEid], Position.y[selfEid], Position.x[eid], Position.y[eid]);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = eid;
      }
    }
    return nearest;
  }

  private getRelativePosition(selfEid: number, enemyEid: number): RelativePosition {
    const dist = distanceBetween(Position.x[selfEid], Position.y[selfEid], Position.x[enemyEid], Position.y[enemyEid]);
    const angleToEnemy = angleBetween(
      Position.x[selfEid],
      Position.y[selfEid],
      Position.x[enemyEid],
      Position.y[enemyEid]
    );

    const normalizedBotDir = wrapAngle(Direction[selfEid]);
    const normalizedAngleToEnemy = wrapAngle(angleToEnemy);
    const angleDiff = wrapAngle(normalizedAngleToEnemy - normalizedBotDir);

    const isAhead = Math.abs(angleDiff) < Math.PI / 2;
    const isLeft = angleDiff < 0;

    return { distance: dist, angleDiff, isAhead, isLeft };
  }

  private getRelativeHeading(selfEid: number, enemyEid: number): RelativeHeading {
    const normalizedBotDir = wrapAngle(Direction[selfEid]);
    const normalizedEnemyDir = wrapAngle(Direction[enemyEid]);
    const headingDiff = Math.abs(wrapAngle(normalizedEnemyDir - normalizedBotDir));

    if (headingDiff < 0.5) return 'PARALLEL';
    if (headingDiff > Math.PI - 0.5) return 'HEAD_ON';
    return 'PERPENDICULAR';
  }

  private executeAttackPhase(
    eid: number,
    enemyEid: number,
    leftDist: number,
    rightDist: number,
    tick: number,
    playerId: string
  ): void {
    const relPos = this.getRelativePosition(eid, enemyEid);
    const relHeading = this.getRelativeHeading(eid, enemyEid);
    const strategy = this.strategies.get(eid) || 'CUT_OFF';

    // General tracking
    if (!relPos.isAhead) {
      if (relPos.isLeft && leftDist > 40) {
        this.room.serverAddInput({
          tick,
          playerId,
          break: false,
          turn: 'left',
        });
        this.lastActionTick.set(eid, tick);
        return;
      } else if (!relPos.isLeft && rightDist > 40) {
        this.room.serverAddInput({
          tick,
          playerId,
          break: false,
          turn: 'right',
        });
        this.lastActionTick.set(eid, tick);
        return;
      }
    }

    switch (strategy) {
      case 'CUT_OFF':
        if (relHeading === 'PARALLEL' && !relPos.isAhead && relPos.distance < 150) {
          if (relPos.isLeft && leftDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'left',
            });
            this.lastActionTick.set(eid, tick);
          } else if (!relPos.isLeft && rightDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.lastActionTick.set(eid, tick);
          }
        } else if (relHeading === 'PERPENDICULAR' && relPos.isAhead && relPos.distance < 150) {
          if (relPos.isLeft && leftDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'left',
            });
            this.lastActionTick.set(eid, tick);
          } else if (!relPos.isLeft && rightDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.lastActionTick.set(eid, tick);
          }
        }
        break;

      case 'BOX_IN':
        if (relHeading === 'PARALLEL' && relPos.distance < 200) {
          if (relPos.distance > 100 && relPos.distance < 150) {
            if (relPos.isLeft && leftDist > 100) {
              this.room.serverAddInput({
                tick,
                playerId,
                break: false,
                turn: 'left',
              });
              this.lastActionTick.set(eid, tick);
            } else if (!relPos.isLeft && rightDist > 100) {
              this.room.serverAddInput({
                tick,
                playerId,
                break: false,
                turn: 'right',
              });
              this.lastActionTick.set(eid, tick);
            }
          }
        } else if (relHeading === 'PERPENDICULAR' && relPos.distance < 150) {
          if (relPos.isLeft && leftDist > 30) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'left',
            });
            this.lastActionTick.set(eid, tick);
          } else if (!relPos.isLeft && rightDist > 30) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.lastActionTick.set(eid, tick);
          }
        }
        break;

      case 'SPEED_DEMON':
        if (TargetSpeedMult[eid] > 1.2 && relPos.distance < 200) {
          if (relPos.isLeft && leftDist > 20) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'left',
            });
            this.lastActionTick.set(eid, tick);
          } else if (!relPos.isLeft && rightDist > 20) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.lastActionTick.set(eid, tick);
          }
        }
        break;

      case 'TRAPPER':
        if (relHeading === 'PARALLEL' && !relPos.isAhead && relPos.distance < 80) {
          if (leftDist > rightDist && leftDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'left',
            });
            this.room.serverAddInput({
              tick: tick + 1,
              playerId,
              break: false,
              turn: 'left',
            });
          } else if (rightDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.room.serverAddInput({
              tick: tick + 1,
              playerId,
              break: false,
              turn: 'right',
            });
          }
          this.lastActionTick.set(eid, tick + 30);
        } else if (relPos.isAhead && relPos.distance > 150) {
          if (relPos.isLeft && leftDist > 50) {
            this.room.serverAddInput({
              tick: tick + 1,
              playerId,
              break: false,
              turn: 'left',
            });
            this.lastActionTick.set(eid, tick);
          } else if (!relPos.isLeft && rightDist > 50) {
            this.room.serverAddInput({
              tick,
              playerId,
              break: false,
              turn: 'right',
            });
            this.lastActionTick.set(eid, tick);
          }
        }
        break;
    }
  }
}
