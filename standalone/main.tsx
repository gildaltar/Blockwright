import { StrictMode, Suspense, lazy, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import heroUrl from "../assets/github/blockwright-hero-v060.png";
import "./styles.css";

const ProceduralEditor = lazy(() => import("./editor"));

type ServiceStatus = {
  mode: "local" | "hosted";
  hostedReady: boolean;
  billingConfigured: boolean;
  registrationAccessRequired: boolean;
  supportEmail?: string;
  configurationIssues: string[];
  capabilities: { accounts: boolean; tenantStorage: boolean; deletion: boolean; checkout: boolean; invoices: boolean; refundRequests: boolean };
};

type Account = { email: string; tenantName: string; role: string; plan: string; sessionExpiresAt: string };
type ProjectSummary = { id: string; name: string; description?: string; updatedAt: string; versionCount: number; headVersionId?: string };
type ProjectVersionMetadata = {
  id: string;
  projectId: string;
  parentVersionId?: string;
  restoredFromVersionId?: string;
  reason: "manual" | "autosave" | "restore" | "region_revision";
  createdAt: string;
  contentHash: string;
};
type ProjectHeadSummary = ProjectVersionMetadata & {
  buildId: string;
  buildHash: string;
  blockCount: number;
  contractStatus: "valid" | "invalid";
};
type ProjectPage = {
  project: ProjectSummary & { private: true; createdAt: string };
  head?: ProjectHeadSummary;
  versions: ProjectVersionMetadata[];
  placements: { offset: number; limit: number; returned: number; total: number };
};
type ProjectDiff = {
  beforeVersionId: string;
  afterVersionId: string;
  beforeHash: string;
  afterHash: string;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  materialDeltaCount: number;
  materialDeltas: { offset: number; limit: number; returned: number; total: number; items: Array<{ state: string; delta: number; truncated?: true; stateSha256?: string }> };
  contractChanged: boolean;
  certificateChanged: boolean;
  detail: { offset: number; limit: number; returned: number; total: number };
};
type ReviewLink = { id: string; url: string; expiresAt: string; access: "read_only" };
type PublicReview = {
  project: { id: string; name: string; description?: string };
  version: {
    id: string;
    createdAt: string;
    build: {
      id: string;
      hash: string;
      input: { name: string; version: string; style: string; dimensions: { width: number; depth: number; height: number } };
      bounds: { dimensions: { width: number; depth: number; height: number } };
      placementCount: number;
      materialStateCount: number;
      primaryMaterials: Array<{ state: string; count: number; truncated?: true; stateSha256?: string }>;
      certificate?: { status: string };
    };
  };
  review: { id: string; expiresAt: string; decisions: Array<{ actorId: string; decision: string; comment?: string; createdAt: string }> };
};

const releasePage = "https://github.com/gildaltar/Blockwright/releases/tag/v0.6.0";
const releaseBase = "https://github.com/gildaltar/Blockwright/releases/download/v0.6.0";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({ error: `Request failed with HTTP ${response.status}.` })) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function App() {
  const reviewToken = /^#review=([A-Za-z0-9_-]{40,128})$/.exec(window.location.hash)?.[1];
  const [status, setStatus] = useState<ServiceStatus>();
  const [account, setAccount] = useState<Account>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectPage>();
  const [beforeVersionId, setBeforeVersionId] = useState("");
  const [afterVersionId, setAfterVersionId] = useState("");
  const [projectDiff, setProjectDiff] = useState<ProjectDiff>();
  const [issuedReviewLink, setIssuedReviewLink] = useState<ReviewLink>();
  const [publicReview, setPublicReview] = useState<PublicReview>();
  const [reviewerName, setReviewerName] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [formMode, setFormMode] = useState<"register" | "login">("register");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (reviewToken) return;
    api<ServiceStatus & { ok: true }>("/api/service/status")
      .then((next) => {
        setStatus(next);
        if (next.hostedReady) return api<{ account: Account }>("/api/me").then(async (result) => {
          setAccount(result.account);
          const query = new URLSearchParams(window.location.search);
          const checkout = query.get("checkout");
          const sessionId = query.get("session_id");
          if (checkout === "success" && sessionId) {
            try {
              await api("/api/billing/confirm", { method: "POST", body: JSON.stringify({ sessionId }) });
              const refreshed = await api<{ account: Account }>("/api/me");
              setAccount(refreshed.account);
              setMessage("Studio subscription confirmed.");
              window.history.replaceState({}, "", "/assets/blockwright/index.html#workspace");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Checkout confirmation is pending.");
            }
          } else if (checkout === "canceled") {
            setMessage("Checkout canceled; no plan change was recorded.");
            window.history.replaceState({}, "", "/assets/blockwright/index.html#pricing");
          }
          const projectResult = await api<{ projects: ProjectSummary[] }>("/api/projects").catch(() => ({ projects: [] }));
          setProjects(projectResult.projects);
        }).catch(() => undefined);
      })
      .catch(() => setStatus({ mode: "local", hostedReady: false, billingConfigured: false, registrationAccessRequired: false, configurationIssues: [], capabilities: { accounts: false, tenantStorage: false, deletion: false, checkout: false, invoices: false, refundRequests: false } }));
  }, []);

  useEffect(() => {
    if (!reviewToken) return;
    api<PublicReview & { ok: true }>(`/api/review/${reviewToken}`)
      .then(setPublicReview)
      .catch((error) => setMessage(error instanceof Error ? error.message : "This review link is unavailable."));
  }, [reviewToken]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const path = formMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api<{ account: Account }>(path, {
        method: "POST",
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          ...(formMode === "register" ? { tenantName: data.get("tenantName"), accessKey: data.get("accessKey") } : {}),
        }),
      });
      setAccount(result.account);
      const projectResult = await api<{ projects: ProjectSummary[] }>("/api/projects").catch(() => ({ projects: [] }));
      setProjects(projectResult.projects);
      setMessage(formMode === "register" ? "Private workspace created." : "Welcome back.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  async function beginCheckout() {
    setPending(true);
    try {
      const result = await api<{ checkoutUrl: string }>("/api/billing/checkout", { method: "POST", body: "{}" });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout is unavailable.");
      setPending(false);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setAccount(undefined);
    setProjects([]);
    setSelectedProject(undefined);
    setProjectDiff(undefined);
    setIssuedReviewLink(undefined);
    setMessage("Signed out.");
  }

  async function refreshProjects() {
    const result = await api<{ projects: ProjectSummary[] }>("/api/projects");
    setProjects(result.projects);
    return result.projects;
  }

  async function openProject(projectId: string, announce = true) {
    setPending(true);
    try {
      const result = await api<{ project: ProjectPage }>(`/api/projects/${encodeURIComponent(projectId)}?offset=0&limit=250`);
      setSelectedProject(result.project);
      setProjectDiff(undefined);
      setIssuedReviewLink(undefined);
      const versions = result.project.versions;
      setBeforeVersionId(versions.length > 1 ? versions[versions.length - 2].id : versions[0]?.id ?? "");
      setAfterVersionId(versions.at(-1)?.id ?? "");
      if (announce) setMessage(`Opened ${result.project.project.name}. Placement data is bounded to the first ${result.project.placements.limit.toLocaleString()} records.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be opened.");
    } finally {
      setPending(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    try {
      const result = await api<{ project: { project: ProjectSummary } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: data.get("projectName"), description: data.get("projectDescription") }),
      });
      form.reset();
      await refreshProjects();
      await openProject(result.project.project.id, false);
      setMessage("Private project created. Compile or revise a build in Blockwright, then autosave it into this immutable history.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function compareVersions() {
    if (!selectedProject || !beforeVersionId || !afterVersionId || beforeVersionId === afterVersionId) {
      setMessage("Choose two different project versions to compare.");
      return;
    }
    setPending(true);
    try {
      const query = new URLSearchParams({ before: beforeVersionId, after: afterVersionId, offset: "0", limit: "100" });
      const result = await api<{ diff: ProjectDiff }>(`/api/projects/${encodeURIComponent(selectedProject.project.id)}/diff?${query}`);
      setProjectDiff(result.diff);
      setMessage(`Compared ${result.diff.detail.total.toLocaleString()} exact placement change${result.diff.detail.total === 1 ? "" : "s"}; detail is bounded to ${result.diff.detail.limit.toLocaleString()} records.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project versions could not be compared.");
    } finally {
      setPending(false);
    }
  }

  async function restoreProjectVersion(versionId: string) {
    if (!selectedProject?.head || !window.confirm("Restore this immutable version as a new project head? Existing history will remain unchanged.")) return;
    setPending(true);
    try {
      await api(`/api/projects/${encodeURIComponent(selectedProject.project.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionId, expectedHeadVersionId: selectedProject.head.id }),
      });
      await refreshProjects();
      await openProject(selectedProject.project.id, false);
      setMessage("The selected version was restored as a new immutable head. No history was overwritten.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The version could not be restored.");
    } finally {
      setPending(false);
    }
  }

  async function createReviewLink() {
    if (!selectedProject?.head) {
      setMessage("Save a build version before creating a client review link.");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ link: ReviewLink }>(`/api/projects/${encodeURIComponent(selectedProject.project.id)}/review-links`, {
        method: "POST",
        body: JSON.stringify({ versionId: selectedProject.head.id, expiresInSeconds: 7 * 24 * 60 * 60 }),
      });
      setIssuedReviewLink(result.link);
      setMessage("A seven-day client review link was created for the exact current build hash.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review link could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function deleteProject(projectId: string) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!window.confirm(`Permanently delete ${project?.name ?? "this project"}, its versions, and its review links?`)) return;
    setPending(true);
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      setSelectedProject(undefined);
      setProjectDiff(undefined);
      setIssuedReviewLink(undefined);
      await refreshProjects();
      setMessage("Project, immutable versions, and dependent review links deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  async function openBillingPortal() {
    setPending(true);
    try {
      const result = await api<{ portalUrl: string }>("/api/billing/portal", { method: "POST", body: "{}" });
      window.location.assign(result.portalUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Billing management is unavailable.");
      setPending(false);
    }
  }

  async function showInvoices() {
    setPending(true);
    try {
      const result = await api<{ invoices: unknown[] }>("/api/billing/invoices");
      setMessage(result.invoices.length ? `${result.invoices.length} recent invoice(s) are available from your billing portal.` : "No invoices are available yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invoices are unavailable.");
    } finally {
      setPending(false);
    }
  }

  async function requestRefund() {
    const reason = window.prompt("Briefly describe the charge you want support to review.");
    if (!reason?.trim()) return;
    setPending(true);
    try {
      await api("/api/billing/refund-request", { method: "POST", body: JSON.stringify({ reason }) });
      setMessage("Refund review requested. Support will confirm any actual refund separately.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The refund request could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  async function deleteWorkspace() {
    if (!window.confirm("Permanently delete this Blockwright workspace, including its projects, versions, sessions, review links, and billing records?")) return;
    setPending(true);
    try {
      await api("/api/me", { method: "DELETE" });
      setAccount(undefined);
      setProjects([]);
      setSelectedProject(undefined);
      setMessage("Workspace deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workspace deletion failed.");
    } finally {
      setPending(false);
    }
  }

  async function recordReviewDecision(decision: "approved" | "changes_requested") {
    if (!reviewToken || !reviewerName.trim()) {
      setMessage("Enter your name before recording a decision.");
      return;
    }
    setPending(true);
    try {
      await api(`/api/review/${reviewToken}/decision`, {
        method: "POST",
        body: JSON.stringify({ actorId: reviewerName, decision, ...(reviewComment.trim() ? { comment: reviewComment } : {}) }),
      });
      const refreshed = await api<PublicReview & { ok: true }>(`/api/review/${reviewToken}`);
      setPublicReview(refreshed);
      setReviewComment("");
      setMessage(decision === "approved" ? "Approval recorded for this exact build hash." : "Change request recorded for this exact build hash.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review decision could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  if (reviewToken) {
    const build = publicReview?.version.build;
    const materials = build?.primaryMaterials ?? [];
    return <main className="review-page">
      <header className="review-header"><a className="brand" href="/assets/blockwright/index.html"><BrandMark /><span>Blockwright</span><small>CLIENT REVIEW</small></a></header>
      <section className="review-shell">
        <p className="eyebrow"><span /> Immutable client review</p>
        <h1>{publicReview?.project.name ?? "Loading review…"}</h1>
        {!publicReview ? <div className="review-card"><p>{message || "Resolving the exact project version and build hash…"}</p></div> : <>
          <div className="review-stats">
            <div><small>BUILD</small><strong>{build!.input.name}</strong></div>
            <div><small>JAVA TARGET</small><strong>{build!.input.version}</strong></div>
            <div><small>PLACEMENTS</small><strong>{build!.placementCount.toLocaleString()}</strong></div>
            <div><small>ENVELOPE</small><strong>{build!.bounds.dimensions.width}×{build!.bounds.dimensions.depth}×{build!.bounds.dimensions.height}</strong></div>
          </div>
          <div className="review-grid">
            <article className="review-card">
              <small>VERIFIED SNAPSHOT</small>
              <h2>{build!.certificate?.status === "valid" ? "Contract valid" : "Review the contract boundary"}</h2>
              <p>{publicReview.project.description || `${build!.input.style} build, frozen at version ${publicReview.version.id}.`}</p>
              <code className="hash">SHA-256 {build!.hash}</code>
              <p className="expires">Link expires {new Date(publicReview.review.expiresAt).toLocaleString()}.</p>
            </article>
            <article className="review-card materials-card">
              <small>PRIMARY MATERIALS</small>
              {materials.map(({ state, count, truncated, stateSha256 }, index) => <div key={stateSha256 ?? `${state}-${index}`}><code title={truncated ? `Full state SHA-256: ${stateSha256}` : undefined}>{state}{truncated ? "…" : ""}</code><b>{count.toLocaleString()}</b></div>)}
            </article>
          </div>
          <div className="review-card decision-card">
            <small>HASH-BOUND DECISION</small>
            <p className="identity-note">Your name is self-entered. Blockwright binds this decision to the private review link and exact build hash, but does not claim to verify your legal identity.</p>
            <label>Your name<input value={reviewerName} maxLength={256} onChange={(event) => setReviewerName(event.target.value)} /></label>
            <label>Comment (optional)<input value={reviewComment} maxLength={4000} onChange={(event) => setReviewComment(event.target.value)} /></label>
            <div className="decision-actions"><button className="button primary" disabled={pending} onClick={() => recordReviewDecision("approved")}>Approve this version</button><button className="button secondary" disabled={pending} onClick={() => recordReviewDecision("changes_requested")}>Request changes</button></div>
            {message && <p className="form-message" role="status">{message}</p>}
            {publicReview.review.decisions.length > 0 && <p className="decision-count">{publicReview.review.decisions.length} decision event(s) recorded for this review link.</p>}
          </div>
        </>}
      </section>
      <footer><span>Read-only Blockwright review · exact project version</span><span>Not official or associated with Mojang or Microsoft.</span></footer>
    </main>;
  }

  return <>
    <header className="site-header">
      <a className="brand" href="#top"><BrandMark /><span>Blockwright</span><small>0.6</small></a>
      <nav aria-label="Primary navigation">
        <a href="#editor">Editor</a>
        <a href="#workflow">Workflow</a>
        <a href="#proof">Proof</a>
        <a href="#pricing">Pricing</a>
        <a href="#get-blockwright">Get Blockwright</a>
      </nav>
    </header>

    <main id="top">
      <section className="hero">
        <img className="hero-art" src={heroUrl} alt="Original voxel pavilion emerging from blueprint layers with a verified check symbol" />
        <div className="hero-shade" />
        <div className="hero-copy">
          <p className="eyebrow"><span /> Build brief → verified Java schematic</p>
          <h1>Build boldly.<br /><em>Deliver with evidence.</em></h1>
          <p className="lede">Blockwright turns measurable Minecraft Java briefs into deterministic, reviewable, client-ready schematics—or tells you exactly why it cannot.</p>
          <div className="hero-actions">
            <a className="button primary" href={`${releaseBase}/Blockwright-0.6.0-windows-x64-setup.exe`}>Download unsigned Windows MVP</a>
            <a className="button secondary" href={`${releaseBase}/Blockwright-0.6.0-windows-x64-portable.zip`}>Portable version</a>
          </div>
          <p className="release-warning"><strong>Unsigned Windows prerelease.</strong> SmartScreen may report an unknown publisher. Use only the <a href={releasePage}>official v0.6.0 release</a>, verify the download against its <code>SHA256SUMS.txt</code>, and choose <b>More info → Run anyway</b> only if the hash matches and you trust this repository. A checksum is not a publisher signature.</p>
          <p className="boundary">Java-first · private local runtime · Sponge v3 + Litematica · independent project</p>
        </div>
      </section>

      <section className="promise" aria-label="Product promise">
        <p>Not another prompt-to-build toy.</p>
        <h2>One professional path from exact brief to approved delivery.</h2>
        <div className="promise-grid">
          <article><b>01</b><h3>Contract</h3><p>Hard requirements become executable clauses. Unsupported demands fail before they become false promises.</p></article>
          <article><b>02</b><h3>Compile</h3><p>Seeded placements, exact registry provenance, and immutable hashes keep every revision reproducible.</p></article>
          <article><b>03</b><h3>Audit</h3><p>Entrances, circulation, interiors, lighting, support, palette legality, budget, and compatibility are checked globally.</p></article>
          <article><b>04</b><h3>Deliver</h3><p>Schematic, material list, origin instructions, checksums, approval, and certificate leave in one client bundle.</p></article>
        </div>
      </section>

      <section className="workflow" id="workflow">
        <div className="section-copy">
          <p className="eyebrow"><span /> The professional loop</p>
          <h2>Every revision remains accountable.</h2>
          <p>Projects autosave immutable versions. Compare block-level changes, revise an inclusive region without touching the rest, restore a prior version as a new head, and collect an expiring client decision.</p>
        </div>
        <ol className="timeline">
          <li><strong>Define</strong><span>dimensions · entrances · rooms · palette · limits</span></li>
          <li><strong>Generate</strong><span>deterministic plan · exact blocks · visible seed</span></li>
          <li><strong>Review</strong><span>state-aware 3D · annotations · whole-build audit</span></li>
          <li><strong>Approve</strong><span>expiring link · approved / changes requested</span></li>
          <li><strong>Ship</strong><span>.schem · .litematic · material list · certificate</span></li>
        </ol>
      </section>

      <section className="proof" id="proof">
        <p className="eyebrow"><span /> Claims have receipts</p>
        <h2>A certificate is only as good as its boundary.</h2>
        <div className="proof-card">
          <div><small>BUILD HASH</small><code>SHA-256 · immutable</code></div>
          <div><small>CONTRACT</small><code>hard · warning · aesthetic</code></div>
          <div><small>ROUND TRIP</small><code>exact versions named</code></div>
          <div><small>ORIGIN</small><code>rotation · offset · paste guide</code></div>
        </div>
        <p className="truth-note">Compatibility appears here only after the exact Java, WorldEdit, and Litematica combination has been exercised. Demonstrations are labeled; customer stories are never invented.</p>
      </section>

      <section className="pricing" id="pricing">
        <div>
          <p className="eyebrow"><span /> Local-first, studio-ready</p>
          <h2>Start on your PC. Add service only when you need it.</h2>
          <p>The Windows and portable releases keep the private Node runtime and build data on-device. A hosted Studio workspace adds private projects, client review, billing, and browser access only when the operator has configured those services.</p>
        </div>
        <div className="price-card">
          <small>FOUNDING STUDIO</small>
          <strong><sup>$</sup>49<span>/mo</span></strong>
          <ul><li>Private professional projects</li><li>Immutable history and client approvals</li><li>Delivery bundles and commercial workflow</li><li>Invoices and cancellation portal</li></ul>
          {account
            ? <button className="button primary full" onClick={account.plan === "studio" ? openBillingPortal : beginCheckout} disabled={pending || !status?.billingConfigured}>{status?.billingConfigured ? account.plan === "studio" ? "Manage Studio plan" : "Open secure checkout" : "Checkout not configured"}</button>
            : <a className="button primary full" href="#workspace">Create workspace</a>}
          <p className="fine-print">The page never claims billing is live unless the provider is configured.</p>
        </div>
      </section>

      <section className="workspace" id="workspace">
        <div>
          <p className="eyebrow"><span /> Browser onboarding</p>
          <h2>{account ? `Welcome, ${account.tenantName}.` : "Create your private workspace."}</h2>
          <p>{status?.hostedReady ? "Hosted identity and tenant storage are ready on this instance." : "This instance is running in local mode. Your builds stay on this PC, and hosted account controls remain visibly unavailable."}</p>
          {status?.supportEmail && <p>Support: <a href={`mailto:${status.supportEmail}`}>{status.supportEmail}</a></p>}
        </div>
        <div className="auth-card">
          {account ? <>
            <dl><div><dt>Account</dt><dd>{account.email}</dd></div><div><dt>Plan</dt><dd>{account.plan}</dd></div><div><dt>Access</dt><dd>{account.role}</dd></div></dl>
            <form className="project-create" onSubmit={createProject}>
              <small>NEW PRIVATE PROJECT</small>
              <label>Project name<input name="projectName" minLength={1} maxLength={120} required disabled={pending} /></label>
              <label>Description<input name="projectDescription" maxLength={2000} disabled={pending} /></label>
              <button className="button secondary full" disabled={pending}>Create project</button>
            </form>
            <div className="project-summary">
              <small>PRIVATE PROJECTS</small>
              {projects.length ? projects.map((project) => <button className={selectedProject?.project.id === project.id ? "project-row active" : "project-row"} key={project.id} onClick={() => openProject(project.id)} disabled={pending}><span>{project.name}</span><b>{project.versionCount} version{project.versionCount === 1 ? "" : "s"}</b></button>) : <p>No projects saved yet. Create the first private project above.</p>}
            </div>
            {selectedProject && <section className="project-console" aria-label="Selected project">
              <div className="project-console-head">
                <div><small>SELECTED PROJECT</small><strong>{selectedProject.project.name}</strong><p>{selectedProject.project.description || "No description supplied."}</p></div>
                {account.role === "owner" && <button className="danger-link compact" onClick={() => deleteProject(selectedProject.project.id)} disabled={pending}>Delete project</button>}
              </div>
              {selectedProject.head ? <>
                <div className="project-stats">
                  <span><small>HEAD</small><b>{selectedProject.head.id.slice(0, 12)}</b></span>
                  <span><small>CONTRACT</small><b className={selectedProject.head.contractStatus}>{selectedProject.head.contractStatus}</b></span>
                  <span><small>BLOCKS</small><b>{selectedProject.head.blockCount.toLocaleString()}</b></span>
                </div>
                <div className="version-controls">
                  <label>Before<select value={beforeVersionId} onChange={(event) => setBeforeVersionId(event.target.value)}>{selectedProject.versions.map((version) => <option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.reason}</option>)}</select></label>
                  <label>After<select value={afterVersionId} onChange={(event) => setAfterVersionId(event.target.value)}>{selectedProject.versions.map((version) => <option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString()} · {version.reason}</option>)}</select></label>
                  <button className="button secondary full" onClick={compareVersions} disabled={pending || selectedProject.versions.length < 2}>Compare immutable versions</button>
                </div>
                {projectDiff && <div className="diff-summary">
                  <span><b>+{projectDiff.addedCount.toLocaleString()}</b> added</span><span><b>−{projectDiff.removedCount.toLocaleString()}</b> removed</span><span><b>{projectDiff.changedCount.toLocaleString()}</b> changed</span>
                  <p>{projectDiff.materialDeltaCount.toLocaleString()} material deltas · contract {projectDiff.contractChanged ? "changed" : "unchanged"} · certificate {projectDiff.certificateChanged ? "changed" : "unchanged"}</p>
                </div>}
                <div className="version-history"><small>IMMUTABLE HISTORY</small>{[...selectedProject.versions].reverse().slice(0, 12).map((version) => <div key={version.id}><span><b>{version.reason.replace("_", " ")}</b><time>{new Date(version.createdAt).toLocaleString()}</time></span><button onClick={() => restoreProjectVersion(version.id)} disabled={pending || version.id === selectedProject.head?.id}>Restore as new head</button></div>)}</div>
                <button className="button primary full" onClick={createReviewLink} disabled={pending}>Create seven-day client review link</button>
                {issuedReviewLink && <div className="review-link"><small>EXPIRES {new Date(issuedReviewLink.expiresAt).toLocaleString()}</small><a href={issuedReviewLink.url} target="_blank" rel="noreferrer">{issuedReviewLink.url}</a></div>}
              </> : <p className="project-empty">This project has no build version yet. Compile in the local Blockwright workbench or MCP channel, then save an autosave or manual version here.</p>}
            </section>}
            <div className="account-actions">
              <button className="button secondary" onClick={openBillingPortal} disabled={pending || !status?.billingConfigured || account.plan !== "studio"}>Manage plan</button>
              <button className="button secondary" onClick={showInvoices} disabled={pending || !status?.capabilities.invoices || account.plan !== "studio"}>Invoices</button>
              <button className="button secondary" onClick={requestRefund} disabled={pending || !status?.capabilities.refundRequests}>Refund support</button>
              <button className="button secondary" onClick={signOut} disabled={pending}>Sign out</button>
            </div>
            {account.role === "owner" && <button className="danger-link" onClick={deleteWorkspace} disabled={pending}>Delete workspace and all data</button>}
          </> : <>
            <div className="tabs" role="tablist" aria-label="Account action">
              <button role="tab" aria-selected={formMode === "register"} onClick={() => setFormMode("register")}>Create</button>
              <button role="tab" aria-selected={formMode === "login"} onClick={() => setFormMode("login")}>Sign in</button>
            </div>
            <form onSubmit={authenticate}>
              {formMode === "register" && <label>Workspace name<input name="tenantName" minLength={1} maxLength={80} autoComplete="organization" required disabled={!status?.hostedReady} /></label>}
              {formMode === "register" && status?.registrationAccessRequired && <label>Early-access key<input name="accessKey" type="password" minLength={32} maxLength={256} autoComplete="off" required disabled={!status.hostedReady} /></label>}
              <label>Email<input name="email" type="email" autoComplete="email" required disabled={!status?.hostedReady} /></label>
              <label>Password<input name="password" type="password" minLength={12} maxLength={256} autoComplete={formMode === "register" ? "new-password" : "current-password"} required disabled={!status?.hostedReady} /></label>
              <button className="button primary full" disabled={pending || !status?.hostedReady}>{pending ? "Working…" : formMode === "register" ? "Create private workspace" : "Sign in"}</button>
            </form>
          </>}
          {message && <p className="form-message" role="status">{message}</p>}
        </div>
      </section>

      <section className="download" id="get-blockwright">
        <BrandMark />
        <div><p className="eyebrow"><span /> Blockwright 0.6</p><h2>Your next build should be provable.</h2></div>
        <div className="download-actions"><a className="button primary" href={`${releaseBase}/Blockwright-0.6.0-windows-x64-setup.exe`}>Unsigned Windows installer</a><a className="button secondary" href={`${releaseBase}/Blockwright-0.6.0-windows-x64-portable.zip`}>Portable ZIP</a></div>
        <p className="release-warning"><strong>v0.6.0 is unsigned.</strong> Review the <a href={releasePage}>warning, hashes, and install instructions</a> before running it.</p>
      </section>
    </main>

    <footer><span>© 2026 Gildaltar · GPL-2.0-only</span><span>Not official or associated with Mojang or Microsoft.</span><a href="https://github.com/gildaltar/Blockwright">Source and documentation</a></footer>
  </>;
}

function RootRouter() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const updateRoute = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);
  return route === "#editor" || route.startsWith("#editor/")
    ? <Suspense fallback={<main className="editor-loading" role="status">Loading the PC-local editor…</main>}><ProceduralEditor /></Suspense>
    : <App />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><RootRouter /></StrictMode>);
