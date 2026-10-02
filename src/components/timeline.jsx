import { STATUS_CONFIG } from "./status";

export default function TimelineEntry({ entry, index }) {
  const cfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.HEALTHY;

  return (
    <div
      className="timeline-entry"
      style={{
        animationDelay: `${index * 0.12}s`,
      }}
    >
      <div
        className="timeline-icon"
        style={{
          background: `linear-gradient(135deg, ${cfg.color}22 0%, ${cfg.color}18 100%)`,
          border: `1px solid ${cfg.color}88`,
          color: cfg.color,
        }}
      >
        {cfg.icon}
      </div>

      <div className="timeline-content">
        <div className="timeline-head">
          <span style={{ color: cfg.color }}>{cfg.label}</span>
          <span>{new Date(entry.time).toLocaleTimeString()}</span>
        </div>
        <div className="timeline-detail">{entry.detail}</div>
      </div>
    </div>
  );
}
