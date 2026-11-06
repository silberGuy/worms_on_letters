import { useState } from 'react';

const MAX_HEIGHT = 360;

export function FlatView({ source, dropPoints, onDropPoint, onFile }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const dragProps = {
    onDragOver: (event) => {
      event.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: () => setIsDragging(false),
    onDrop: handleFileDrop,
  };

  if (!source) {
    return (
      <label className={`flat-view-empty${isDragging ? ' is-dragging' : ''}`} {...dragProps}>
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
        <strong>Choose a partly transparent image</strong>
        <span>or drag one here</span>
      </label>
    );
  }

  const handleClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onDropPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  return (
    <div
      className={`flat-view${isDragging ? ' is-dragging' : ''}`}
      style={{
        aspectRatio: `${source.width} / ${source.height}`,
        width: `min(100%, ${(MAX_HEIGHT * source.width) / source.height}px)`,
      }}
      onClick={handleClick}
      {...dragProps}
    >
      <img src={source.url} alt={source.name} draggable={false} />
      {dropPoints.map((point) => (
        <span key={point.id} className="drop-point" style={{ left: `${point.u * 100}%`, top: `${point.v * 100}%` }} />
      ))}
    </div>
  );
}
