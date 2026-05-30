import { ECSGameRoom } from '../../../shared/ECSGameRoom';
import { eventGetter, inputGetter, System } from '../../../shared/interfaces/System';

export class RendererSystem extends System {
  readonly key = 'renderer';

  getComponents(): object[] {
    return [];
  }
  update?(getInput: inputGetter, getEvents: eventGetter): void {
    throw new Error('Method not implemented.');
  }
  init?(room: ECSGameRoom): void {
    throw new Error('Method not implemented.');
  }
}
