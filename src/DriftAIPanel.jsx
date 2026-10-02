import { useState, useEffect, useCallback } from "react";

const API_BASE    = process.env.REACT_APP_API_URL;
const INSTANCE_ID = process.env.REACT_APP_INSTANCE_ID;
const REFRESH_INTERVAL = 30000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return "never";
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function SeverityBadge({ severity }) {
  const colors = {
    HIGH:   { bg: "#fff0f0", color: "#c0392b", border: "#e74c3c" },
    MEDIUM: { bg: "#fff8e1", color: "#e67e22", border: "#f39c12" },
    LOW:    { bg: "#f0fff4", color: "#27ae60", border: "#2ecc71" },
  };
  const s = colors[severity] || colors.LOW;
  return (
    <span style={{
      background:    s.bg,
      color:         s.color,
      border:        `1px solid ${s.border}`,
      borderRadius:  "4px",
      padding:       "2px 8px",
      fontSize:      "11px",
      fontWeight:    "700",
      letterSpacing: "0.5px",
    }}>
      {severity}
    </span>
  );
}

function StatusDot({ online }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span style={{
        width:        "10px",
        height:       "10px",
        borderRadius: "50%",
        background:   online ? "#2ecc71" : "#e74c3c",
        display:      "inline-block",
        boxShadow:    online ? "0 0 6px #2ecc71" : "0 0 6px #e74c3c",
        animation:    online ? "pulse 2s infinite" : "none",
      }} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function DriftEventCard({ event, type }) {
  const isActive = type === "active";
  return (
    <div style={{
      border:       `1px solid ${isActive ? "#e74c3c" : "#ddd"}`,
      borderLeft:   `4px solid ${isActive ? "#e74c3c" : "#2ecc71"}`,
      borderRadius: "8px",
      padding:      "12px 16px",
      marginBottom: "10px",
      background:   isActive ? "#fff8f8" : "#f9f9f9",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px" }}>
            {isActive ? "🔴" : "✅"} {event.resourceName}
          </div>
          <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>
            {event.driftType} · {event.resourceType}
          </div>
        </div>
        <SeverityBadge severity={event.severity} />
      </div>

      <div style={{
        display:             "grid",
        gridTemplateColumns: "1fr 1fr",
        gap:                 "8px",
        background:          "#f4f4f4",
        borderRadius:        "6px",
        padding:             "8px 12px",
        fontSize:            "12px",
        fontFamily:          "monospace",
        marginBottom:        "6px",
      }}>
        <div>
          <span style={{ color: "#888" }}>Expected: </span>
          <span style={{ color: "#27ae60", fontWeight: "600" }}>{event.expectedValue}</span>
        </div>
        <div>
          <span style={{ color: "#888" }}>Actual: </span>
          <span style={{ color: isActive ? "#e74c3c" : "#27ae60", fontWeight: "600" }}>
            {event.actualValue}
          </span>
        </div>
      </div>

      {event.detail && (
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>
          {event.detail}
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#aaa", display: "flex", gap: "16px" }}>
        <span>Detected: {timeAgo(event.detectedAt)}</span>
        {event.resolvedAt  && <span>Resolved: {timeAgo(event.resolvedAt)}</span>}
        {isActive          && <span>Last seen: {timeAgo(event.lastSeenAt)}</span>}
      </div>
    </div>
  );
}

// ── Derive agent online status ────────────────────────────────────────────────
const deriveAgentStatus = (agentData, statusData) => {
  const lastSeen =
    agentData?.lastHeartbeat      ||
    agentData?.lastSnapshot       ||
    statusData?.lastSnapshot      ||
    statusData?.snapshotTimestamp ||
    null;

  if (!lastSeen) return { online: false, lastSeen: "never" };

  const ageMs   = Date.now() - new Date(lastSeen).getTime();
  const ageMins = Math.floor(ageMs / 60000);
  const online  = ageMs < 3 * 60 * 1000;

  const label =
    ageMins === 0 ? "just now" :
    ageMins < 60  ? `${ageMins}m ago` :
                    `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`;

  return { online, lastSeen: label };
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function DriftAIPanel({ refreshTrigger }) {
  const [status,    setStatus]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [tab,       setTab]       = useState("active");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/agent/status?instanceId=${INSTANCE_ID}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
      setLastFetch(new Date().toISOString());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (refreshTrigger) {
      const timer = setTimeout(fetchStatus, 5000);
      return () => clearTimeout(timer);
    }
  }, [refreshTrigger, fetchStatus]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.title}>🛡️ DriftAI Monitor</span>
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "#888" }}>
          Loading drift status...
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.title}>🛡️ DriftAI Monitor</span>
        </div>
        <div style={{
          padding:      "20px",
          margin:       "16px",
          background:   "#fff0f0",
          borderRadius: "8px",
          border:       "1px solid #e74c3c",
          color:        "#c0392b",
        }}>
          ⚠️ Failed to fetch status: {error}
          <button onClick={fetchStatus} style={styles.retryBtn}>Retry</button>
        </div>
      </div>
    );
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  const isHealthy      = status?.overallStatus === "HEALTHY";
  const activeEvents   = status?.activeEvents   || [];
  const resolvedEvents = status?.resolvedEvents || [];
  const agent          = status?.agent          || {};
  const baseline       = status?.baseline       || {};
  const agentInfo      = deriveAgentStatus(agent, status);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.card}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.title}>🛡️ DriftAI Monitor</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", color: "#aaa" }}>
            Updated {timeAgo(lastFetch)}
          </span>
          <button onClick={fetchStatus} style={styles.refreshBtn}>↻ Refresh</button>
        </div>
      </div>

      {/* ── Status Banner ── */}
      <div style={{
        ...styles.banner,
        background:  isHealthy ? "#f0fff4" : "#fff0f0",
        borderColor: isHealthy ? "#2ecc71" : "#e74c3c",
      }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "700", color: isHealthy ? "#27ae60" : "#c0392b" }}>
            {isHealthy ? "✅" : "⚠️"} {isHealthy ? "HEALTHY" : "DRIFT DETECTED"}
          </div>
          <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
            {isHealthy
              ? "All services match baseline"
              : `${activeEvents.length} active drift event${activeEvents.length !== 1 ? "s" : ""} detected`}
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "#aaa", textAlign: "right" }}>
          <div>Instance</div>
          <div style={{ fontFamily: "monospace", color: "#555" }}>{INSTANCE_ID}</div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div style={styles.statsRow}>
        <div style={styles.statBox}>
          <div style={styles.statLabel}>Agent</div>
          <div style={{ ...styles.statValue, fontSize: "14px", paddingTop: "4px" }}>
            <StatusDot online={agentInfo.online} />
          </div>
          <div style={styles.statSub}>{agentInfo.lastSeen}</div>
        </div>

        <div style={styles.statBox}>
          <div style={styles.statLabel}>Active Drifts</div>
          <div style={{ ...styles.statValue, color: activeEvents.length > 0 ? "#e74c3c" : "#27ae60" }}>
            {activeEvents.length}
          </div>
          <div style={styles.statSub}>events</div>
        </div>

        <div style={styles.statBox}>
          <div style={styles.statLabel}>Resolved</div>
          <div style={{ ...styles.statValue, color: "#27ae60" }}>
            {resolvedEvents.length}
          </div>
          <div style={styles.statSub}>events</div>
        </div>

        <div style={styles.statBox}>
          <div style={styles.statLabel}>Baseline</div>
          <div style={{ ...styles.statValue, fontSize: "18px" }}>
            {baseline.exists ? "✅" : "❌"}
          </div>
          <div style={styles.statSub}>
            {baseline.exists ? timeAgo(baseline.createdAt) : "not set"}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={styles.tabBar}>
        {["active", "resolved"].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...styles.tabBtn,
              color:       tab === t ? "#3498db" : "#888",
              borderBottom: tab === t ? "2px solid #3498db" : "2px solid transparent",
              fontWeight:  tab === t ? "700" : "400",
            }}
          >
            {t === "active"
              ? `Active Drifts (${activeEvents.length})`
              : `Resolved (${resolvedEvents.length})`}
          </button>
        ))}
      </div>

      {/* ── Event List ── */}
      <div style={{ padding: "0 16px 16px" }}>
        {tab === "active" && (
          activeEvents.length === 0
            ? <div style={styles.emptyState}>✅ No active drift events</div>
            : activeEvents.map(e => (
                <DriftEventCard key={e.driftId} event={e} type="active" />
              ))
        )}
        {tab === "resolved" && (
          resolvedEvents.length === 0
            ? <div style={styles.emptyState}>No resolved events yet</div>
            : resolvedEvents.map(e => (
                <DriftEventCard key={e.driftId} event={e} type="resolved" />
              ))
        )}
      </div>

    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  card: {
    background:   "#fff",
    borderRadius: "12px",
    border:       "1px solid #e0e0e0",
    boxShadow:    "0 2px 12px rgba(0,0,0,0.08)",
    overflow:     "hidden",
    fontFamily:   "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "center",
    padding:        "16px 20px",
    borderBottom:   "1px solid #f0f0f0",
    background:     "#fafafa",
  },
  title: {
    fontSize:   "16px",
    fontWeight: "700",
    color:      "#1a1a2e",
  },
  banner: {
    display:        "flex",
    justifyContent: "space-between",
    alignItems:     "center",
    margin:         "16px",
    padding:        "16px 20px",
    borderRadius:   "10px",
    border:         "1px solid",
  },
  statsRow: {
    display:             "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap:                 "1px",
    background:          "#f0f0f0",
    borderTop:           "1px solid #f0f0f0",
    borderBottom:        "1px solid #f0f0f0",
    margin:              "0 16px 16px",
    borderRadius:        "8px",
    overflow:            "hidden",
  },
  statBox: {
    background: "#fff",
    padding:    "12px",
    textAlign:  "center",
  },
  statLabel: {
    fontSize:      "11px",
    color:         "#888",
    fontWeight:    "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom:  "4px",
  },
  statValue: {
    fontSize:   "22px",
    fontWeight: "700",
    color:      "#1a1a2e",
    lineHeight: "1.2",
  },
  statSub: {
    fontSize:  "11px",
    color:     "#aaa",
    marginTop: "2px",
  },
  tabBar: {
    display:      "flex",
    borderBottom: "1px solid #f0f0f0",
    padding:      "0 16px",
    marginBottom: "4px",
  },
  tabBtn: {
    background: "none",
    border:     "none",
    padding:    "10px 16px",
    cursor:     "pointer",
    fontSize:   "13px",
    transition: "all 0.2s",
  },
  emptyState: {
    textAlign:    "center",
    padding:      "30px",
    color:        "#888",
    fontSize:     "14px",
    background:   "#f9f9f9",
    borderRadius: "8px",
    border:       "1px dashed #ddd",
  },
  refreshBtn: {
    background:   "#3498db",
    color:        "#fff",
    border:       "none",
    borderRadius: "6px",
    padding:      "6px 12px",
    cursor:       "pointer",
    fontSize:     "12px",
    fontWeight:   "600",
  },
  retryBtn: {
    marginLeft:   "12px",
    background:   "#e74c3c",
    color:        "#fff",
    border:       "none",
    borderRadius: "6px",
    padding:      "4px 10px",
    cursor:       "pointer",
    fontSize:     "12px",
  },
};
