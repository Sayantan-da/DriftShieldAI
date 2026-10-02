# DriftShield AI 🛡️
### Autonomic Cloud Compliance & Remediation Engine

DriftShield AI is an autonomic cloud compliance SaaS that continuously monitors massive enterprise server clusters to detect infrastructure configuration drift and instantly execute automated self-healing workflows. Built for the **Zero to Shipped Hackathon**, this platform replaces slow, manual infrastructure auditing with a reactive, event-driven, 100% serverless topology.

---

## 🏷️ Hackathon Credentials & Metadata
* **Submission Category:** `#workplace-efficiency`
* **Submission Lane:** `#startups` 
* **Live Public URL:** `https://amplifyapp.com` 
* **Coding Agent Utilized:** Amazon Q Developer

---

## ⚠️ The Problem
In modern enterprise environments, server configurations constantly change due to untracked manual updates, unauthorized overrides, or ad-hoc patches (**Configuration Drift**). Traditional management methods suffer from critical flaws:
* **The Vulnerability Window:** Compliance audits run on delayed schedules (daily/weekly), leaving clusters exposed for hours before anomalies are noticed.
* **Alert Fatigue:** Monitoring tools flood operations teams with duplicate alert logs for the exact same lingering issue.
* **Manual Operational Drain:** DevOps engineers waste thousands of high-value hours logging into servers to manually diagnose and re-apply golden configurations.

## 💡 The Solution
DriftShield AI converts infrastructure auditing from a slow, human-dependent process into a **reactive, self-healing event loop**:
* **Instantaneous Auto-Remediation:** Intercepts cluster anomalies instantly, classifies the drift type (Service, Network, Config, or Package), and triggers self-healing workflows in seconds.
* **Intelligent Deduplication:** Utilizes a composite primary key structure to track unique active states, preventing redundant alert logs.
* **Zero-Touch Workplace Efficiency:** Closes security vulnerabilities without human intervention, returning operational hours back to engineering teams.

---

## 🏗️ Technical Architecture

DriftShield AI is engineered entirely on a cloud-native, serverless AWS infrastructure to deliver sub-second telemetry synchronization at maximum operational scale.

| AWS Component | Tech Stack / Resource | Operational Role in DriftShield AI |
| :--- | :--- | :--- |
| **Presentation Layer** | **React** hosted on **AWS Amplify** | Global frontend control panel; serves the live public URL for system interaction. |
| **Ingestion Layer** | **Amazon API Gateway** | Exposes secure HTTP REST endpoints used by the React frontend to fetch cluster telemetry. |
| **Compute & Logic** | **AWS Lambda** (`index.js`) | Monolith backend handler; executes core `detectDrift()` logic and orchestrates healing workflows. |
| **Target Infrastructure**| **Amazon EC2** | Live managed server nodes actively monitored for unauthorized compliance drifts. |
| **Control Layer** | **AWS Systems Manager (SSM)** | Dispatches direct shell commands (`SendCommandCommand`) to target EC2 instances for auto-remediation. |
| **Data Persistence** | **Amazon DynamoDB** (4 Tables) | Isolated persistence layers: `DriftAI-Baselines`, `Snapshots`, `DriftEvents`, and `ComplianceResults`. |

---

## 🤖 Coding Agent Integration & Verification
We integrated **Amazon Q Developer** connected directly to our local IDE environment to compress a multi-week engineering pipeline into a rapid, continuous development cycle. The agent acted as an expert pair programmer by:
1. **Scaffolding State Logic:** Generating the baseline array comparison math for configuration types.
2. **Idempotent Data Access:** Designing the single-table composite schema (`instanceId#resourceType#resourceName`) and writing optimized AWS SDK v3 `@aws-sdk/lib-dynamodb` expressions.
3. **IAM Framework Generation:** Structuring granular AWS IAM security policies allowing Lambda safe execution access to AWS Systems Manager parameters.

### 💻 Core Engine Snippet: Drift Detection & Tracking

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// DRIFT DETECTOR: Evaluates baseline configuration state against active snapshot
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
      drifts.push({
        resourceType:  "SERVICE",
        resourceName:  svc,
        expectedValue: expected,
        actualValue:   actual,
        severity:      (svc === "nginx" || svc === "sshd") ? "HIGH" : "MEDIUM",
        driftType:     "SERVICE_DRIFT",
      });
    }
  }
  return drifts;
}

// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENT DYNAMODB EVENT TRACKING (Authored with Amazon Q Developer)
// ─────────────────────────────────────────────────────────────────────────────
async function upsertDriftEvent(instanceId, drift, overrides = {}) {
  const driftId = `${instanceId}#${drift.resourceType}#${drift.resourceName}`;
  const now     = new Date().toISOString();

  const existing = await dynamo.send(new GetCommand({
    TableName: "DriftAI-DriftEvents",
    Key: { instanceId, driftId },
  }));

  if (existing.Item && existing.Item.status === "active") {
    // Already active - update timestamp to mitigate duplicate alert generation
    await dynamo.send(new UpdateCommand({
      TableName: "DriftAI-DriftEvents",
      Key: { instanceId, driftId },
      UpdateExpression: "SET lastSeenAt = :t, actualValue = :av",
      ExpressionAttributeValues: { ":t": now, ":av": drift.actualValue },
    }));
  } else {
    // Brand new configuration drift discovery
    await dynamo.send(new PutCommand({
      TableName: "DriftAI-DriftEvents",
      Item: {
        instanceId, driftId, status: "active",
        resourceType: drift.resourceType, resourceName: drift.resourceName,
        expectedValue: drift.expectedValue, actualValue: drift.actualValue,
        severity: drift.severity, detectedAt: now, lastSeenAt: now
      },
    }));
  }
  return driftId;
}
```

---

## 🛠️ Local Environment Setup & Deployment

### Prerequisites
* Node.js v18+ installed
* AWS CLI configured with active administrator credentials
* Active EC2 instance with the AmazonSSMManagedInstanceCore role attached

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   npm install
   ```
2. Deploy backend cloud infrastructure to your active AWS region:
   ```bash
   # Make sure environment variables match your designated target tracking IDs
   export DYNAMODB_TABLE_NAME="ComplianceDriftResults"
   ```

### Frontend Dashboard Setup
1. Navigate to the frontend application:
   ```bash
   cd frontend
   npm install
   ```
2. Run the application locally or build it for AWS Amplify edge distribution:
   ```bash
   npm start
   ```

---
*Developed as a part of the Zero to Shipped hackathon to prove the power of autonomous AI-assisted development loops using Amazon Q Developer.*
