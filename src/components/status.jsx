const STATUS_CONFIG = {
  HEALTHY:        { color: "#1db954", label: "Healthy",        icon: "✅" },
  DRIFT_DETECTED: { color: "#e74c3c", label: "Drift Detected", icon: "🚨" },
  DRIFT_TRIGGERED:{ color: "#e67e22", label: "Drift Triggered", icon: "⚡" },
  REMEDIATING:    { color: "#f39c12", label: "Remediating...", icon: "⚙️" },
  REMEDIATED:     { color: "#1db954", label: "Remediated",     icon: "🛡️" },
  FAILED:         { color: "#e74c3c", label: "Failed",         icon: "❌" },
};

export { STATUS_CONFIG };

export default function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.HEALTHY;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 18px",
        borderRadius: 999,
        background: `linear-gradient(135deg, ${cfg.color}22 0%, ${cfg.color}10 100%)`,
        border: `1px solid ${cfg.color}88`,
        color: cfg.color,
        fontWeight: 800,
        fontSize: 15,
        boxShadow: `0 8px 22px ${cfg.color}22`,
      }}
    >
      <span style={{ fontSize: 18 }}>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </div>
  );
}
