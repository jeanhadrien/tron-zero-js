import { array, f32 } from 'bitecs/serialization';

import { addComponents, addEntity } from 'bitecs';
import { System } from '../interfaces/System';
import { ECSGameRoom } from '../ECSGameRoom';

export default class GameArea {
  width: number;
  height: number;

  constructor(width: number = 1000, height: number = 1000) {
    this.width = width;
    this.height = height;
  }
}

export const Arena = {};

export const AreaWidth = f32([]);
export const AreaHeight = f32([]);

export const Lines = {
  x1: array(f32),
  y1: array(f32),
  x2: array(f32),
  y2: array(f32),
};

export class GameArenaSystem implements System {
  readonly key = 'area';
  width: number;
  height: number;

  constructor(width: number = 1000, height: number = 1000) {
    this.width = width;
    this.height = height;
  }

  getComponents(): object[] {
    return [Arena, AreaWidth, AreaHeight, Lines];
  }

  init(room: ECSGameRoom): void {
    const eid = addEntity(room.world);
    addComponents(room.world, eid, this.getComponents());
    AreaWidth[eid] = this.width;
    AreaHeight[eid] = this.height;

    Lines.x1[eid] = [];
    Lines.y1[eid] = [];
    Lines.x2[eid] = [];
    Lines.y2[eid] = [];

    Lines.x1[eid][0] = 0;
    Lines.y1[eid][0] = 0;
    Lines.x2[eid][0] = this.width;
    Lines.y2[eid][0] = 0;

    Lines.x1[eid][1] = this.width;
    Lines.y1[eid][1] = 0;
    Lines.x2[eid][1] = this.width;
    Lines.y2[eid][1] = this.height;

    Lines.x1[eid][2] = this.width;
    Lines.y1[eid][2] = this.height;
    Lines.x2[eid][2] = 0;
    Lines.y2[eid][2] = this.height;

    Lines.x1[eid][3] = 0;
    Lines.y1[eid][3] = this.height;
    Lines.x2[eid][3] = 0;
    Lines.y2[eid][3] = 0;
  }
}
