import Player from '../gameobjects/Player';

export default class BotController {
    player: Player;
    scene: Phaser.Scene;
    
    // How far the bot looks ahead to avoid obstacles
    sightDistance: number = 100;
    
    // AI Reaction limits
    lastActionTime: number = 0;
    actionCooldownMs: number = 400; // Limit to ~2.5 turns per second
    
    constructor(scene: Phaser.Scene, player: Player) {
        this.scene = scene;
        this.player = player;
    }

    update(time: number, _delta: number) {
        if (!this.player.isRunning) return;
        
        // Don't issue new commands if one is already pending
        if (this.player.turnQueue.length > 0) return;

        // Limit the number of turns the bot can make in a given timeframe
        if (time - this.lastActionTime < this.actionCooldownMs) return;

        let collisionLines = this.player._getLinesForCollision();
        
        let pointFront = this.player._getClosestIntersectingPoint(this.player.detectionLine, collisionLines);
        let pointLeft = this.player._getClosestIntersectingPoint(this.player.detectionLineLeft, collisionLines);
        let pointRight = this.player._getClosestIntersectingPoint(this.player.detectionLineRight, collisionLines);

        const frontDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, pointFront.x, pointFront.y);
        const leftDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, pointLeft.x, pointLeft.y);
        const rightDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, pointRight.x, pointRight.y);

        // Turn logic when an obstacle is detected within sight distance
        if (frontDistance < this.sightDistance) {
            // Decide which way to turn based on which side has more open space
            // Add a small threshold (e.g., 5 units) so it doesn't just jitter between left and right if they are nearly equal
            if (leftDistance > rightDistance + 5) {
                this.player.turn('left');
            } else if (rightDistance > leftDistance + 5) {
                this.player.turn('right');
            } else {
                // If roughly equal, pick a random direction
                if (Math.random() > 0.5) {
                    this.player.turn('left');
                } else {
                    this.player.turn('right');
                }
            }
            
            // Record the time of the action to enforce the cooldown
            this.lastActionTime = time;
        }
    }
}
