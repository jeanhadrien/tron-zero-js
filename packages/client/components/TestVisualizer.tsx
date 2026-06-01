import { createSignal, onMount, onCleanup } from 'solid-js';
import { EventBus } from '../game/managers/EventBus';
import StartVisualizer from '../game/visualizer';
import { SCENARIO_REGISTRY } from '@tron0/shared/testing';

const SPEEDS = [
  { label: '0.5x', ms: 200 },
  { label: '1x', ms: 100 },
  { label: '2x', ms: 50 },
  { label: '4x', ms: 25 },
];

const TestVisualizer = () => {
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [tickIndex, setTickIndex] = createSignal(0);
  const [totalTicks, setTotalTicks] = createSignal(0);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [speedIdx, setSpeedIdx] = createSignal(1);
  const [loaded, setLoaded] = createSignal(false);

  let container!: HTMLDivElement;
  let game: Phaser.Game | null = null;

  const loadScenario = () => {
    if (game) {
      game.destroy(true);
      game = null;
    }

    const entry = SCENARIO_REGISTRY[selectedIdx()];
    if (!entry) return;

    const scenario = entry.fn({ record: true });
    const result = scenario.simulate();

    if (result.ticks.length === 0) return;

    setLoaded(true);

    requestAnimationFrame(() => {
      game = StartVisualizer('visualizer-container', result.ticks);
    });
  };

  const handleToggle = () => EventBus.emit('visualizer-toggle');
  const handleStepFwd = () => EventBus.emit('visualizer-step-fwd');
  const handleStepBack = () => EventBus.emit('visualizer-step-back');

  const handleSeek = (e: Event) => {
    const target = e.target as HTMLInputElement;
    EventBus.emit('visualizer-seek', parseInt(target.value, 10));
  };

  const handleSpeed = (idx: number) => {
    setSpeedIdx(idx);
    EventBus.emit('visualizer-speed', SPEEDS[idx].ms);
  };

  onMount(() => {
    const onUpdate = (status: { index: number; total: number; playing: boolean; speed: number }) => {
      setTickIndex(status.index);
      setTotalTicks(status.total);
      setIsPlaying(status.playing);
    };

    EventBus.on('visualizer-update', onUpdate);

    onCleanup(() => {
      EventBus.off('visualizer-update', onUpdate);
      if (game) {
        game.destroy(true);
        game = null;
      }
    });
  });

  const barStyle: Record<string, string> = {
    display: 'flex',
    gap: '8px',
    'align-items': 'center',
    'font-family': 'Courier New, monospace',
    'font-size': '13px',
    color: '#ccc',
    padding: '6px 10px',
    'background-color': 'rgba(0,0,0,0.85)',
    'border-bottom': '1px solid #333',
  };

  const btnStyle = (active = false) =>
    ({
      padding: '3px 10px',
      cursor: 'pointer',
      background: active ? '#444' : '#222',
      color: active ? '#0f0' : '#aaa',
      border: `1px solid ${active ? '#0f0' : '#555'}`,
      'border-radius': '3px',
      'font-family': 'Courier New, monospace',
      'font-size': '12px',
    }) as Record<string, string>;

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', width: '100%', height: '100vh' }}>
      {/* Top bar */}
      <div style={barStyle}>
        <select
          value={selectedIdx()}
          onChange={(e) => setSelectedIdx(parseInt(e.target.value, 10))}
          style={{
            background: '#222',
            color: '#ccc',
            border: '1px solid #555',
            padding: '3px 6px',
            'border-radius': '3px',
            'font-family': 'Courier New, monospace',
            'font-size': '12px',
          }}
        >
          {SCENARIO_REGISTRY.map((entry, i) => (
            <option value={i}>{entry.name}</option>
          ))}
        </select>

        <button onClick={loadScenario} style={btnStyle()}>
          Load
        </button>

        <div style={{ width: '1px', background: '#555', 'align-self': 'stretch', margin: '0 4px' }} />

        <button onClick={handleStepBack} disabled={!loaded()} style={btnStyle()}>
          ⏮
        </button>
        <button onClick={handleToggle} disabled={!loaded()} style={btnStyle(isPlaying())}>
          {isPlaying() ? '⏸' : '▶'}
        </button>
        <button onClick={handleStepFwd} disabled={!loaded()} style={btnStyle()}>
          ⏭
        </button>

        <div style={{ width: '1px', background: '#555', 'align-self': 'stretch', margin: '0 4px' }} />

        {SPEEDS.map((s, i) => (
          <button onClick={() => handleSpeed(i)} disabled={!loaded()} style={btnStyle(i === speedIdx())}>
            {s.label}
          </button>
        ))}

        <div style={{ width: '1px', background: '#555', 'align-self': 'stretch', margin: '0 4px' }} />

        <span style={{ 'min-width': '110px', 'text-align': 'right' }}>
          Tick: {tickIndex() + 1} / {totalTicks() || 0}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0, totalTicks() - 1)}
          value={tickIndex()}
          onInput={handleSeek}
          disabled={!loaded() || totalTicks() === 0}
          style={{ flex: 1, 'max-width': '300px', margin: '0 8px' }}
        />
      </div>

      {/* Phaser canvas */}
      <div
        id="visualizer-container"
        ref={container}
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
      >
        {!loaded() && (
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              height: '100%',
              color: '#555',
              'font-family': 'Courier New, monospace',
              'font-size': '14px',
            }}
          >
            Select a scenario and click Load
          </div>
        )}
      </div>
    </div>
  );
};

export default TestVisualizer;
