const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} = require("@aws-sdk/client-ssm");
const { randomUUID } = require("crypto");

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const REGION            = "ap-south-1";
const dynamo            = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ssm               = new SSMClient({ region: REGION });

const DYNAMODB_TABLE    = process.env.DYNAMODB_TABLE_NAME || "ComplianceDriftResults";
const EC2_INSTANCE_ID   = process.env.EC2_INSTANCE_ID;
const AGENT_SECRET      = process.env.AGENT_SECRET        || "driftai-secret-2024";
const HEARTBEAT_TIMEOUT = parseInt(process.env.HEARTBEAT_TIMEOUT_SECONDS || "180");

// ─────────────────────────────────────────────────────────────────────────────
// RESPOND HELPER
// ─────────────────────────────────────────────────────────────────────────────
const respond = (statusCode, data) => ({
  statusCode,
  headers: {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "https://main.d3m0b8eo4y01zy.amplifyapp.com",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  },
  body: JSON.stringify(data),
});

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT DETECTOR
// ─────────────────────────────────────────────────────────────────────────────
function detectDrift(baseline, current) {
  const drifts = [];

  const baseServices = baseline.services || {};
  const currServices = current.services  || {};
  const allServices  = new Set([...Object.keys(baseServices), ...Object.keys(currServices)]);

  for (const svc of allServices) {
    const expected = baseServices[svc];
    const actual   = currServices[svc];
    if (expected && actual && expected !== actual) {
      drifts.push({ resourceType: "SERVICE", resourceName: svc, expectedValue: expected, actualValue: actual, severity: (svc === "nginx" || svc === "sshd") ? "HIGH" : "MEDIUM", driftType: "SERVICE_DRIFT" });
    } else if (expected && !actual) {
      drifts.push({ resourceType: "SERVICE", resourceName: svc, expectedValue: expected, actualValue: "missing", severity: "HIGH", driftType: "SERVICE_DRIFT" });
    }
  }

  const basePorts    = (baseline.ports || []).map(String).sort();
  const currPorts    = (current.ports  || []).map(String).sort();
  const addedPorts   = currPorts.filter(p => !basePorts.includes(p));
  const removedPorts = basePorts.filter(p => !currPorts.includes(p));

  if (addedPorts.length > 0) {
    drifts.push({ resourceType: "NETWORK", resourceName: "listening_ports", expectedValue: basePorts.join(","), actualValue: currPorts.join(","), severity: "HIGH", driftType: "PORT_DRIFT", detail: `Unexpected ports opened: ${addedPorts.join(", ")}` });
  }
  if (removedPorts.length > 0) {
    drifts.push({ resourceType: "NETWORK", resourceName: "listening_ports", expectedValue: basePorts.join(","), actualValue: currPorts.join(","), severity: "MEDIUM", driftType: "PORT_DRIFT", detail: `Expected ports closed: ${removedPorts.join(", ")}` });
  }

  const baseHashes = baseline.configHashes || {};
  const currHashes = current.configHashes  || {};
  for (const [file, expectedHash] of Object.entries(baseHashes)) {
    const actualHash = currHashes[file];
    if (actualHash && actualHash !== expectedHash) {
      drifts.push({ resourceType: "CONFIGURATION", resourceName: file, expectedValue: expectedHash, actualValue: actualHash, severity: "HIGH", driftType: "CONFIGURATION_DRIFT" });
    }
  }

  const basePkgs = baseline.packages || {};
  const currPkgs = current.packages  || {};
  for (const [pkg, expectedVer] of Object.entries(basePkgs)) {
    const actualVer = currPkgs[pkg];
    if (actualVer && actualVer !== expectedVer) {
      drifts.push({ resourceType: "PACKAGE", resourceName: pkg, expectedValue: expectedVer, actualValue: actualVer, severity: "LOW", driftType: "APPLICATION_DRIFT" });
    }
  }

  return drifts;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASELINE STORE
// ─────────────────────────────────────────────────────────────────────────────
async function getBaseline(instanceId) {
  const result = await dynamo.send(new GetCommand({ TableName: "DriftAI-Baselines", Key: { instanceId } }));
  return result.Item || null;
}

async function saveBaseline(instanceId, snapshot) {
  await dynamo.send(new PutCommand({
    TableName: "DriftAI-Baselines",
    Item: { instanceId, baseline: snapshot, createdAt: new Date().toISOString(), approvedBy: "manual" },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT STORE
// ─────────────────────────────────────────────────────────────────────────────
async function saveSnapshot(instanceId, snapshot) {
  await dynamo.send(new PutCommand({
    TableName: "DriftAI-Snapshots",
    Item: { instanceId, snapshotTimestamp: new Date().toISOString(), snapshot, ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT EVENT STORE
// ─────────────────────────────────────────────────────────────────────────────
function makeDriftId(instanceId, resourceType, resourceName) {
  return `${instanceId}#${resourceType}#${resourceName}`;
}

async function upsertDriftEvent(instanceId, drift, overrides = {}) {
  const driftId = makeDriftId(instanceId, drift.resourceType, drift.resourceName);
  const now     = new Date().toISOString();

  const existing = await dynamo.send(new GetCommand({ TableName: "DriftAI-DriftEvents", Key: { instanceId, driftId } }));

  if (overrides.status) {
    await dynamo.send(new UpdateCommand({
      TableName: "DriftAI-DriftEvents",
      Key: { instanceId, driftId },
      UpdateExpression: `SET #st = :s, lastSeenAt = :t ${overrides.remediatedAt ? ", remediatedAt = :ra" : ""} ${overrides.remediationCmd ? ", remediationCmd = :rc" : ""} ${overrides.remediationOutput ? ", remediationOutput = :ro" : ""}`,
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":s": overrides.status, ":t": now,
        ...(overrides.remediatedAt      ? { ":ra": overrides.remediatedAt }      : {}),
        ...(overrides.remediationCmd    ? { ":rc": overrides.remediationCmd }    : {}),
        ...(overrides.remediationOutput ? { ":ro": overrides.remediationOutput } : {}),
      },
    }));
    return driftId;
  }

  if (existing.Item && existing.Item.status === "active") {
    await dynamo.send(new UpdateCommand({
      TableName: "DriftAI-DriftEvents",
      Key: { instanceId, driftId },
      UpdateExpression: "SET lastSeenAt = :t, actualValue = :av",
      ExpressionAttributeValues: { ":t": now, ":av": drift.actualValue },
    }));
  } else {
    await dynamo.send(new PutCommand({
      TableName: "DriftAI-DriftEvents",
      Item: { instanceId, driftId, resourceType: drift.resourceType, resourceName: drift.resourceName, expectedValue: drift.expectedValue, actualValue: drift.actualValue, severity: drift.severity, driftType: drift.driftType, detail: drift.detail || "", status: "active", detectedAt: now, lastSeenAt: now, resolvedAt: null },
    }));
  }

  return driftId;
}

async function resolveStaleEvents(instanceId, activeDriftIds) {
  const result = await dynamo.send(new QueryCommand({
    TableName: "DriftAI-DriftEvents",
    KeyConditionExpression: "instanceId = :id",
    FilterExpression: "#s = :active",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":id": instanceId, ":active": "active" },
  }));

  const now = new Date().toISOString();
  for (const event of result.Items || []) {
    if (!activeDriftIds.includes(event.driftId)) {
      await dynamo.send(new UpdateCommand({
        TableName: "DriftAI-DriftEvents",
        Key: { instanceId, driftId: event.driftId },
        UpdateExpression: "SET #s = :resolved, resolvedAt = :t",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":resolved": "resolved", ":t": now },
      }));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEARTBEAT
// ─────────────────────────────────────────────────────────────────────────────
async function updateHeartbeat(instanceId) {
  await dynamo.send(new PutCommand({
    TableName: "DriftAI-Baselines",
    Item: { instanceId: `heartbeat#${instanceId}`, lastHeartbeat: new Date().toISOString(), baseline: null },
  }));
}

async function getHeartbeat(instanceId) {
  const result = await dynamo.send(new GetCommand({ TableName: "DriftAI-Baselines", Key: { instanceId: `heartbeat#${instanceId}` } }));
  return result.Item?.lastHeartbeat || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REMEDIATION COMMANDS
// ─────────────────────────────────────────────────────────────────────────────
function buildRemediationCommands(drift) {
  const { driftType, resourceName } = drift;

  if (driftType === "SERVICE_DRIFT") {
    return [
      `echo "[REMEDIATING] Restarting service ${resourceName}..."`,
      `sudo systemctl start ${resourceName}`,
      `sudo systemctl enable ${resourceName}`,
      `STATUS=$(systemctl is-active ${resourceName})`,
      `echo "[REMEDIATED] ${resourceName} is now $STATUS"`,
    ];
  }

  // FIX: also kill the nc listener process, not just remove iptables rule
  if (driftType === "PORT_DRIFT") {
    return [
      `echo "[REMEDIATING] Closing unexpected port 4444..."`,
      `sudo iptables -D INPUT -p tcp --dport 4444 -j ACCEPT 2>/dev/null || true`,
      `sudo iptables -D INPUT -p udp --dport 4444 -j ACCEPT 2>/dev/null || true`,
      `sudo fuser -k 4444/tcp 2>/dev/null || true`,
      `echo "[REMEDIATED] Port 4444 closed and listener killed"`,
    ];
  }

  if (driftType === "CONFIGURATION_DRIFT" && resourceName === "/etc/passwd") {
    return [
      `echo "[REMEDIATING] Restoring ${resourceName} permissions..."`,
      `sudo chmod 644 ${resourceName}`,
      `sudo chown root:root ${resourceName}`,
      `PERMS=$(stat -c "%a" ${resourceName})`,
      `echo "[REMEDIATED] ${resourceName} permissions restored to $PERMS"`,
    ];
  }

  console.log(`[REMEDIATION] No automated fix for ${driftType} on ${resourceName}`);
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
async function handleSnapshot(body) {
  const { instanceId, snapshot, agentSecret } = body;
  if (!instanceId || !snapshot) return { statusCode: 400, body: { error: "instanceId and snapshot required" } };
  if (agentSecret !== AGENT_SECRET) return { statusCode: 401, body: { error: "Unauthorized" } };

  await saveSnapshot(instanceId, snapshot);
  await updateHeartbeat(instanceId);

  const baselineRecord = await getBaseline(instanceId);
  if (!baselineRecord) return { statusCode: 200, body: { status: "NO_BASELINE", message: "No baseline found. POST /agent/baseline to create one." } };

  const drifts         = detectDrift(baselineRecord.baseline, snapshot);
  const activeDriftIds = [];

  for (const drift of drifts) {
    const driftId = await upsertDriftEvent(instanceId, drift);
    activeDriftIds.push(driftId);
  }

  await resolveStaleEvents(instanceId, activeDriftIds);
  return { statusCode: 200, body: { status: drifts.length > 0 ? "DRIFT_DETECTED" : "HEALTHY", driftCount: drifts.length, drifts } };
}

async function handleRemediate(body) {
  const { instanceId, driftId } = body;
  if (!instanceId || !driftId) return { statusCode: 400, body: { error: "instanceId and driftId required" } };

  const result     = await dynamo.send(new GetCommand({ TableName: "DriftAI-DriftEvents", Key: { instanceId, driftId } }));
  const driftEvent = result.Item;
  if (!driftEvent) return { statusCode: 404, body: { error: "Drift event not found" } };

  const remediationCommands = buildRemediationCommands(driftEvent);
  if (remediationCommands.length === 0) return { statusCode: 400, body: { error: "No remediation available for this drift type" } };

  const cmd = await ssm.send(new SendCommandCommand({
    InstanceIds: [instanceId], DocumentName: "AWS-RunShellScript",
    Parameters: { commands: remediationCommands },
    Comment: `DriftAI remediation: ${driftEvent.driftType} on ${driftEvent.resourceName}`,
  }));

  await upsertDriftEvent(instanceId, driftEvent, { status: "REMEDIATING", remediationCmd: cmd.Command.CommandId, remediatedAt: new Date().toISOString() });
  return { statusCode: 200, body: { status: "REMEDIATING", commandId: cmd.Command.CommandId } };
}

async function handleBaseline(body) {
  const { instanceId, snapshot, agentSecret } = body;
  if (!instanceId || !snapshot) return { statusCode: 400, body: { error: "instanceId and snapshot required" } };
  if (agentSecret !== AGENT_SECRET) return { statusCode: 401, body: { error: "Unauthorized" } };

  await saveBaseline(instanceId, snapshot);
  return { statusCode: 200, body: { status: "BASELINE_SAVED", instanceId, savedAt: new Date().toISOString() } };
}

async function handleStatus(instanceId) {
  if (!instanceId) return { statusCode: 400, body: { error: "instanceId query param required" } };

  const eventsResult = await dynamo.send(new QueryCommand({
    TableName: "DriftAI-DriftEvents", KeyConditionExpression: "instanceId = :id",
    FilterExpression: "#s = :active", ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":id": instanceId, ":active": "active" },
  }));

  const resolvedResult = await dynamo.send(new QueryCommand({
    TableName: "DriftAI-DriftEvents", KeyConditionExpression: "instanceId = :id",
    FilterExpression: "#s = :resolved", ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":id": instanceId, ":resolved": "resolved" },
    Limit: 10, ScanIndexForward: false,
  }));

  const lastHeartbeat  = await getHeartbeat(instanceId);
  const heartbeatAge   = lastHeartbeat ? Math.floor((Date.now() - new Date(lastHeartbeat).getTime()) / 1000) : null;
  const agentOnline    = heartbeatAge !== null && heartbeatAge < HEARTBEAT_TIMEOUT;
  const baselineRecord = await getBaseline(instanceId);
  const activeEvents   = eventsResult.Items  || [];
  const resolvedEvents = resolvedResult.Items || [];

  return {
    statusCode: 200,
    body: {
      instanceId,
      overallStatus: activeEvents.length > 0 ? "DRIFT_DETECTED" : "HEALTHY",
      driftCount:    activeEvents.length,
      agent: { online: agentOnline, lastHeartbeat, heartbeatAge: heartbeatAge !== null ? `${heartbeatAge}s ago` : "never" },
      baseline: { exists: !!baselineRecord, createdAt: baselineRecord?.createdAt || null },
      activeEvents,
      resolvedEvents,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log("Event:", JSON.stringify(event));

  const method = event.requestContext?.http?.method || event.httpMethod;
  const path   = event.requestContext?.http?.path   || event.path;
  const body   = event.body ? JSON.parse(event.body) : {};
  const query  = event.queryStringParameters || {};

  if (method === "OPTIONS") {
    return respond(200, { message: "OK" });
  }

  try {
    if (method === "POST" && path === "/agent/snapshot") {
      const result = await handleSnapshot(body);
      return respond(result.statusCode, result.body);
    }
    if (method === "POST" && path === "/agent/baseline") {
      const result = await handleBaseline(body);
      return respond(result.statusCode, result.body);
    }
    if (method === "GET" && path === "/agent/status") {
      const result = await handleStatus(query.instanceId);
      return respond(result.statusCode, result.body);
    }
    if (method === "POST" && path === "/agent/remediate") {
      const result = await handleRemediate(body);
      return respond(result.statusCode, result.body);
    }

    if (method === "POST" && path === "/simulate-drift") {
      const { driftType } = body;
      const simulationId  = randomUUID();
      const now           = new Date().toISOString();

      let triggerCommands;
      if (driftType === "PORT_DRIFT") {
        // FIX: open real listener on 4444 so agent ss scan detects it
        triggerCommands = [
          `echo "[DRIFT TRIGGERED] Opening malicious listener on port 4444..."`,
          `sudo iptables -A INPUT -p tcp --dport 4444 -j ACCEPT`,
          `sudo nohup bash -c 'while true; do echo | nc -l 4444 2>/dev/null; done' &>/dev/null &`,
          `sleep 2`,
          `echo "[DONE] Port 4444 is now open and listening - agent will detect within 60s"`,
        ];
      } else if (driftType === "SERVICE_DRIFT") {
        triggerCommands = [
          `echo "[DRIFT TRIGGERED] Stopping nginx..."`,
          `sudo systemctl stop nginx`,
          `echo "[DONE] nginx stopped - agent will detect within 60s"`,
        ];
      } else {
        triggerCommands = [
          `echo "[DRIFT TRIGGERED] Changing /etc/passwd permissions..."`,
          `sudo chmod 777 /etc/passwd`,
          `echo "[DONE] Permissions changed - agent will detect within 60s"`,
        ];
      }

      const cmd       = await ssm.send(new SendCommandCommand({ InstanceIds: [EC2_INSTANCE_ID], DocumentName: "AWS-RunShellScript", Parameters: { commands: triggerCommands } }));
      const commandId = cmd.Command.CommandId;
      let triggerOutput = "";

      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: commandId, InstanceId: EC2_INSTANCE_ID }));
          if (["Success", "Failed", "Cancelled"].includes(inv.Status)) { triggerOutput = inv.StandardOutputContent || ""; break; }
        } catch (_) {}
      }

      const resourceName = driftType === "PORT_DRIFT" ? "listening_ports" : driftType === "SERVICE_DRIFT" ? "nginx" : "/etc/passwd";

      // FIX: status must be lowercase "active" to match handleStatus query filter
      await dynamo.send(new PutCommand({ TableName: "DriftAI-DriftEvents", Item: { driftId: simulationId, instanceId: EC2_INSTANCE_ID, driftType, status: "active", resourceName, simulationId, detectedAt: now, commandId, triggerOutput: triggerOutput.slice(0, 2000) } }));
      await dynamo.send(new PutCommand({ TableName: DYNAMODB_TABLE, Item: { instanceId: EC2_INSTANCE_ID, executionTimestamp: now, simulationId, driftType, status: "DRIFT_DETECTED", timestamp: now, commandId, rawOutput: triggerOutput.slice(0, 2000) } }));

      return respond(200, { simulationId, commandId, status: "DRIFT_TRIGGERED", message: "Drift triggered on EC2 - agent will detect and remediate within 60s", rawOutput: triggerOutput });
    }

    if (method === "GET" && path === "/drift-results") {
      const result = await dynamo.send(new QueryCommand({ TableName: DYNAMODB_TABLE, KeyConditionExpression: "instanceId = :id", ExpressionAttributeValues: { ":id": EC2_INSTANCE_ID }, ScanIndexForward: false, Limit: 20 }));
      return respond(200, { results: result.Items || [] });
    }

    return respond(404, { error: "Route not found" });

  } catch (err) {
    console.error("Handler error:", err);
    return respond(500, { error: err.message });
  }
};
