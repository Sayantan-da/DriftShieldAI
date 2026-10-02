export default function RawOutput({ output, commandId }) {
  if (!output) return null;

  const colorLine = (line) => {
    if (line.includes("[DRIFT DETECTED]") || line.includes("[DRIFT]"))
      return "#f87171";
    if (line.includes("[REMEDIATING]"))
      return "#fbbf24";
    if (line.includes("[REMEDIATED]"))
      return "#34d399";
    if (line.startsWith("==="))
      return "#a78bfa";
    if (line.startsWith("---"))
      return "#94a3b8";
    return "#dbeafe";
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-title">🖥️ SSM Run Command Output</div>
        {commandId && (
          <div className="terminal-meta">
            Command ID: <span>{commandId}</span>
          </div>
        )}
      </div>

      <pre className="terminal-output">
        {output.split("\n").map((line, i) => (
          <span key={i} style={{ color: colorLine(line), display: "block" }}>
            {line || "\u00A0"}
          </span>
        ))}
      </pre>
    </div>
  );
}
