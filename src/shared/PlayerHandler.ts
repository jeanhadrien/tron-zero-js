import GameArea from './GameArea';
import GameClock from './GameClock';
import { PlayerTrail } from './PlayerTrail';

interface Stateful<T, TArgs extends any[] = []> {
  tick: number;
  next(...args: TArgs): T;
}

interface HasTrail extends Stateful<HasTrail> {
  tail: PlayerTrail;
}

interface Serializable<TModel, TDto> {
  serialize(): TDto;
  deserialize(data: TDto): TModel;
}

class Tazeae
  implements Stateful<Tazeae>, HasTrail, Serializable<Tazeae, TazeaeDTO>
{
  name: string;
  tick: number;
  tail: PlayerTrail;
  constructor() {}
  next(clock: GameClock, area: GameArea): Tazeae {
    return new Tazeae();
  }
  serialize(): TazeaeDTO {
    return {
      name: 'ee',
    };
  }
  deserialize(): Tazeae {
    return new Tazeae();
  }
}

interface TazeaeDTO {
  name: string;
}
