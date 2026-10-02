import { useState, useRef, useEffect } from "react";
import StatusBadge from "./components/status";
import TimelineEntry from "./components/timeline";
import ControlPanel from "./components/ControlPanel";
import RawOutput from "./components/RawOutput";
import DriftAIPanel from "./DriftAIPanel";

const API_URL = process.env.REACT_APP_API_URL;

export default function DriftDashboard() {
  const [status, setStatus] = useState("HEALTHY");
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [simulationId, setSimulationId] = useState(null);
  const [commandId, setCommandId] = useState(null);
  const [rawOutput, setRawOutput] = useState("");
  const [driftType, setDriftType] = useState("PORT_DRIFT");
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState([
    { label: "Protected Assets", value: "—", tone: "#7c7cff" },
    { label: "Threat Score", value: "—", tone: "#2dd4bf" },
    { label: "Avg. Response", value: "—", tone: "#fbbf24" },
    { label: "Drift Events", value: "—", tone: "#fb7185" },
  ]);
  const timelineRef = useRef(null);

  const formatMetricValue = (value, type) => {
    if (value === null || value === undefined || value === "") return "—";

    if (type === "percent") {
      const num = Number(value);
      if (!Number.isNaN(num)) return `${Math.round(num).toString().padStart(2, "0")}%`;
      return String(value);
    }

    if (type === "response") {
      const num = Number(value);
      if (!Number.isNaN(num)) return `${Number(num).toFixed(1)}s`;
      return String(value);
    }

    if (type === "count") {
      const num = Number(value);
      if (!Number.isNaN(num)) return `${Math.round(num)}`;
      return String(value);
    }

    return String(value);
  };

  const updateMetricsFromResponse = (data, responseMs) => {
    const source =
      data?.metrics ||
      data?.summary ||
      data?.dashboard ||
      data?.stats ||
      {};

    const timelineCount = Array.isArray(data?.timeline) ? data.timeline.length : 0;
    const responseSeconds = responseMs ? Number((responseMs / 1000).toFixed(1)) : null;

    const nextMetrics = [
      {
        label: source.protectedAssets ?? source.protected_assets ?? source.totalAssets ?? source.total_assets
          ? "Protected Assets"
          : data?.affectedResource
            ? "Affected Resource"
            : "Protected Assets",
        value: formatMetricValue(
          source.protectedAssets ?? source.protected_assets ?? source.totalAssets ?? source.total_assets ?? data?.affectedResource,
          "count"
        ),
        tone: "#7c7cff",
      },
      {
        label: "Threat Score",
        value: formatMetricValue(
          source.threatScore ?? source.threat_score ?? source.riskScore ?? source.risk_score ?? null,
          "percent"
        ),
        tone: "#2dd4bf",
      },
      {
        label: "Avg. Response",
        value: formatMetricValue(
          source.avgResponse ?? source.avg_response ?? source.responseTime ?? source.response_time ?? responseSeconds,
          "response"
        ),
        tone: "#fbbf24",
      },
      {
        label: "Drift Events",
        value: formatMetricValue(
          source.driftEvents ?? source.drift_events ?? source.eventCount ?? source.event_count ?? timelineCount,
          "count"
        ),
        tone: "#fb7185",
      },
    ];

    setMetrics(nextMetrics);
  };

  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [timeline]);

  const handleTrigger = async () => {
  setLoading(true);
  setError(null);
  setTimeline([]);
  setRawOutput("");
  setCommandId(null);
  setSimulationId(null);

  const startedAt = Date.now();

  try {
    // ── Step 1: existing simulate-drift call ──────────────────────────────
    const resp = await fetch(`${API_URL}/simulate-drift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driftType }),
    });

    if (!resp.ok) {
      throw new Error(`API returned ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();

    setSimulationId(data.simulationId);
    setCommandId(data.commandId);
    setRawOutput(data.rawOutput ?? "");
    setStatus(data.status);
    updateMetricsFromResponse(data, Date.now() - startedAt);

    setTimeline([
      {
        status: data.status,
        time: new Date().toISOString(),
        detail:
          data.status === "REMEDIATED"
            ? "Configuration restored to golden baseline via SSM Run Command"
            : "Live remediation response received from backend",
      },
    ]);

    // ── Step 2: trigger REAL drift on EC2 via agent API ───────────────────
    try {
      const driftResp = await fetch(
        "https://yfzs8fy83c.execute-api.ap-south-1.amazonaws.com/agent/drift-trigger",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId:  "i-09de4b023ed572851",
            agentSecret: "driftai-secret-2024",
            driftType:   driftType,
          }),
        }
      );

      if (driftResp.ok) {
        const driftData = await driftResp.json();
        // Add drift trigger event to timeline
        setTimeline(prev => [
          ...prev,
          {
            status: "DRIFT_TRIGGERED",
            time:   new Date().toISOString(),
            detail: `Real drift triggered on EC2 — DriftAI panel will update in ~30s (${driftData?.message ?? driftType})`,
          },
        ]);
      }
    } catch (_) {
      // agent drift-trigger is optional — don't fail the whole simulation
    }

  } catch (err) {
    setError(err.message);
    setStatus("FAILED");
    setTimeline([
      {
        status: "FAILED",
        time:   new Date().toISOString(),
        detail: `Error: ${err.message}`,
      },
    ]);
  } finally {
    setLoading(false);
  }
};

  const handleReset = () => {
    setStatus("HEALTHY");
    setTimeline([]);
    setRawOutput("");
    setSimulationId(null);
    setCommandId(null);
    setError(null);
    setMetrics([
      { label: "Protected Assets", value: "—", tone: "#7c7cff" },
      { label: "Threat Score", value: "—", tone: "#2dd4bf" },
      { label: "Avg. Response", value: "—", tone: "#fbbf24" },
      { label: "Drift Events", value: "—", tone: "#fb7185" },
    ]);
  };

  return (
    <div className="app-shell">
      <div className="dashboard-header">
        <div>
          <div className="eyebrow">AWS Guardrail / Drift Defense</div>
          <h1>DriftShield Console</h1>
        </div>
        <div className="live-pill">
          <span className="live-dot" />
          Live monitoring
        </div>
      </div>

      <div className="metrics-grid">
        {metrics.map((metric) => (
          <div key={metric.label} className="metric-card">
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value" style={{ color: metric.tone }}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div className="panel panel-primary">
        <div className="panel-top">
          <div>
            <div className="eyebrow">System status</div>
            <h2>Compliance posture</h2>
          </div>
          <StatusBadge status={status} />
        </div>

        {simulationId && (
          <div className="meta-box">
            <div>
              Simulation: <span>{simulationId.slice(0, 8)}...</span>
            </div>
            {commandId && (
              <div>
                SSM Command: <span>{commandId.slice(0, 8)}...</span>
              </div>
            )}
          </div>
        )}

        {status === "REMEDIATING" && (
          <div className="notice notice-warning pulse">
            ⚙️ SSM Run Command executing on EC2 — restoring golden configuration...
          </div>
        )}

        {error && (
          <div className="notice notice-error">
            ❌ {error}
          </div>
        )}
      </div>

      <div className="panel">
        <ControlPanel
          driftType={driftType}
          onDriftTypeChange={setDriftType}
          onTrigger={handleTrigger}
          onReset={handleReset}
          loading={loading}
          status={status}
        />
      </div>

      {timeline.length > 0 && (
        <div className="panel">
          <div className="panel-header-small">Live event timeline</div>
          <div ref={timelineRef} className="timeline-box">
            {timeline.map((entry, i) => (
              <TimelineEntry key={i} entry={entry} index={i} />
            ))}
          </div>
        </div>
      )}

      <RawOutput output={rawOutput} commandId={commandId} />

    {/* ── DriftAI Live Monitor Panel ── */}
    <div style={{ marginTop: "24px" }}>
        <DriftAIPanel refreshTrigger={simulationId} />
      </div>

    </div>
  );
}
