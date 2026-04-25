import * as Phaser from 'phaser';
import PlayerState from '../shared/PlayerState';

export default class BotController {
  // AI Personality
  strategy: 'CUT_OFF' | 'BOX_IN' | 'SPEED_DEMON' | 'TRAPPER' = 'CUT_OFF';
  targetPlayer: PlayerState | null = null;

  // How far the bot looks ahead to avoid obstacles
  sightDistance: number = 100;

  // AI Reaction limits
  lastActionTick: number = 0;
  actionCooldownTicks: number = 8; // roughly 130ms at 60Hz

  // State tracking
  isEvading: boolean = false;
  botName: string;

  constructor() {
    // Randomly assign a personality on spawn
    const strategies: ('CUT_OFF' | 'BOX_IN' | 'SPEED_DEMON' | 'TRAPPER')[] = [
      'CUT_OFF',
      'BOX_IN',
      'SPEED_DEMON',
      'TRAPPER',
    ];
    this.strategy = strategies[Math.floor(Math.random() * strategies.length)];

    const firstNames = [
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
    const titles = {
      CUT_OFF: 'The Slicer',
      BOX_IN: 'The Constrictor',
      SPEED_DEMON: 'The Demon',
      TRAPPER: 'The Trapper',
    };

    this.botName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${titles[this.strategy]}`;
    console.log(`Bot spawned: ${this.botName} (Strategy: ${this.strategy})`);
  }

  getNearestEnemy(
    player: PlayerState,
    allPlayers: PlayerState[]
  ): PlayerState | null {
    let nearest: PlayerState | null = null;
    let minDistance = Infinity;

    for (const p of allPlayers) {
      if (p === player || !p.isRunning) continue;

      const dist = Phaser.Math.Distance.Between(player.x, player.y, p.x, p.y);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = p;
      }
    }
    return nearest;
  }

  // Determine where the enemy is relative to the bot's current facing direction
  getRelativePosition(
    player: PlayerState,
    enemy: PlayerState
  ): {
    distance: number;
    angleDiff: number;
    isAhead: boolean;
    isLeft: boolean;
  } {
    const dist = Phaser.Math.Distance.Between(
      player.x,
      player.y,
      enemy.x,
      enemy.y
    );

    // Angle from bot to enemy
    const angleToEnemy = Phaser.Math.Angle.Between(
      player.x,
      player.y,
      enemy.x,
      enemy.y
    );

    // Normalize angles to -PI to PI
    let normalizedBotDir = Phaser.Math.Angle.Wrap(player.direction);
    let normalizedAngleToEnemy = Phaser.Math.Angle.Wrap(angleToEnemy);

    // Difference in angle
    let angleDiff = Phaser.Math.Angle.Wrap(
      normalizedAngleToEnemy - normalizedBotDir
    );

    const isAhead = Math.abs(angleDiff) < Math.PI / 2;
    const isLeft = angleDiff < 0;

    return { distance: dist, angleDiff, isAhead, isLeft };
  }

  // Determine if the enemy is driving parallel, head-on, or perpendicular
  getRelativeHeading(
    player: PlayerState,
    enemy: PlayerState
  ): 'PARALLEL' | 'HEAD_ON' | 'PERPENDICULAR' {
    let normalizedBotDir = Phaser.Math.Angle.Wrap(player.direction);
    let normalizedEnemyDir = Phaser.Math.Angle.Wrap(enemy.direction);

    let headingDiff = Math.abs(
      Phaser.Math.Angle.Wrap(normalizedEnemyDir - normalizedBotDir)
    );

    if (headingDiff < 0.5) return 'PARALLEL'; // roughly facing same way
    if (headingDiff > Math.PI - 0.5) return 'HEAD_ON'; // roughly facing opposite
    return 'PERPENDICULAR';
  }

  executeAttackPhase(
    player: PlayerState,
    enemy: PlayerState,
    leftDist: number,
    rightDist: number
  ) {
    const tick = player.currentTick;
    const relPos = this.getRelativePosition(player, enemy);
    const relHeading = this.getRelativeHeading(player, enemy);

    // General Tracking: Always try to turn towards the enemy if they are behind or to the side
    if (!relPos.isAhead) {
      // Enemy is behind us or to the side, we need to turn towards them
      // Only turn if we have some space to do so
      if (relPos.isLeft && leftDist > 40) {
        player.queueTurn('left');
        this.lastActionTick = tick;
        return;
      } else if (!relPos.isLeft && rightDist > 40) {
        player.queueTurn('right');
        this.lastActionTick = tick;
        return;
      }
    }

    switch (this.strategy) {
      case 'CUT_OFF':
        // Aggressive: If parallel, slightly ahead, and enemy is on a specific side, cut into their lane
        if (
          relHeading === 'PARALLEL' &&
          !relPos.isAhead &&
          relPos.distance < 150
        ) {
          // Enemy is behind/beside us and going the same way. Cut them off!
          if (relPos.isLeft && leftDist > 50) {
            player.queueTurn('left');
            this.lastActionTick = tick;
          } else if (!relPos.isLeft && rightDist > 50) {
            player.queueTurn('right');
            this.lastActionTick = tick;
          }
        } else if (
          relHeading === 'PERPENDICULAR' &&
          relPos.isAhead &&
          relPos.distance < 150
        ) {
          // Try to intercept if they are ahead and perpendicular
          if (relPos.isLeft && leftDist > 50) {
            player.queueTurn('left');
            this.lastActionTick = tick;
          } else if (!relPos.isLeft && rightDist > 50) {
            player.queueTurn('right');
            this.lastActionTick = tick;
          }
        }
        break;

      case 'BOX_IN':
        // Constrictor: Try to pin them to walls. Drive parallel and close the gap.
        if (relHeading === 'PARALLEL' && relPos.distance < 200) {
          // We just want to stay parallel and slowly encroach, not turn into them yet
          // If they are drifting away, try to turn towards them but be careful
          if (relPos.distance > 100 && relPos.distance < 150) {
            if (relPos.isLeft && leftDist > 100) {
              player.queueTurn('left');
              this.lastActionTick = tick;
            } else if (!relPos.isLeft && rightDist > 100) {
              player.queueTurn('right');
              this.lastActionTick = tick;
            }
          }
        } else if (relHeading === 'PERPENDICULAR' && relPos.distance < 150) {
          // Turn to match their heading
          if (relPos.isLeft && leftDist > 30) {
            player.queueTurn('left');
            this.lastActionTick = tick;
          } else if (!relPos.isLeft && rightDist > 30) {
            player.queueTurn('right');
            this.lastActionTick = tick;
          }
        }
        break;

      case 'SPEED_DEMON':
        // Drafter: We build up speed by hugging trails, then dive bomb when fast
        if (player.targetSpeed > 1.2 && relPos.distance < 200) {
          if (relPos.isLeft && leftDist > 20) {
            player.queueTurn('left');
            this.lastActionTick = tick;
          } else if (!relPos.isLeft && rightDist > 20) {
            player.queueTurn('right');
            this.lastActionTick = tick;
          }
        }
        break;

      case 'TRAPPER':
        // Baiter: If someone is right on our tail, drop a U-turn wall
        if (
          relHeading === 'PARALLEL' &&
          !relPos.isAhead &&
          relPos.distance < 80
        ) {
          // They are right behind us! Double turn!
          // Check which way is safer to U-turn
          if (leftDist > rightDist && leftDist > 50) {
            player.queueTurn('left');
            player.queueTurn('left'); // Queue second turn
          } else if (rightDist > 50) {
            player.queueTurn('right');
            player.queueTurn('right');
          }
          this.lastActionTick = tick + 30; // wait before doing it again (500ms)
        } else if (relPos.isAhead && relPos.distance > 150) {
          // try to get in front of them
          if (relPos.isLeft && leftDist > 50) {
            player.queueTurn('left');
            this.lastActionTick = tick;
          } else if (!relPos.isLeft && rightDist > 50) {
            player.queueTurn('right');
            this.lastActionTick = tick;
          }
        }
        break;
    }
  }

  update(
    player: PlayerState,
    allPlayers: PlayerState[],
    gameArea: { width: number; height: number }
  ) {
    if (!player.isRunning) {
      return;
    }

    const tick = player.currentTick;

    // Don't issue new commands if one is already pending
    if (player.turnQueue.length > 0) return;

    // Limit the number of turns the bot can make in a given timeframe
    if (tick - this.lastActionTick < this.actionCooldownTicks) return;

    const frontDistance = player.collisionDistanceFront;
    const leftDistance = player.collisionDistanceLeft;
    const rightDistance = player.collisionDistanceRight;

    this.targetPlayer = this.getNearestEnemy(player, allPlayers);
    let relPos = this.targetPlayer
      ? this.getRelativePosition(player, this.targetPlayer)
      : null;

    // Determine if we should actively seek trails for momentum
    let wantsToSlide = false;
    if (relPos) {
      if (this.strategy === 'SPEED_DEMON' || relPos.distance > 150) {
        // Don't seek speed if we are already very fast
        if (
          player.targetSpeed < 1.8 &&
          (leftDistance > 15 || rightDistance > 15)
        ) {
          wantsToSlide = true;
        }
      }
    }

    // Adjust sight distance to approach walls close enough for the slide boost (< 10 units)
    let currentSightDistance = wantsToSlide ? 9.5 : this.sightDistance;

    // Prevent trapping ourselves in narrow corridors
    if (leftDistance < 20 && rightDistance < 20) {
      currentSightDistance = Math.max(currentSightDistance, 50);
    }

    // Phase 1: Survival Override
    // Turn logic when an obstacle is detected within sight distance
    if (frontDistance < currentSightDistance) {
      this.isEvading = true;
      // Decide which way to turn based on which side has more open space
      // Add a small threshold (e.g., 5 units) so it doesn't just jitter between left and right if they are nearly equal
      if (leftDistance > rightDistance + 5) {
        player.queueTurn('left');
      } else if (rightDistance > leftDistance + 5) {
        player.queueTurn('right');
      } else {
        // If roughly equal, pick a random direction
        if (Math.random() > 0.5) {
          player.queueTurn('left');
        } else {
          player.queueTurn('right');
        }
      }

      // Record the time of the action to enforce the cooldown
      this.lastActionTick = tick;
      return; // Important: Evade and don't try to attack
    } else {
      this.isEvading = false;
    }

    // Phase 2: Attack Execution & Trail Seeking
    if (this.targetPlayer && relPos && !this.isEvading) {
      // Actively seek trails for momentum if we want to slide but aren't currently sliding
      if (wantsToSlide && leftDistance > 20 && rightDistance > 20) {
        // Ensure we have runway ahead so we don't crash immediately after turning toward the wall
        if (frontDistance > 50) {
          if (leftDistance < rightDistance && leftDistance < 400) {
            player.queueTurn('left');
            this.lastActionTick = tick + 18;
            return; // Execute seek move
          } else if (rightDistance < leftDistance && rightDistance < 400) {
            player.queueTurn('right');
            this.lastActionTick = tick + 18;
            return; // Execute seek move
          }
        }
      }

      // Always track and execute attack strategies
      this.executeAttackPhase(
        player,
        this.targetPlayer,
        leftDistance,
        rightDistance
      );
    }
  }
}
