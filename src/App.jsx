import { useEffect, useRef, useState } from 'react';
import { CutoutField, WORLD_HEIGHT } from './cutoutField.js';
import { FlatView } from './FlatView.jsx';
import { loadSourceImage } from './sourceImage.js';
import { Stage } from './stage.js';
import { WormWorld } from './wormWorld.js';

const SIZE_VARIATION = 0.15;
const START_DEPTH_RANGE = 0.8;
const MAX_START_TILT = 0.175;

const percentOfHeight = (percent) => (percent / 100) * WORLD_HEIGHT;
const varied = (value) => value * (1 + (Math.random() * 2 - 1) * SIZE_VARIATION);

function Slider({ label, value, min, max, disabled, hint, format = (v) => `${v}%`, onChange }) {
  return (
    <label className={`control${disabled ? ' is-disabled' : ''}`}>
      <span className="control-label">
        {label}
        <output>{format(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function App() {
  const stageHost = useRef(null);
  const stage = useRef(null);
  const composition = useRef(null);
  const fileInput = useRef(null);

  const [source, setSource] = useState(null);
  const [dropPoints, setDropPoints] = useState([]);
  const [thickness, setThickness] = useState(12);
  const [length, setLength] = useState(33);
  const [wormThickness, setWormThickness] = useState(7);
  const [grip, setGrip] = useState(75);
  const [colour, setColour] = useState('#e8857f');
  const [background, setBackground] = useState('#e9e6df');
  const [projection, setProjection] = useState('perspective');
  const [exportEdge, setExportEdge] = useState(2048);
  const [transparentExport, setTransparentExport] = useState(false);
  const [message, setMessage] = useState('');

  const hasWorms = dropPoints.length > 0;

  useEffect(() => {
    const instance = new Stage(stageHost.current);
    stage.current = instance;
    return () => {
      instance.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    stage.current.setBackground(background);
  }, [background]);

  useEffect(() => {
    stage.current.setProjection(projection);
  }, [projection]);

  useEffect(() => {
    const worldThickness = percentOfHeight(thickness);
    stage.current.setThickness(worldThickness);
    composition.current?.world.setThickness(worldThickness);
  }, [thickness]);

  useEffect(() => {
    if (!hasWorms) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasWorms]);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);

  const openFile = async (file) => {
    if (hasWorms && !window.confirm('Start a new Composition? Your current worms will be lost.')) return;

    try {
      const image = await loadSourceImage(file);
      const field = new CutoutField(image.alpha);
      if (field.isEmpty) {
        URL.revokeObjectURL(image.url);
        setMessage(`"${image.name}" has no visible parts, so there is nothing to stand in 3D.`);
        return;
      }
      const worldThickness = percentOfHeight(thickness);
      const world = new WormWorld(field, worldThickness);
      composition.current = { field, world };
      stage.current.setComposition({ field, world, texture: image.texture, thickness: worldThickness });
      setSource(image);
      setDropPoints([]);
      setMessage(field.isFullyOpaque ? `"${image.name}" has no transparent parts, so it stands as a solid rectangle.` : '');
    } catch (error) {
      setMessage(error.message);
    }
  };

  const dropWorm = (u, v) => {
    const { field, world } = composition.current;
    const { x, y } = field.dropPointToWorld(u, v);
    const worm = world.drop({
      x,
      y,
      z: (Math.random() - 0.5) * percentOfHeight(thickness) * START_DEPTH_RANGE,
      heading: Math.random() * Math.PI * 2,
      tilt: (Math.random() * 2 - 1) * MAX_START_TILT,
      phase: Math.random() * Math.PI * 2,
      length: varied(percentOfHeight(length)),
      radius: varied(percentOfHeight(wormThickness)) / 2,
      grip: grip / 100,
    });
    stage.current.addWorm(worm, colour);
    setDropPoints((points) => [...points, { id: worm.id, u, v }]);
  };

  const undoLastWorm = () => {
    const last = dropPoints[dropPoints.length - 1];
    if (!last) return;
    composition.current.world.remove(last.id);
    stage.current.removeWorm(last.id);
    setDropPoints(dropPoints.slice(0, -1));
  };

  const clearWorms = () => {
    if (!window.confirm('Remove all worms? This can’t be undone.')) return;
    composition.current.world.clear();
    stage.current.clearWorms();
    setDropPoints([]);
  };

  const exportPng = async () => {
    try {
      const blob = await stage.current.exportPng({ longEdge: exportEdge, transparent: transparentExport });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${source.name.replace(/\.[^.]+$/, '')}-worms.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <div className="app">
      <main className="stage" ref={stageHost}>
        {!source && <p className="stage-hint">Your image will stand here.</p>}
      </main>

      <aside className="panel">
        <header className="panel-header">
          <h1>Worms on Letters</h1>
          <button type="button" className="link-button" onClick={() => fileInput.current.click()}>
            {source ? 'Change image' : 'Open image'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files[0];
              event.target.value = '';
              if (file) openFile(file);
            }}
          />
        </header>

        <section>
          <FlatView source={source} dropPoints={dropPoints} onDropPoint={dropWorm} onFile={openFile} />
          {source && <p className="note">Click to drop a worm.</p>}
          {message && (
            <p className="message" role="status">
              {message}
            </p>
          )}
        </section>

        <section>
          <h2>Next worm</h2>
          <Slider label="Length" value={length} min={10} max={80} onChange={setLength} />
          <Slider label="Thickness" value={wormThickness} min={2} max={14} onChange={setWormThickness} />
          <Slider label="Grip" value={grip} min={0} max={100} format={(v) => `${v}`} onChange={setGrip} />
          <label className="control control-row">
            <span>Colour</span>
            <input type="color" value={colour} onChange={(event) => setColour(event.target.value)} />
          </label>
        </section>

        <section>
          <h2>Worms</h2>
          <div className="button-row">
            <button type="button" disabled={!hasWorms} onClick={undoLastWorm}>
              Undo last worm
            </button>
            <button type="button" disabled={!hasWorms} onClick={clearWorms}>
              Clear all
            </button>
          </div>
        </section>

        <section>
          <h2>Cutout</h2>
          <Slider
            label="Thickness"
            value={thickness}
            min={2}
            max={40}
            disabled={hasWorms}
            hint={hasWorms ? 'Locked while there are worms. Clear all to change it.' : undefined}
            onChange={setThickness}
          />
        </section>

        <section>
          <h2>View</h2>
          <div className="segmented" role="group" aria-label="Camera projection">
            <button
              type="button"
              aria-pressed={projection === 'perspective'}
              onClick={() => setProjection('perspective')}
            >
              Perspective
            </button>
            <button
              type="button"
              aria-pressed={projection === 'orthographic'}
              onClick={() => setProjection('orthographic')}
            >
              Orthographic
            </button>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => stage.current.frontView()}>
              Front view
            </button>
          </div>
          <label className="control control-row">
            <span>Background</span>
            <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
          </label>
        </section>

        <section>
          <h2>Export PNG</h2>
          <label className="control control-row">
            <span>Long edge</span>
            <select value={exportEdge} onChange={(event) => setExportEdge(Number(event.target.value))}>
              <option value={1024}>1024 px</option>
              <option value={2048}>2048 px</option>
              <option value={4096}>4096 px</option>
            </select>
          </label>
          <label className="control control-row">
            <span>Transparent background</span>
            <input
              type="checkbox"
              checked={transparentExport}
              onChange={(event) => setTransparentExport(event.target.checked)}
            />
          </label>
          <div className="button-row">
            <button type="button" className="primary" disabled={!source} onClick={exportPng}>
              Export PNG
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
