export default function ControlPanel({
  driftType,
  onDriftTypeChange,
  onTrigger,
  onReset,
  loading,
  status,
}) {
  return (
    <div className="control-panel">
      <div className="control-label">Drift simulation</div>

      <div className="control-actions">
        <select
          value={driftType}
          onChange={(e) => onDriftTypeChange(e.target.value)}
          disabled={loading}
          className="drift-select"
        >
          <option value="PORT_DRIFT">🔓 Simulate Port Drift</option>
          <option value="PERMISSION_SHIFT">🔑 Simulate Permission Shift</option>
        </select>

        <button onClick={onTrigger} disabled={loading} className="primary-button">
          {loading ? "⚙️ Running..." : "🚨 Trigger Drift Simulation"}
        </button>

        {!loading && status !== "HEALTHY" && (
          <button onClick={onReset} className="secondary-button">
            ↺ Reset
          </button>
        )}
      </div>
    </div>
  );
}
